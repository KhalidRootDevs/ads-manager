/** collector boot: env → Redis (+ subscriber for key hashes) → Kafka acked producer → HTTP. */
import { parseSecrets } from "@orbit/domain/node"
import { createLogger, createRedis, serve } from "@orbit/server-kit"
import { buildApp } from "./app"
import { loadEnv } from "./env"
import { PropertyDirectory } from "./keys"
import { KafkaAckedProducer } from "./producer"

async function main() {
  const env = loadEnv()
  const log = createLogger("collector", env.LOG_LEVEL)
  const redis = createRedis(env.REDIS_URL, { maxRetriesPerRequest: 0, enableOfflineQueue: false, commandTimeout: 50 })
  redis.on("error", () => {})
  const sub = createRedis(env.REDIS_URL, { maxRetriesPerRequest: null })
  sub.on("error", () => {})
  const directory = new PropertyDirectory(createRedis(env.REDIS_URL), log)
  await directory.start(sub)
  const producer = new KafkaAckedProducer(env.KAFKA_BROKERS, log)
  const app = buildApp({ log, redis, producer, directory, ring: parseSecrets(env.TRACKING_SECRETS, env.TRACKING_ACTIVE_KID), keyPepper: env.KEY_PEPPER, production: env.NODE_ENV === "production" })
  await serve(app, {
    port: env.COLLECTOR_PORT, log,
    onShutdown: async () => {
      await producer.close()
      directory.stop()
      sub.disconnect()
      redis.disconnect()
    },
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
