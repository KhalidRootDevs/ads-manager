"use client"

import { ApiError, useApi, useApiMutation, useApiQuery } from "@orbit/api-client/react"
import {
  LIVE_CAMPAIGN_STATUSES, quarterOf, teamBudgetLeft, todayKey, zCampaignInput,
  type Campaign, type CampaignInput, type CampaignStatus, type ValidationCtx, type ValidationResult,
} from "@orbit/domain"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, Loader2, Lock, Save, Send, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { StepCountries } from "@/components/campaigns/wizard-step-countries"
import { StepPlacements } from "@/components/campaigns/wizard-step-placements"
import { StepReview, type ReviewResult } from "@/components/campaigns/wizard-step-review"
import { StepBudget, StepConstraints, type TeamInfo } from "@/components/campaigns/wizard-steps-delivery"
import { StepBasics, StepCreatives, StepProperties } from "@/components/campaigns/wizard-steps-setup"
import {
  byStep, changedKeys, emptyForm, exampleForm, formFrom, inputErrors, LAST_STEP, localValidation, STEPS, toInput, WIZ_TOAST,
  type FormUpdate, type StepProps, type WizardForm,
} from "@/components/campaigns/wizard-state"
import { confirm } from "@/components/confirm-dialog"
import { Stepper } from "@/components/domain/widgets"
import { useDirty, useGuardedRouter } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { ScreenState } from "@/components/screen-state"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { fmt } from "@/lib/format"
import { toastError, useCan, useIndex, useLookups, useMe, useSettings } from "@/lib/hooks"
import { useUi } from "@/lib/ui-store"

const STEP_TOAST = "campaign-wizard-step"

/** Value that follows `value` after it has been stable for `ms`. */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Loads the reference data the wizard needs, then mounts the form. */
export function CampaignWizard({ campaign, initialStep }: { campaign?: Campaign; initialStep?: number }) {
  const ix = useIndex()
  const settings = useSettings()
  const me = useMe()
  const qc = useQueryClient()
  const indexQuery = { isPending: !ix.ready && !ix.isError, isError: ix.isError, refetch: () => qc.invalidateQueries() }
  const canWrite = useCan("campaigns.write")
  const backHref = campaign ? `/campaigns/${campaign.id}` : "/campaigns"
  const queries = [indexQuery, settings, me]
  if (queries.some((q) => q.isPending || q.isError))
    return (
      <PageContainer>
        <ScreenState query={queries} loading={<><Skeleton className="h-16 w-full max-w-md" /><Skeleton className="h-10 w-full" /><Skeleton className="h-96 w-full" /></>}>{null}</ScreenState>
      </PageContainer>
    )
  return (
    <>
      {!canWrite ? (
        <Blocked backHref={backHref} title="You can’t edit campaigns" description="Your role can view campaigns but not create or change them. Ask an admin or campaign manager for access." />
      ) : campaign && (campaign.status === "archived" || campaign.status === "completed") ? (
        <Blocked
          backHref={backHref}
          title={campaign.status === "archived" ? "Restore this campaign to edit it" : "Completed campaigns can’t be edited"}
          description={campaign.status === "archived" ? "Archived campaigns are read-only. Restore it as a draft from the campaign page, then edit." : "Duplicate it as a draft to run it again with changes."}
        />
      ) : (
        <Wizard campaign={campaign} initialStep={initialStep} defaultTz={settings.data?.reportingTz ?? "Asia/Dhaka"} />
      )}
    </>
  )
}

function Blocked({ backHref, title, description }: { backHref: string; title: string; description: string }) {
  return (
    <PageContainer>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Lock /></EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button asChild variant="outline"><Link href={backHref}>Go back</Link></Button></EmptyContent>
      </Empty>
    </PageContainer>
  )
}

interface Saved { id: string; rev: number; status: CampaignStatus; name: string }

