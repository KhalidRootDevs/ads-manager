/**
 * Change streams for the compiler (§4.3, §6.13). One stream per serving-relevant collection, `fullDocument:
 * "updateLookup"`, filtered so system bookkeeping writes (health, heartbeats, key last-used) don't cause compiles.
 */
import type { Db } from "@orbit/db"
import type { Logger, Redis } from "@orbit/server-kit"
import { SERVING } from "@orbit/domain"

/** Updated-field paths that never change serving: written by the compiler, aggregator and jobs themselves. */
export const IGNORED_FIELDS = /^(health(\.|$)|sdk\.lastHeartbeatAt$|sdk\.version$|lastUsedAt$|updatedAt$)/

export const streamPipeline = () => [
  {
    $match: {
      $or: [
        { operationType: { $in: ["insert", "replace", "delete"] } },
        {
          operationType: "update",
          $expr: {
            $or: [
              { $gt: [{ $size: { $ifNull: ["$updateDescription.removedFields", []] } }, 0] },
              {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: { $objectToArray: { $ifNull: ["$updateDescription.updatedFields", {}] } },
                        cond: { $not: [{ $regexMatch: { input: "$$this.k", regex: IGNORED_FIELDS.source } }] },
                      },
                    },
                  },
                  0,
                ],
              },
            ],
          },
        },
      ],
    },
  },
]

type WatchedModel = "Campaign" | "Creative" | "Property" | "Placement" | "PropertyKey" | "Country" | "Settings"
export const WATCHED: WatchedModel[] = ["Campaign", "Creative", "Property", "Placement", "PropertyKey", "Country", "Settings"]

export interface Streams {
  close(): Promise<void>
  /** latest resume tokens per collection */
  tokens(): Record<string, unknown>
}

const HISTORY_LOST = new Set([286, 280, 260]) // ChangeStreamHistoryLost, ChangeStreamFatalError, InvalidResumeToken

/**
 * Open the streams, resuming from the tokens stored in Redis. `onChange` fires for each relevant change;
 * `onReset` fires when history was lost (caller does a full reload).
 */
export async function openStreams(db: Db, redis: Redis, log: Logger, onChange: (coll: string) => void, onReset: () => void): Promise<Streams> {
  const stored = await redis.hgetall(SERVING.resumeToken).catch(() => ({}) as Record<string, string>)
  const tokens: Record<string, unknown> = {}
  const open: { close(): Promise<void> }[] = []
  let closed = false

  const start = (name: WatchedModel, resume: unknown) => {
    const model = db.models[name]
    const coll = model.collection.collectionName
    const cs = model.watch(streamPipeline(), { fullDocument: "updateLookup", ...(resume ? { resumeAfter: resume } : {}) })
    open.push(cs)
    cs.on("change", (ev: { _id: unknown }) => {
      tokens[coll] = ev._id
      onChange(coll)
    })
    cs.on("error", (err: { code?: number; message?: string }) => {
      if (closed) return
      log.warn({ coll, code: err.code, err: err.message }, "change stream error")
      void cs.close().catch(() => {})
      if (err.code != null && HISTORY_LOST.has(err.code)) {
        delete tokens[coll]
        void redis.hdel(SERVING.resumeToken, coll).catch(() => {})
        onReset()
        setTimeout(() => !closed && start(name, null), 500)
      } else {
        setTimeout(() => !closed && start(name, tokens[coll] ?? null), 2_000)
      }
    })
  }

  for (const name of WATCHED) {
    const coll = db.models[name].collection.collectionName
    let resume: unknown = null
    if (stored[coll]) {
      try {
        resume = JSON.parse(stored[coll])
        tokens[coll] = resume
      } catch {
        resume = null
      }
    }
    start(name, resume)
  }

  return {
    tokens: () => tokens,
    async close() {
      closed = true
      await Promise.all(open.map((s) => s.close().catch(() => {})))
    },
  }
}
