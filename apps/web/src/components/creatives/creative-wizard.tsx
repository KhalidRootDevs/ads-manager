"use client"

import { ApiError, useApiMutation, useApiQuery } from "@orbit/api-client/react"
import {
  AD_FORMATS, allowsDeepLink, CLOSE_DELAY_MAX_SEC, COMPLETION_EVENTS, FORMAT_LABEL, FORMAT_META, finalUrl, hasSizeChoice, isAppFormat, isDeepLink, isHttpsUrl,
  NATIVE_BODY_MAX, NATIVE_TITLE_MAX, PLATFORM_LABEL, SIZED_FORMATS, sizeLabel, type AdFormat, type Asset, type AssetKind, type Creative, type CreativePatch,
} from "@orbit/domain"
import { ArrowLeft, ArrowRight, Check, CircleAlert, FileImage, FileVideo, Info, Loader2, Monitor, Save, Send, ShieldAlert, Smartphone, Sparkles, Trash2, Upload } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AdPreview } from "@/components/domain/ad-preview"
import { KeyValue, Stepper } from "@/components/domain/widgets"
import { GuardedLink, useDirty, useGuardedRouter } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { useMutationError } from "@/components/placements/placement-utils"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { useCan, useCreatives } from "@/lib/hooks"
import { useUi } from "@/lib/ui-store"
import { cn } from "@/lib/utils"
import { CheckList, FORMAT_ICON } from "./creative-bits"
import {
  changedContent, checksFor, CLOSE_DELAYS, closeDelayTooLong, type CreativeDraft, DEFAULT_CTA, destinationError, draftFrom, fileSize, IMAGE_MIMES, isVideoDraft, LIVE_CREATIVE,
  needsAsset, newDraft, PLACEHOLDER_COLORS, STEPS, stepError, toContent, UPLOAD_LIMITS, VIDEO_MIMES,
} from "./creative-draft"

const CTA_SUGGESTIONS = ["Learn more", "Install", "Watch now", "Shop now", "Sign up", "Open app"]

/** Only same-origin relative paths are accepted as return targets. */
function safeReturn(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null
}

/** Width/height (and duration for video) read in the browser before uploading. */
async function readMeta(file: File): Promise<Pick<Asset, "width" | "height" | "durationSec">> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image()
      img.src = url
      await img.decode()
      return { width: img.naturalWidth || null, height: img.naturalHeight || null, durationSec: null }
    }
    const v = document.createElement("video")
    v.preload = "metadata"
    v.muted = true
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res()
      v.onerror = () => rej(new Error("This video can’t be read. Use MP4 (H.264) or WebM."))
      v.src = url
    })
    return { width: v.videoWidth || null, height: v.videoHeight || null, durationSec: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function uploadErrorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message
  const m = e instanceof Error ? e.message : ""
  if (m.includes("(422)")) return "The file content doesn’t match its type. Export it again as PNG, JPG, GIF, WebP, MP4 or WebM."
  if (m.includes("(413)")) return "The file is larger than allowed."
  if (m.includes("(403)")) return "The upload link expired. Try again."
  return m || "The upload failed. Try again."
}

export function CreativeWizard({ existing }: { existing?: Creative }) {
  const canWrite = useCan("creatives.write")
  if (!canWrite)
    return (
      <PageContainer className="max-w-5xl">
        <Empty className="mt-8 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ShieldAlert /></EmptyMedia>
            <EmptyTitle>You can’t edit creatives</EmptyTitle>
            <EmptyDescription>Your role can view the creative library but not create or change creatives. Ask an owner, admin or campaign manager.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button asChild variant="outline"><GuardedLink href={existing ? `/creatives/${existing.id}` : "/creatives"}>Back</GuardedLink></Button></EmptyContent>
        </Empty>
      </PageContainer>
    )
  return <Wizard existing={existing} />
}