function Wizard({ campaign, initialStep, defaultTz }: { campaign?: Campaign; initialStep?: number; defaultTz: string }) {
  const router = useRouter()
  const guarded = useGuardedRouter()
  const api = useApi()
  const qc = useQueryClient()
  const ix = useIndex()
  const { propById, crById, plcById, countries } = ix
  const lookups = useLookups()
  const canPublish = useCan("campaigns.publish")
  const canTarget = useCan("campaigns.targeting")
  const canCreative = useCan("creatives.write")
  const quarter = quarterOf(todayKey())
  // Non-archived campaigns: creative usage counts and the team-budget allocation (live ones).
  const others = useApiQuery("listCampaigns", { query: { limit: 100 } })
  const budgets = useApiQuery("listBudgets", { query: { quarter } })
  const createM = useApiMutation("createCampaign")
  const patchM = useApiMutation("patchCampaign")
  const publishM = useApiMutation("publishCampaign")

  const [form, setForm] = useState<WizardForm>(() => (campaign ? formFrom(campaign) : emptyForm(defaultTz)))
  const [ui, setUi] = useState(() => {
    const step = Math.min(LAST_STEP, Math.max(1, initialStep ?? 1))
    return { step, maxStep: campaign ? LAST_STEP : step, showErr: false }
  })
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(() => (campaign ? { id: campaign.id, rev: campaign.rev, status: campaign.status, name: campaign.name } : null))
  const [baseline, setBaseline] = useState<CampaignInput | null>(() => (campaign ? toInput(formFrom(campaign), campaign.team, plcById) : null))
  const [busy, setBusy] = useState<null | "draft" | "publish" | "creative">(null)
  /** Result of the server's check after a blocked publish, for the payload it was computed on. */
  const [blocked, setBlocked] = useState<{ json: string; result: ValidationResult } | null>(null)
  useDirty(dirty)

  const update: FormUpdate = (p) => {
    setForm((f) => ({ ...f, ...(typeof p === "function" ? p(f) : p) }))
    setDirty(true)
  }

  const editId = saved?.id
  const team = propById[form.propIds[0]]?.team ?? campaign?.team ?? "Sports"
  const payload = useMemo(() => toInput(form, team, plcById), [form, team, plcById])
  const payloadJson = JSON.stringify(payload)

  // ---------- team budget (instant feedback; the API's validation carries the same warning) ----------
  const teamInfo = useMemo<TeamInfo | null>(() => {
    if (!budgets.data || !others.data) return null
    const b = budgets.data.items.find((x) => x.team === team)
    const live = others.data.items.filter((c) => LIVE_CAMPAIGN_STATUSES.includes(c.status))
    const r = teamBudgetLeft(b?.amountMicros ?? 0, live, team, editId)
    return { quarter, totalMicros: b ? b.amountMicros : null, allocatedMicros: r.allocated, leftMicros: r.left }
  }, [budgets.data, others.data, team, editId, quarter])

  const usage = useMemo(() => {
    const m: Record<string, number> = {}
    others.data?.items.forEach((c) => { if (c.id !== editId) c.creativeIds.forEach((id) => { m[id] = (m[id] ?? 0) + 1 }) })
    return m
  }, [others.data, editId])

  // ---------- validation: local (instant) ----------
  const vctx = useMemo<ValidationCtx>(() => ({
    otherNames: (lookups.data?.campaigns ?? []).filter((c) => c.id !== editId && c.status !== "archived").map((c) => c.name),
    properties: propById, placements: plcById, creatives: crById, countries,
    teamLeftMicros: teamInfo?.totalMicros != null ? teamInfo.leftMicros : null,
  }), [lookups.data, editId, propById, plcById, crById, countries, teamInfo])
  const local = useMemo(() => localValidation(form, payload, vctx), [form, payload, vctx])
  const errors = useMemo(() => byStep(local.errors), [local.errors])

  // ---------- validation: server (authoritative), debounced, on the Review step ----------
  const shapeOk = useMemo(() => !inputErrors(form).length && zCampaignInput.safeParse(payload).success, [form, payload])
  const debounced = useDebounced(payloadJson, 400)
  const onReview = ui.step === LAST_STEP
  const serverCheck = useApiQuery(
    "validateDraft",
    onReview && shapeOk && debounced === payloadJson ? { body: { ...(JSON.parse(debounced) as CampaignInput), ...(editId ? { id: editId } : {}) } } : null,
    { staleTime: 5_000, retry: false },
  )
  const review: ReviewResult = useMemo(() => {
    if (blocked && blocked.json === payloadJson) return { ...blocked.result, source: "server", checking: false }
    const fresh = serverCheck.data && !serverCheck.isFetching && debounced === payloadJson && shapeOk
    if (fresh) {
      // Form-input errors never reach the server, so they are always local.
      return { errors: serverCheck.data!.errors, warnings: serverCheck.data!.warnings, source: "server", checking: false }
    }
    return { errors: local.errors, warnings: local.warnings, source: "local", checking: onReview && shapeOk && (serverCheck.isFetching || debounced !== payloadJson) }
  }, [blocked, payloadJson, serverCheck.data, serverCheck.isFetching, debounced, shapeOk, local, onReview])

  const future = form.start > todayKey(form.tz)
  const status = saved?.status
  const serving = status === "active" || status === "scheduled"
  const isLive = !!status && LIVE_CAMPAIGN_STATUSES.includes(status)
  const publishLabel = status === "paused" ? "Publish and resume" : future ? (isLive ? "Publish changes" : "Schedule campaign") : isLive ? "Publish changes" : "Publish campaign"
  const draftLabel = status === "paused" ? "Save changes" : "Save draft"
  const backHref = saved ? `/campaigns/${saved.id}` : "/campaigns"

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" })
  const goStep = (n: number, showErr = false) => {
    setUi((u) => ({ ...u, step: n, maxStep: Math.max(u.maxStep, n), showErr: showErr || u.showErr }))
    scrollTop()
  }

  /** Scroll to the inline error list and focus the first invalid control once it has rendered. */
  const revealErrors = () => {
    setTimeout(() => {
      const root = document.getElementById("cw-step")
      const target = root?.querySelector<HTMLElement>("[aria-invalid=true]") ?? root?.querySelector<HTMLElement>("[data-step-errors]")
      target?.scrollIntoView({ behavior: "smooth", block: "center" })
      target?.focus({ preventScroll: true })
    }, 60)
  }

  const next = () => {
    if (errors[ui.step]?.length) {
      // Inline errors explain the problem; a toast here would cover the Continue button.
      setUi((u) => ({ ...u, showErr: true }))
      revealErrors()
      return
    }
    toast.dismiss(STEP_TOAST)
    const n = Math.min(LAST_STEP, ui.step + 1)
    setUi((u) => ({ step: n, maxStep: Math.max(u.maxStep, n), showErr: false }))
    scrollTop()
  }
  const back = () => { setUi((u) => ({ ...u, step: Math.max(1, u.step - 1) })); scrollTop() }

  const loadExample = async () => {
    if (dirty && !(await confirm({ title: "Replace your changes with the example?", description: "The example campaign overwrites what you’ve entered so far.", confirmLabel: "Load example" }))) return
    const { form: ex, missing } = exampleForm(emptyForm(defaultTz), ix)
    setForm(ex)
    setDirty(true)
    setUi({ step: 1, maxStep: LAST_STEP, showErr: false })
    toast.success("Example loaded", {
      ...WIZ_TOAST,
      description: missing.length ? `Not found in this workspace, so left out: ${missing.join(", ")}.` : "One banner on three apps, each with different country targeting.",
    })
  }

  /** Drafts only need a valid name, dates and well-formed numbers; jumps to the first problem and explains it. */
  const draftOk = () => {
    const problems = [
      ...local.errors.filter((x) => x.key === "name" || ((x.key === "start" || x.key === "end") && (!form.start || !form.end))),
      ...inputErrors(form),
    ].sort((a, b) => a.step - b.step)
    if (!problems.length) return true
    const first = problems[0]
    setUi((u) => ({ ...u, step: first.step, maxStep: Math.max(u.maxStep, first.step), showErr: true }))
    toast.error(first.key === "name" ? "Give the campaign a valid name before saving." : "Fix this before saving.", { ...WIZ_TOAST, description: first.message, id: STEP_TOAST })
    revealErrors()
    return false
  }

  const markClean = () => {
    setDirty(false)
    useUi.getState().setDirty(false)
  }

  /** Create or patch (changed keys only). Returns the saved state, or null when the user must act first. */
  const persist = async (cur: Saved | null): Promise<Saved | null> => {
    try {
      let c: Campaign
      if (cur && baseline) {
        const changes = changedKeys(baseline, payload)
        if (!Object.keys(changes).length) return cur
        c = await patchM.mutateAsync({ params: { id: cur.id }, body: { ...changes, rev: cur.rev } })
      } else {
        c = await createM.mutateAsync({ body: payload })
      }
      const next: Saved = { id: c.id, rev: c.rev, status: c.status, name: c.name }
      setSaved(next)
      setBaseline(payload)
      return next
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "duplicate") {
        setUi((u) => ({ ...u, step: 1, showErr: true }))
        toast.error("That name is taken", { ...WIZ_TOAST, description: e.message })
        return null
      }
      if (e instanceof ApiError && e.status === 409 && e.current && cur) {
        toastError(e)
        const latest = e.current as Campaign
        const apply = await confirm({
          title: "Someone else changed this campaign",
          description: `It was updated ${fmt.ago(latest.updatedAt)}. Apply only the fields you changed on top of the latest version, or load the latest version and discard your changes.`,
          confirmLabel: "Apply my changes",
          cancelLabel: "Load latest",
        })
        if (apply) {
          const rebased = { ...cur, rev: latest.rev, status: latest.status }
          setSaved(rebased)
          return persist(rebased)
        }
        setForm(formFrom(latest))
        setBaseline(toInput(formFrom(latest), latest.team, plcById))
        setSaved({ id: latest.id, rev: latest.rev, status: latest.status, name: latest.name })
        markClean()
        void qc.invalidateQueries({ queryKey: ["campaigns"] })
        return null
      }
      toastError(e)
      return null
    }
  }

  const saveDraft = async () => {
    if (!draftOk()) return
    setBusy("draft")
    try {
      const s = await persist(saved)
      if (!s) return
      markClean()
      toast.success(s.status === "draft" ? "Draft saved" : "Changes saved", { description: s.status === "draft" ? "Nothing serves until you publish it." : "They go live when you publish." })
      router.push(`/campaigns/${s.id}`)
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    const reviewBlocks = review.source === "server" ? review.errors : local.errors
    if (local.errors.length || reviewBlocks.length) {
      setUi({ step: LAST_STEP, maxStep: LAST_STEP, showErr: true })
      toast.error("Resolve the issues listed in Review before publishing.", { ...WIZ_TOAST, id: STEP_TOAST })
      scrollTop()
      return
    }
    setBusy("publish")
    try {
      const s = await persist(saved)
      if (!s) return
      try {
        const pub = await publishM.mutateAsync({ params: { id: s.id }, body: { rev: s.rev } })
        setSaved({ id: pub.id, rev: pub.rev, status: pub.status, name: pub.name })
        markClean()
        toast.success(
          pub.status === "scheduled" ? `Scheduled for ${fmt.date(pub.flight.start)}` : isLive ? "Changes published" : "Campaign published",
          { description: pub.status === "scheduled" ? "Delivery starts automatically on the start date." : "The ad server picks it up within a few seconds." },
        )
        router.push(`/campaigns/${pub.id}`)
      } catch (e) {
        // The draft is saved; publishing was refused.
        markClean()
        if (e instanceof ApiError && e.status === 422) {
          const result = await api.call("validateCampaign", { params: { id: s.id } }).catch(() => null)
          if (result) setBlocked({ json: payloadJson, result })
          setUi({ step: LAST_STEP, maxStep: LAST_STEP, showErr: true })
          toast.error("Saved, but not published", { ...WIZ_TOAST, description: e.message, id: STEP_TOAST })
          scrollTop()
        } else {
          toastError(e, "Saved, but couldn’t publish")
          void qc.invalidateQueries({ queryKey: ["campaigns"] })
        }
      }
    } finally {
      setBusy(null)
    }
  }

  /** Leave for the creative wizard without losing work: save first, then come back to step 2. */
  const newCreative = async () => {
    const backTo = (id: string) => `/creatives/new?returnTo=${encodeURIComponent(`/campaigns/${id}/edit?step=2`)}`
    if (saved && !dirty) return router.push(backTo(saved.id))
    if (serving) {
      // Saving a serving campaign would change live delivery without validation, so only offer to leave.
      return void guarded.push(backTo(saved!.id))
    }
    if (!draftOk()) return
    const ok = await confirm({
      title: saved?.status === "paused" ? "Save your changes first?" : "Save this campaign as a draft first?",
      description: "Creating a creative opens a new page. Your campaign is saved and you come back to the Creatives step afterwards. Nothing new serves until you publish.",
      confirmLabel: "Save and continue",
    })
    if (!ok) return
    setBusy("creative")
    try {
      const s = await persist(saved)
      if (!s) return
      markClean()
      toast.success("Saved", { description: "Create the creative, then pick it on the Creatives step." })
      router.push(backTo(s.id))
    } finally {
      setBusy(null)
    }
  }

  const errorSteps = ui.showErr ? Object.keys(errors).map(Number).filter((n) => n <= ui.maxStep) : []
  const stepProps: StepProps = {
    form, update, errors, showErr: ui.showErr, editId, goStep, canTarget,
    onNewCreative: canCreative ? () => void newCreative() : undefined,
  }
  const pending = busy !== null
  const showDraft = !serving

  return (
    <PageContainer className="pb-0 md:pb-0 lg:pb-0">
      <PageHeader
        backHref={backHref}
        backLabel={saved ? saved.name : "Campaigns"}
        title={campaign ? "Edit campaign" : "New campaign"}
        description={`Step ${ui.step} of ${LAST_STEP} · ${STEPS[ui.step - 1]}${dirty ? " · Unsaved changes" : ""}`}
        actions={
          <>
            {!campaign && <Button variant="outline" onClick={() => void loadExample()} disabled={pending}><Sparkles /> Load example</Button>}
            {showDraft && <Button variant="outline" onClick={() => void saveDraft()} disabled={pending}>{busy === "draft" ? <Loader2 className="animate-spin" /> : <Save />} {draftLabel}</Button>}
            <Button variant="ghost" onClick={() => void guarded.push(backHref)}>Cancel</Button>
          </>
        }
      />

      <Stepper steps={[...STEPS]} current={ui.step} maxStep={ui.maxStep} errorSteps={errorSteps} onStep={(n) => goStep(n)} />

      <div id="cw-step" className="min-w-0">
        {ui.step === 1 && <StepBasics {...stepProps} />}
        {ui.step === 2 && <StepCreatives {...stepProps} usage={usage} />}
        {ui.step === 3 && <StepProperties {...stepProps} />}
        {ui.step === 4 && <StepCountries {...stepProps} />}
        {ui.step === 5 && <StepPlacements {...stepProps} />}
        {ui.step === 6 && <StepConstraints {...stepProps} />}
        {ui.step === 7 && <StepBudget {...stepProps} team={team} teamInfo={teamInfo} />}
        {ui.step === 8 && <StepReview {...stepProps} review={review} future={future} canPublish={canPublish} />}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-2 flex items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
        <Button variant="outline" onClick={back} disabled={ui.step === 1} aria-label="Back"><ArrowLeft /> <span className="hidden sm:inline">Back</span></Button>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {ui.step < LAST_STEP ? (
            <Button onClick={next}>Continue <ArrowRight /></Button>
          ) : (
            <>
              {showDraft && (
                <Button variant="outline" onClick={() => void saveDraft()} disabled={pending} aria-label={status === "paused" ? "Save changes" : "Save as draft"}>
                  {busy === "draft" ? <Loader2 className="animate-spin" /> : <Save />} <span className="sm:hidden">{status === "paused" ? "Save" : "Draft"}</span><span className="hidden sm:inline">{status === "paused" ? "Save changes" : "Save as draft"}</span>
                </Button>
              )}
              {canPublish && <Button onClick={() => void publish()} disabled={pending}>{busy === "publish" ? <Loader2 className="animate-spin" /> : <Send />} {publishLabel}</Button>}
            </>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
