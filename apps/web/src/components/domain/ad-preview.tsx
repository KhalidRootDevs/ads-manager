"use client"

import { Play, X } from "lucide-react"
import { APP_ONLY_FORMATS, FORMAT_LABEL, sizeLabel, type AdFormat, type Creative } from "@orbit/domain"
import { cn } from "@/lib/utils"

/** What the preview needs. Build it from a saved creative with `adOf()`, or from wizard state. */
export interface AdLike {
  format: AdFormat
  size: string
  color: string
  headline: string
  body: string
  cta: string
  reward: string
  closeDelay: number
  closeBtn: boolean
  freqNotice: boolean
  /** main image, if uploaded */
  image?: string | null
}

export function adOf(c: Pick<Creative, "format" | "size" | "copy" | "options" | "assets">): AdLike {
  return {
    format: c.format, size: c.size, color: c.options.brandColor, headline: c.copy.headline, body: c.copy.body, cta: c.copy.cta, reward: c.options.reward ?? "",
    closeDelay: c.options.closeDelaySec ?? 0, closeBtn: c.options.closeButton !== false, freqNotice: c.options.freqNotice !== false,
    image: c.assets.find((a) => a.kind === "image")?.url ?? null,
  }
}

/** Placeholder render of a creative inside a phone or browser frame. Ad colors are the creative's own, not themed. */
export function AdPreview({ ad, device = "mobile", className }: { ad: AdLike; device?: "mobile" | "desktop"; className?: string }) {
  const F = ad.format
  const headline = ad.headline || "Your headline"
  const cta = ad.cta || "Learn more"
  const bg: React.CSSProperties = ad.image && /^https?:/.test(ad.image) ? { backgroundColor: ad.color || "#334155", backgroundImage: `linear-gradient(rgb(0 0 0 / 0.25), rgb(0 0 0 / 0.25)), url("${ad.image}")`, backgroundSize: "cover", backgroundPosition: "center" } : { backgroundColor: ad.color || "#334155" }
  const appOnly = APP_ONLY_FORMATS.includes(F)
  const full = F === "interstitial" || F === "rewarded_video" || F === "app_open"
  const delay = ad.closeDelay || 0

  if (device === "desktop") {
    const leader = F === "web_display" && /^(728|970)/.test(ad.size)
    const side = F === "web_display" && !leader
    return (
      <div className={cn("flex w-full justify-center p-4", className)}>
        <div className="w-full max-w-[540px] overflow-hidden rounded-xl border bg-white shadow-lg">
          <div className="flex h-8 items-center gap-1.5 bg-zinc-100 px-3">
            {[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-zinc-300" />)}
            <span className="ml-3 flex h-5 flex-1 items-center rounded-full bg-white px-3 text-[10px] text-zinc-500">yahachha.com/news/article</span>
          </div>
          <div className="relative flex h-80 flex-col gap-2.5 bg-zinc-50 p-4 text-zinc-900">
            {appOnly ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-zinc-500">This format only runs inside mobile apps. Switch to Mobile to preview it.</div>
            ) : (
              <>
                {leader && (
                  <div className="flex h-12 items-center justify-between rounded px-4 text-white" style={bg}>
                    <b className="text-sm">{headline}</b><span className="rounded bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-900">{cta}</span>
                  </div>
                )}
                <div className="flex min-h-0 flex-1 gap-3">
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="h-3.5 w-3/4 rounded bg-zinc-300" />
                    {[100, 100, 80].map((w, i) => <div key={i} className="h-2 rounded bg-zinc-200" style={{ width: w + "%" }} />)}
                    {F === "video" && <div className="grid h-32 place-items-center rounded-md" style={bg}><span className="grid size-9 place-items-center rounded-full bg-white/90"><Play className="size-4 fill-zinc-900 text-zinc-900" /></span></div>}
                    {F === "native" && (
                      <div className="flex gap-2 rounded-lg border bg-white p-2">
                        <div className="h-14 w-20 shrink-0 rounded-md" style={bg} />
                        <div className="text-[11px]"><b>{headline}</b><div className="text-zinc-500">Sponsored · {cta}</div></div>
                      </div>
                    )}
                    <div className="h-2 rounded bg-zinc-200" /><div className="h-2 w-3/5 rounded bg-zinc-200" />
                  </div>
                  {side && (
                    <div className="flex w-40 shrink-0 flex-col justify-between rounded p-3 text-white" style={{ ...bg, height: ad.size.startsWith("300x600") ? 270 : 130 }}>
                      <span className="text-[9px] opacity-80">Ad · {sizeLabel(ad.size)}</span><b className="text-sm leading-tight">{headline}</b>
                      <span className="w-fit rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-900">{cta}</span>
                    </div>
                  )}
                </div>
                {F === "web_popup" && <Popup ad={ad} headline={headline} cta={cta} bg={bg} wide />}
                {F === "rich_media" && <div className="absolute inset-10 grid place-items-center rounded-xl border-2 border-dashed border-zinc-400 bg-white text-sm text-zinc-500">Rich media preview isn’t available yet.</div>}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex w-full justify-center p-4", className)}>
      <div className="h-[520px] w-[260px] rounded-[36px] bg-zinc-900 p-2.5 shadow-xl">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-zinc-100 text-zinc-900">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-white px-3.5"><div className="size-5 rounded-md bg-zinc-300" /><div className="h-2 w-24 rounded bg-zinc-300" /></div>
          <div className="flex flex-1 flex-col gap-2.5 overflow-hidden p-3">
            <div className="h-16 rounded-lg border bg-white" />
            {F === "native" && (
              <div className="flex flex-col gap-2 rounded-lg border bg-white p-2.5">
                <div className="flex items-center gap-2"><div className="size-7 rounded-lg" style={bg} /><div className="min-w-0 flex-1"><div className="text-[11.5px] leading-tight font-semibold">{headline}</div><div className="text-[9.5px] text-zinc-500">Sponsored</div></div></div>
                {ad.body && <p className="text-[10.5px] leading-snug text-zinc-600">{ad.body}</p>}
                <div className="h-24 rounded-md opacity-85" style={bg} />
                <span className="self-end rounded-md px-2.5 py-1 text-[10.5px] font-semibold text-white" style={bg}>{cta}</span>
              </div>
            )}
            {F === "web_display" && (
              <div className="flex h-40 w-48 flex-col justify-between self-center rounded p-3 text-white" style={bg}>
                <span className="text-[9px] opacity-80">Ad · {sizeLabel(ad.size)}</span><b className="text-[15px] leading-tight">{headline}</b><span className="w-fit rounded bg-white px-2 py-0.5 text-[10.5px] font-semibold text-zinc-900">{cta}</span>
              </div>
            )}
            {F === "video" && <div className="relative grid h-32 place-items-center rounded-lg" style={bg}><span className="grid size-9 place-items-center rounded-full bg-white/90"><Play className="size-4 fill-zinc-900 text-zinc-900" /></span><span className="absolute bottom-1.5 left-2 text-[10px] font-semibold text-white">{headline}</span></div>}
            {F === "rich_media" && <div className="grid h-44 place-items-center rounded-xl border-2 border-dashed border-zinc-400 p-3 text-center text-[11.5px] text-zinc-500">Rich media preview isn’t available yet. The bundle is stored as a draft.</div>}
            <div className="h-14 rounded-lg border bg-white" />
            <div className="h-14 rounded-lg border bg-white" />
          </div>
          {F === "banner" && (
            <div className="flex shrink-0 items-center gap-2 px-2.5 text-white" style={{ ...bg, height: ad.size.startsWith("728") ? 30 : ad.size.startsWith("320x100") ? 72 : 42 }}>
              <span className="rounded bg-black/30 px-1 text-[8px]">Ad</span>
              <b className="min-w-0 flex-1 truncate text-[11px]">{headline}</b>
              <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-zinc-900">{cta}</span>
            </div>
          )}
          {full && (
            <div className="absolute inset-0 flex flex-col gap-2.5 p-4 text-white" style={bg}>
              <div className="flex items-center justify-between text-[10px]">
                <span className="rounded bg-black/30 px-1.5 py-0.5">{F === "rewarded_video" ? "Rewarded" : F === "app_open" ? "App open ad" : "Ad"}</span>
                {F === "interstitial" && <span className="rounded-full bg-black/35 px-2 py-0.5">{delay ? `Close in ${delay}s` : "Close ✕"}</span>}
                {F === "app_open" && <span className="rounded-full bg-black/35 px-2 py-0.5">Continue to app ›</span>}
              </div>
              {F === "app_open" && <div className="absolute inset-x-4 top-14 bottom-[72px] rounded-xl border-[1.5px] border-dashed border-white/60" />}
              <div className="relative mt-auto flex flex-col gap-2">
                <b className="text-xl leading-tight">{headline}</b>
                {ad.body && F !== "rewarded_video" && <span className="text-xs opacity-90">{ad.body}</span>}
                {F === "rewarded_video" && (
                  <>
                    <span className="rounded-md bg-white/20 px-2 py-1.5 text-[11px]">Reward: {ad.reward || "—"}</span>
                    <div className="h-1 rounded bg-white/30"><div className="h-full w-3/5 rounded bg-white" /></div>
                    <span className="text-[10px] opacity-85">0:18 left · reward unlocks at the end</span>
                  </>
                )}
                <span className="rounded-lg bg-white py-2.5 text-center text-[13px] font-semibold text-zinc-900">{cta}</span>
                {F === "app_open" && <span className="text-center text-[10px] opacity-80">Dashed line = screen-safe area</span>}
              </div>
            </div>
          )}
          {F === "web_popup" && <Popup ad={ad} headline={headline} cta={cta} bg={bg} />}
        </div>
      </div>
    </div>
  )
}

function Popup({ ad, headline, cta, bg, wide }: { ad: AdLike; headline: string; cta: string; bg: React.CSSProperties; wide?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/50 p-4">
      <div className={cn("overflow-hidden rounded-xl bg-white", wide ? "w-64" : "w-full")}>
        <div className="relative h-20" style={bg}>{ad.closeBtn && <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-white/90"><X className="size-3 text-zinc-900" /></span>}</div>
        <div className="flex flex-col gap-1.5 p-3">
          <b className="text-[13px]">{headline}</b>
          {ad.body && <span className="text-[11px] text-zinc-600">{ad.body}</span>}
          <span className="rounded-md py-1.5 text-center text-[11px] font-semibold text-white" style={bg}>{cta}</span>
          {ad.freqNotice && <span className="text-center text-[9.5px] text-zinc-500">Shown at most once a day</span>}
        </div>
      </div>
    </div>
  )
}

/** Small colored tile used in lists and pickers (shows the main image when one is uploaded). */
export function CreativeThumb({ c, className }: { c: Pick<Creative, "format" | "size" | "copy" | "options" | "assets" | "name">; className?: string }) {
  const img = c.assets.find((a) => a.kind === "image" || a.kind === "icon")?.url
  return (
    <div className={cn("relative flex flex-col justify-end gap-0.5 overflow-hidden rounded-md p-3 text-white", className)} style={{ backgroundColor: c.options.brandColor }}>
      {img && /^https?:/.test(img) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 size-full object-cover opacity-40" />
      )}
      <span className="relative mb-auto w-fit rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-medium">{FORMAT_LABEL[c.format]}</span>
      <span className="relative line-clamp-2 text-sm leading-tight font-semibold">{c.copy.headline || c.name}</span>
      <span className="relative font-mono text-[11px] opacity-90">{c.size ? sizeLabel(c.size) : ""}</span>
    </div>
  )
}