function Wizard({ existing }: { existing?: Creative }) {
  const router = useRouter()
  const guarded = useGuardedRouter()
  const params = useSearchParams()
  const returnTo = safeReturn(params.get("returnTo"))
  const fromCampaign = !!returnTo?.startsWith("/campaigns")
  const canApprove = useCan("creatives.approve")
  const usedQ = useApiQuery("listCampaigns", existing ? { query: { creativeId: existing.id, limit: 100 } } : null)
  const usedBy = usedQ.data?.items ?? []
  const library = useCreatives().data

  const [w, setW] = useState<CreativeDraft>(() => (existing ? draftFrom(existing) : newDraft()))
  // Editing starts on the assets step — the format is already chosen and rarely changes.
  const [step, setStep] = useState(existing ? 2 : 1)
  const [maxStep, setMaxStep] = useState(existing ? 5 : 1)
  const [showErr, setShowErr] = useState(false)
  const [dirty, setDirtyLocal] = useState(false)
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile")
  const [uploading, setUploading] = useState<AssetKind | null>(null)
  const [note, setNote] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const iconRef = useRef<HTMLInputElement>(null)
  useDirty(dirty)

  const set = (patch: Partial<CreativeDraft>) => {
    setW((prev) => ({ ...prev, ...patch }))
    setDirtyLocal(true)
  }

  const F = w.format
  const checks = checksFor(w)
  const failing = checks.filter((x) => !x.ok)
  const err = stepError(w, step)
  const isVid = isVideoDraft(w)
  const isHtml = F === "rich_media"
  const app = isAppFormat(F)
  // App-only formats have no desktop placement, so the desktop preview is disabled for them.
  const previewDevice = app ? "mobile" : device
  const sizes = F ? FORMAT_META[F].sizes : []
  const cancelHref = returnTo ?? (existing ? `/creatives/${existing.id}` : "/creatives")
  const F_LABEL = F ? FORMAT_LABEL[F] : ""
  // Ready / in-review creatives keep their status on save while checks pass; drafts choose Draft or Submit.
  const liveEdit = !!existing && LIVE_CREATIVE.includes(existing.status)
  const mainKind: AssetKind = isVid ? "video" : "image"

  const libraryAssets = useMemo(() => {
    const seen = new Map<string, Asset>()
    for (const c of library ?? []) for (const a of c.assets) if (a.kind === mainKind && /^https?:/.test(a.url) && !seen.has(a.url)) seen.set(a.url, a)
    return [...seen.values()].slice(0, 40)
  }, [library, mainKind])

  const goStep = (n: number) => { setStep(n); setShowErr(false); window.scrollTo({ top: 0 }) }
  const next = () => {
    if (err) { setShowErr(true); toast.error(err); return }
    const n = step + 1
    setMaxStep((m) => Math.max(m, n))
    goStep(n)
  }

  const pickFormat = (f: AdFormat) => {
    if (f === F) return
    const s = FORMAT_META[f].sizes
    const media = f === "rewarded_video" || f === "video" ? "video" : "image"
    set({ format: f, size: s.length === 1 || f === "interstitial" ? s[0] : "", asset: null, icon: f === "native" ? w.icon : null, media })
  }

  // ----- uploads: createUpload ticket → PUT the file → keep the public URL in the draft -----
  const upload = async (file: File, kind: AssetKind) => {
    const video = kind === "video"
    const allowed = video ? VIDEO_MIMES : IMAGE_MIMES
    if (!allowed.includes(file.type)) { toast.error(video ? "Upload an MP4 or WebM video." : "Upload a PNG, JPG, GIF or WebP image."); return }
    const limit = video ? UPLOAD_LIMITS.video : UPLOAD_LIMITS.image
    if (file.size > limit) { toast.error(`${video ? "Videos" : "Images"} can be at most ${limit / 1_000_000} MB.`, { description: `${file.name} is ${fileSize(file.size)}.` }); return }
    setUploading(kind)
    try {
      const [meta, hash] = await Promise.all([readMeta(file), sha256(file)])
      const ticket = await api.call("createUpload", { body: { fileName: file.name.slice(-200), mime: file.type, bytes: file.size } })
      const url = await api.upload(ticket, file)
      const asset: Asset = { kind, url, name: file.name, mime: file.type, bytes: file.size, ...meta, sha256: hash }
      set(kind === "icon" ? { icon: asset } : { asset })
      toast.success(`${file.name} uploaded`)
    } catch (e) {
      toast.error("Upload failed", { description: uploadErrorMessage(e) })
    } finally {
      setUploading(null)
    }
  }
  const onFile = (kind: AssetKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (f) void upload(f, kind)
  }
  const pickLibrary = (url: string) => {
    const a = libraryAssets.find((x) => x.url === url)
    if (a) set({ asset: { ...a } })
  }

  // ----- save -----
  const onError = useMutationError("creatives")
  const done = (c: Creative, verb: string) => {
    setDirtyLocal(false)
    useUi.getState().setDirty(false)
    toast.success(verb, { description: fromCampaign ? "Back to your campaign — attach it from the creatives step." : undefined })
    router.push(returnTo ?? `/creatives/${c.id}`)
  }
  const verbFor = (c: Creative, intent?: "draft" | "submit") =>
    c.status === "ready" ? (intent === "submit" ? "Creative saved as Ready" : "Creative saved") : c.status === "in_review" ? "Creative submitted for review" : existing && LIVE_CREATIVE.includes(existing.status) ? "Saved — moved back to Draft because a check fails" : "Creative saved as Draft"
  const create = useApiMutation("createCreative", { onSuccess: (c, v) => done(c, verbFor(c, v.body.intent)), onError: (e) => onError(e, "Couldn’t save the creative") })
  const patch = useApiMutation("patchCreative", { onSuccess: (c, v) => done(c, verbFor(c, v.body.intent)), onError: (e) => onError(e, "Couldn’t save the creative") })
  const submitM = useApiMutation("submitCreative", { onSuccess: (c) => done(c, verbFor(c, "submit")), onError: (e) => onError(e, "Couldn’t submit") })
  const saving = create.isPending || patch.isPending || submitM.isPending

  const save = (intent: "draft" | "submit" | "keep") => {
    if (w.name.trim().length < 3) {
      goStep(2)
      setShowErr(true)
      toast.error("Name the creative before saving.")
      return
    }
    const destErr = destinationError(w)
    if (destErr) { goStep(4); setShowErr(true); toast.error(destErr); return }
    if (intent === "submit" && failing.length) { toast.error("Fix the failing checks first.", { description: failing.map((x) => x.label).join(", ") }); return }
    const content = toContent(w)
    if (!existing) {
      create.mutate({ body: { ...content, intent: intent === "submit" ? "submit" : "draft" } })
      return
    }
    const changed = changedContent(existing, content)
    if (!Object.keys(changed).length) {
      if (intent === "submit" && (existing.status === "draft" || existing.status === "rejected")) submitM.mutate({ params: { id: existing.id }, body: { rev: existing.rev } })
      else { setDirtyLocal(false); useUi.getState().setDirty(false); toast.info("No changes to save"); router.push(returnTo ?? `/creatives/${existing.id}`) }
      return
    }
    // PATCH: only the changed keys plus rev (each edit creates a version).
    const body: CreativePatch = { ...(changed as Omit<CreativePatch, "rev">), rev: existing.rev, ...(note.trim() ? { note: note.trim() } : {}) }
    if (intent === "submit") body.intent = "submit"
    patch.mutate({ params: { id: existing.id }, body })
  }

  const previewNote =
    app ? `${F_LABEL} runs only inside mobile apps, so there is no desktop preview.`
    : F === "interstitial" ? `The close button appears after ${w.closeDelay} second${w.closeDelay === "1" ? "" : "s"}.`
    : F === "rewarded_video" ? `The reward is granted when ${w.event} fires at the end of the video.`
    : F === "web_popup" ? "Visitors see this at most once per day."
    : F === "app_open" ? "The dashed line marks the screen-safe area; keep logos and text inside it."
    : isHtml ? "Rich media can’t be previewed yet."
    : ""

  const content = toContent(w)
  const final = finalUrl(content.destination)
  const urlErr = !!w.url.trim() && !isHttpsUrl(w.url)
  const dlErr = !!w.deepLink.trim() && !isDeepLink(w.deepLink)
  const nameErr = showErr && w.name.trim().length < 3
  const assetErr = showErr && step === 2 && !w.asset && needsAsset(F)
  const sizeErr = showErr && step === 2 && hasSizeChoice(F) && !w.size
  const dimMismatch = !!(F && SIZED_FORMATS.includes(F) && w.asset?.kind === "image" && w.asset.width && w.size && /^\d+x\d+$/.test(w.size) && `${w.asset.width}x${w.asset.height}` !== w.size)

  const submitLabel = canApprove ? "Save as Ready" : "Submit for review"

  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        backHref={cancelHref}
        backLabel={returnTo ? "Back to campaign" : existing ? existing.name : "Ad creatives"}
        title={existing ? "Edit creative" : "New creative"}
        badges={existing ? <StatusBadge status={existing.status} /> : undefined}
        description={existing ? `Saving creates version ${existing.currentVersion + 1}.${liveEdit ? " It keeps serving while every check passes." : " Choose Draft or submit it on the last step."}` : "Build a reusable ad in five steps. You can save a draft at any point."}
      />

      {fromCampaign && (
        <Alert>
          <Info />
          <AlertTitle>Creating a creative for your campaign</AlertTitle>
          <AlertDescription>After you save, you’ll go straight back to the campaign wizard.</AlertDescription>
        </Alert>
      )}

      <Stepper steps={STEPS.map((s) => (s === "Validate & save" ? "Validate" : s))} current={step} maxStep={maxStep} onStep={goStep} errorSteps={showErr && err ? [step] : []} />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>{step}. {STEPS[step - 1]}</CardTitle>
          <CardDescription>
            {step === 1 && "Choose where and how the ad appears. Only placements with the same format can serve it."}
            {step === 2 && `Add the asset and copy for this ${F_LABEL || "creative"}.`}
            {step === 3 && "Check how it looks on a phone and, for web formats, a desktop browser."}
            {step === 4 && "Where a tap or click should take people, plus tracking and accessibility."}
            {step === 5 && (liveEdit ? "Every check should pass so the creative keeps serving." : `Every check must pass to ${canApprove ? "save as Ready" : "submit for review"}. Drafts can be saved at any time.`)}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-2">
          {step === 1 && existing && F !== existing.format && usedBy.length > 0 && (
            <Alert className="mb-3 border-amber-500/40 bg-amber-500/5">
              <CircleAlert className="text-amber-600 dark:text-amber-400" />
              <AlertTitle>Changing the format affects {usedBy.length} campaign{usedBy.length === 1 ? "" : "s"}</AlertTitle>
              <AlertDescription>
                {usedBy.map((x) => x.name).join(", ")} only serve{usedBy.length === 1 ? "s" : ""} it in {FORMAT_LABEL[existing.format]} placements. As {F_LABEL || "another format"} it will stop serving there.
              </AlertDescription>
            </Alert>
          )}
          {step === 1 && (
            <div role="radiogroup" aria-label="Ad format" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AD_FORMATS.map((f) => {
                const Icon = FORMAT_ICON[f]
                const on = F === f
                const meta = FORMAT_META[f]
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pickFormat(f)}
                    className={cn(
                      "relative flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                      on && "border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/5",
                    )}
                  >
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground", on && "bg-primary text-primary-foreground")}><Icon className="size-4.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">
                        {FORMAT_LABEL[f]}
                        {meta.future && <Badge variant="outline" className="gap-1 font-normal"><Sparkles /> Future-ready</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{meta.desc}</span>
                      <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">{meta.future ? meta.sizes.map(sizeLabel).join(" · ") : `${meta.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} · ${meta.sizes.map(sizeLabel).join(", ")}`}</span>
                    </span>
                    {on && <Check className="absolute top-3 right-3 size-4 text-primary" aria-hidden />}
                  </button>
                )
              })}
            </div>
          )}

          {step === 2 && (
            <FieldGroup className="py-2">
              <Field data-invalid={nameErr || undefined}>
                <FieldLabel htmlFor="cr-name">Creative name</FieldLabel>
                <Input id="cr-name" value={w.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. World Cup Highlights 320×50" aria-invalid={nameErr || undefined} maxLength={120} />
                {nameErr ? <FieldError>Enter a name of at least 3 characters.</FieldError> : <FieldDescription>Internal only — people never see this name.</FieldDescription>}
              </Field>

              {hasSizeChoice(F) && (
                <Field data-invalid={sizeErr || undefined}>
                  <FieldLabel>Dimensions</FieldLabel>
                  <ToggleGroup type="single" variant="outline" size="sm" value={w.size} onValueChange={(v) => v && set({ size: v })} className="flex-wrap justify-start" aria-label="Dimensions">
                    {sizes.map((x) => <ToggleGroupItem key={x} value={x} className="px-3 font-mono text-xs">{sizeLabel(x)}</ToggleGroupItem>)}
                  </ToggleGroup>
                  {sizeErr ? <FieldError>Choose a size.</FieldError> : <FieldDescription>Must match the placement size exactly{F === "interstitial" || F === "video" ? " (portrait or landscape)" : ""}.</FieldDescription>}
                </Field>
              )}

              {F === "interstitial" && (
                <Field>
                  <FieldLabel>Media type</FieldLabel>
                  <ToggleGroup type="single" variant="outline" size="sm" value={w.media} onValueChange={(v) => v && v !== w.media && set({ media: v as "image" | "video", asset: null })} className="justify-start" aria-label="Media type">
                    <ToggleGroupItem value="image" className="px-3"><FileImage /> Image</ToggleGroupItem>
                    <ToggleGroupItem value="video" className="px-3"><FileVideo /> Video</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              )}

              {!isHtml && (
                <Field data-invalid={assetErr || undefined}>
                  <FieldLabel>{F === "native" ? "Main image" : isVid ? "Video" : "Image"}{F === "web_popup" && <span className="font-normal text-muted-foreground">(optional)</span>}</FieldLabel>
                  <input ref={fileRef} type="file" className="sr-only" tabIndex={-1} aria-hidden accept={(isVid ? VIDEO_MIMES : IMAGE_MIMES).join(",")} onChange={onFile(mainKind)} data-testid="asset-input" />
                  {w.asset ? (
                    <AssetRow asset={w.asset} color={w.color} onRemove={() => set({ asset: null })} />
                  ) : (
                    <div className={cn("flex flex-col gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center", assetErr && "border-destructive")}>
                      <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!!uploading}>
                        {uploading === mainKind ? <Loader2 className="animate-spin" /> : <Upload />} {uploading === mainKind ? "Uploading…" : "Upload file"}
                      </Button>
                      {libraryAssets.length > 0 && (
                        <>
                          <span className="text-xs text-muted-foreground">or</span>
                          <Select value="" onValueChange={pickLibrary}>
                            <SelectTrigger className="w-full min-w-0 sm:w-64" aria-label="Reuse an uploaded asset"><SelectValue placeholder="Reuse an uploaded asset" /></SelectTrigger>
                            <SelectContent>
                              {libraryAssets.map((x) => <SelectItem key={x.url} value={x.url}><span className="font-mono text-xs">{x.name}</span></SelectItem>)}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>
                  )}
                  {assetErr ? <FieldError>Upload or pick an asset.</FieldError> : (
                    <FieldDescription>
                      {isVid ? "MP4 or WebM · up to 30 seconds · max 50 MB" : `PNG, JPG, GIF or WebP · ${w.size ? sizeLabel(w.size) : "pick a size first"} · max 1 MB`}
                    </FieldDescription>
                  )}
                  {dimMismatch && w.asset && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /> The image is {w.asset.width}×{w.asset.height}, but the slot is {sizeLabel(w.size)}. It will be scaled to fit.</p>
                  )}
                </Field>
              )}

              {F === "native" && (
                <Field>
                  <FieldLabel>App icon</FieldLabel>
                  <input ref={iconRef} type="file" className="sr-only" tabIndex={-1} aria-hidden accept={IMAGE_MIMES.join(",")} onChange={onFile("icon")} data-testid="icon-input" />
                  {w.icon ? (
                    <AssetRow asset={w.icon} color={w.color} onRemove={() => set({ icon: null })} label="Remove icon" />
                  ) : (
                    <Button variant="outline" className="w-fit" onClick={() => iconRef.current?.click()} disabled={!!uploading}>
                      {uploading === "icon" ? <Loader2 className="animate-spin" /> : <Upload />} {uploading === "icon" ? "Uploading…" : "Upload icon"}
                    </Button>
                  )}
                  <FieldDescription>128×128 PNG with no transparent padding.</FieldDescription>
                </Field>
              )}

              <FieldSet>
                <FieldLegend variant="label">Placeholder colour</FieldLegend>
                <FieldDescription className="-mt-2">Used for the preview and as the ad’s brand colour.</FieldDescription>
                <div role="radiogroup" aria-label="Placeholder colour" className="flex flex-wrap gap-2">
                  {PLACEHOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={w.color === c}
                      aria-label={`Placeholder colour ${c}`}
                      onClick={() => set({ color: c })}
                      className={cn("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50", w.color === c && "ring-2 ring-foreground")}
                      style={{ backgroundColor: c }}
                    >
                      {w.color === c && <Check className="size-4 text-white" aria-hidden />}
                    </button>
                  ))}
                </div>
              </FieldSet>

              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="cr-headline">{F === "native" ? "Title" : "Headline"}</FieldLabel>
                  <Counter n={w.headline.length} max={F === "native" ? NATIVE_TITLE_MAX : undefined} />
                </div>
                <Input id="cr-headline" value={w.headline} maxLength={120} onChange={(e) => set({ headline: e.target.value })} placeholder="e.g. Every World Cup goal in 60 seconds" aria-invalid={(F === "native" && w.headline.length > NATIVE_TITLE_MAX) || undefined} />
              </Field>

              {(F === "native" || F === "interstitial" || F === "web_popup") && (
                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="cr-body">Body text</FieldLabel>
                    <Counter n={w.body.length} max={F === "native" ? NATIVE_BODY_MAX : undefined} />
                  </div>
                  <Textarea id="cr-body" rows={3} value={w.body} maxLength={300} onChange={(e) => set({ body: e.target.value })} placeholder="One or two short sentences." aria-invalid={(F === "native" && w.body.length > NATIVE_BODY_MAX) || undefined} />
                </Field>
              )}

              {F === "interstitial" && (
                <Field data-invalid={closeDelayTooLong(w) || undefined}>
                  <FieldLabel>Close button appears after</FieldLabel>
                  <Select value={w.closeDelay} onValueChange={(v) => set({ closeDelay: v })}>
                    <SelectTrigger className="w-full sm:w-48" aria-label="Close button delay"><SelectValue /></SelectTrigger>
                    <SelectContent>{CLOSE_DELAYS.map((d) => <SelectItem key={d} value={d}>{d === "0" ? "Immediately" : `${d} seconds`}</SelectItem>)}</SelectContent>
                  </Select>
                  {closeDelayTooLong(w) ? <FieldError>Store policies allow at most {CLOSE_DELAY_MAX_SEC} seconds before the close button shows.</FieldError> : <FieldDescription>Maximum {CLOSE_DELAY_MAX_SEC} seconds.</FieldDescription>}
                </Field>
              )}

              {F === "rewarded_video" && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="cr-reward">Reward label</FieldLabel>
                    <Input id="cr-reward" value={w.reward} maxLength={60} onChange={(e) => set({ reward: e.target.value })} placeholder="e.g. Advanced stats for 24 hours" />
                    <FieldDescription>Shown before and after the video.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Completion event</FieldLabel>
                    <Select value={w.event} onValueChange={(v) => set({ event: v })}>
                      <SelectTrigger className="w-full" aria-label="Completion event"><SelectValue placeholder="Choose an event" /></SelectTrigger>
                      <SelectContent>{COMPLETION_EVENTS.map((e) => <SelectItem key={e} value={e}><span className="font-mono text-xs">{e}</span></SelectItem>)}</SelectContent>
                    </Select>
                    <FieldDescription>The app grants the reward when this fires.</FieldDescription>
                  </Field>
                </div>
              )}

              {F === "app_open" && (
                <CheckField id="cr-safe" checked={w.safeArea} onChange={(v) => set({ safeArea: v })} label="Logo and text sit inside the screen-safe area" description="Avoids the status bar, notch and the “Continue to app” control." />
              )}

              {F === "web_popup" && (
                <div className="flex flex-col gap-4">
                  <CheckField id="cr-close" checked={w.closeBtn} onChange={(v) => set({ closeBtn: v })} label="Show a visible close button" description="Required on every web modal." />
                  <CheckField id="cr-freq" checked={w.freqNotice} onChange={(v) => set({ freqNotice: v })} label="Show the frequency notice" description="“Shown at most once a day” appears under the CTA." />
                </div>
              )}

              {isHtml && (
                <Alert>
                  <Sparkles />
                  <AlertTitle>Future-ready format</AlertTitle>
                  <AlertDescription>The SDK can’t render HTML creatives yet, and bundle uploads aren’t enabled. You can save the copy and settings as a Draft; it can’t be submitted until rich media ships.</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3 py-2">
              <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={previewDevice} onValueChange={(v) => v && setDevice(v as "mobile" | "desktop")} aria-label="Preview device" className="self-center">
                <ToggleGroupItem value="mobile" className="px-3"><Smartphone /> Mobile</ToggleGroupItem>
                <ToggleGroupItem value="desktop" className="px-3" disabled={app} title={app ? "App-only format — no desktop placement" : undefined}><Monitor /> Desktop</ToggleGroupItem>
              </ToggleGroup>
              <div className="overflow-hidden rounded-lg bg-muted/40">
                {F && (
                  <AdPreview
                    device={previewDevice}
                    ad={{
                      format: F, color: w.color, headline: w.headline || "Your headline here", body: w.body, cta: w.cta || DEFAULT_CTA, size: content.size, reward: w.reward,
                      closeDelay: Number(w.closeDelay), closeBtn: w.closeBtn, freqNotice: w.freqNotice, image: w.asset?.kind === "image" ? w.asset.url : null,
                    }}
                  />
                )}
              </div>
              {previewNote && <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><Info className="size-3.5 shrink-0" /> {previewNote}</p>}
            </div>
          )}

          {step === 4 && (
            <FieldGroup className="py-2">
              {isHtml && (
                <Alert>
                  <Info />
                  <AlertDescription>Destinations are optional while rich media is a draft-only format.</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-5 sm:grid-cols-2">
                {allowsDeepLink(F) && (
                  <Field data-invalid={dlErr || undefined}>
                    <FieldLabel htmlFor="cr-dl">Deep link</FieldLabel>
                    <Input id="cr-dl" value={w.deepLink} onChange={(e) => set({ deepLink: e.target.value })} placeholder="drmsport://highlights" className="font-mono text-sm" aria-invalid={dlErr || undefined} />
                    {dlErr ? <FieldError>Use the form scheme://path.</FieldError> : <FieldDescription>Opens a screen inside the app.</FieldDescription>}
                  </Field>
                )}
                <Field data-invalid={urlErr || undefined} className={cn(!allowsDeepLink(F) && "sm:col-span-2")}>
                  <FieldLabel htmlFor="cr-url">{app ? "Fallback URL" : "Click-through URL"}</FieldLabel>
                  <Input id="cr-url" type="url" inputMode="url" value={w.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/landing" className="font-mono text-sm" aria-invalid={urlErr || undefined} />
                  {urlErr ? <FieldError>Must start with https:// and include a domain.</FieldError> : (
                    <FieldDescription>{allowsDeepLink(F) ? "Used when the app isn’t installed or the deep link fails." : "Must use https."}</FieldDescription>
                  )}
                </Field>
              </div>
              {showErr && err && <FieldError>{err}</FieldError>}

              <FieldSet>
                <FieldLegend variant="label">Tracking parameters <span className="font-normal text-muted-foreground">(optional)</span></FieldLegend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field><FieldLabel htmlFor="utm-s" className="text-xs text-muted-foreground">utm_source</FieldLabel><Input id="utm-s" maxLength={60} value={w.utmS} onChange={(e) => set({ utmS: e.target.value })} placeholder="orbit" /></Field>
                  <Field><FieldLabel htmlFor="utm-m" className="text-xs text-muted-foreground">utm_medium</FieldLabel><Input id="utm-m" maxLength={60} value={w.utmM} onChange={(e) => set({ utmM: e.target.value })} placeholder={F || "banner"} /></Field>
                  <Field><FieldLabel htmlFor="utm-c" className="text-xs text-muted-foreground">utm_campaign</FieldLabel><Input id="utm-c" maxLength={60} value={w.utmC} onChange={(e) => set({ utmC: e.target.value })} placeholder="wc_highlights" /></Field>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3" aria-live="polite">
                  <div className="text-xs text-muted-foreground">Final URL</div>
                  <div className="mt-1 font-mono text-xs break-all">{final || "Add a URL or deep link to see the final destination."}</div>
                </div>
              </FieldSet>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="cr-cta">Call to action</FieldLabel>
                  <Input id="cr-cta" maxLength={30} value={w.cta} onChange={(e) => set({ cta: e.target.value })} placeholder={DEFAULT_CTA} />
                  <div className="flex flex-wrap gap-1.5">
                    {CTA_SUGGESTIONS.map((s) => (
                      <Button key={s} type="button" variant={w.cta === s ? "secondary" : "outline"} size="xs" onClick={() => set({ cta: s })}>{s}</Button>
                    ))}
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="cr-alt">Alt text</FieldLabel>
                  <Input id="cr-alt" maxLength={200} value={w.alt} onChange={(e) => set({ alt: e.target.value })} placeholder="Describe the image for screen readers" />
                  <FieldDescription>{F === "banner" || F === "web_display" ? "Required for this format." : "Recommended."}</FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          )}

          {step === 5 && (
            <div className="grid gap-6 py-2 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                {failing.length ? (
                  <Alert>
                    <CircleAlert className="text-amber-600" />
                    <AlertTitle>{failing.length} check{failing.length > 1 ? "s" : ""} failing</AlertTitle>
                    <AlertDescription>{liveEdit ? "Saving now moves the creative back to Draft, so it stops serving until it’s fixed and resubmitted." : "You can still save a Draft and finish later."}</AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <Check className="text-emerald-600" />
                    <AlertTitle>All checks pass</AlertTitle>
                    <AlertDescription>{liveEdit ? "Saving keeps it serving with the new version." : canApprove ? "Save as Ready to use it in campaigns." : "Submit it for review; an admin approves it for campaigns."}</AlertDescription>
                  </Alert>
                )}
                <CheckList checks={checks} />
              </div>
              <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/30 p-4">
                <div className="text-sm font-medium">Summary</div>
                <KeyValue
                  items={[
                    { k: "Name", v: w.name || "—" },
                    { k: "Format", v: F_LABEL || "—" },
                    { k: "Size", v: <span className="font-mono text-xs">{content.size ? sizeLabel(content.size) : "—"}</span> },
                    { k: "Asset", v: w.asset ? <span className="font-mono text-xs break-all">{w.asset.name}</span> : "—" },
                    { k: "Destination", v: w.url || w.deepLink ? <span className="font-mono text-xs break-all">{w.deepLink || w.url}</span> : "—" },
                    { k: "CTA", v: w.cta || (F === "native" ? "—" : <span className="text-muted-foreground">{DEFAULT_CTA} (default)</span>) },
                  ]}
                />
                {existing && (
                  <Field>
                    <FieldLabel htmlFor="cr-note" className="text-xs text-muted-foreground">Version note (optional)</FieldLabel>
                    <Input id="cr-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. New headline for the final" />
                  </Field>
                )}
              </div>
            </div>
          )}

          {showErr && err && step !== 4 && (
            <p className="pb-2 text-sm text-destructive" role="alert">{err}</p>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-2 border-t py-3">
          {step > 1 ? (
            <Button variant="outline" onClick={() => goStep(step - 1)}><ArrowLeft /> Back</Button>
          ) : (
            <Button variant="ghost" onClick={() => guarded.push(cancelHref)}>Cancel</Button>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {liveEdit ? (
              (step < 5) && <Button variant="ghost" onClick={() => save("keep")} disabled={saving || !!uploading}><Save /> Save changes</Button>
            ) : (
              (step > 1 || existing) && <Button variant={step === 5 ? "outline" : "ghost"} onClick={() => save("draft")} disabled={saving || !!uploading}>{saving && step < 5 ? <Loader2 className="animate-spin" /> : <Save />} Save as Draft</Button>
            )}
            {step < 5 ? (
              <Button onClick={next}>Continue <ArrowRight /></Button>
            ) : liveEdit ? (
              <Button onClick={() => save("keep")} disabled={saving || !!uploading}>{saving ? <Loader2 className="animate-spin" /> : <Check />} Save changes</Button>
            ) : (
              <Button onClick={() => save("submit")} disabled={failing.length > 0 || saving || !!uploading} title={failing.length ? "Fix the failing checks first" : undefined}>
                {saving ? <Loader2 className="animate-spin" /> : canApprove ? <Check /> : <Send />} {submitLabel}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </PageContainer>
  )
}

function AssetRow({ asset, color, onRemove, label = "Remove asset" }: { asset: Asset; color: string; onRemove: () => void; label?: string }) {
  const video = asset.kind === "video"
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/30 p-3">
      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md" style={{ backgroundColor: color }} aria-hidden>
        {!video && /^https?:/.test(asset.url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt="" className="size-full object-cover" onError={(e) => { e.currentTarget.style.display = "none" }} />
        ) : video ? <FileVideo className="size-4 text-white" /> : <FileImage className="size-4 text-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs font-medium">{asset.name}</div>
        <div className="text-xs text-muted-foreground">
          {fileSize(asset.bytes)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}{asset.durationSec ? ` · ${Math.round(asset.durationSec)}s` : ""}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={label}><Trash2 /></Button>
    </div>
  )
}

function Counter({ n, max }: { n: number; max?: number }) {
  return <span className={cn("font-mono text-xs tabular-nums text-muted-foreground", max && n > max && "font-semibold text-destructive")}>{max ? `${n} / ${max}` : n}</span>
}

function CheckField({ id, checked, onChange, label, description }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
    </Field>
  )
}
