"use client"

import { ApiError, useApiMutation } from "@orbit/api-client/react"
import {
  availSet, FORMAT_LABEL, PLATFORM_LABEL, PROPERTY_ENV_LABEL, zPropertyCreate, type AdFormat, type CountryMode, type Platform, type PropertyEnv,
} from "@orbit/domain"
import { ArrowLeft, ArrowRight, Check, Code2, Globe, LayoutTemplate, Loader2, ShieldAlert, Smartphone, TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { CountryRuleEditor } from "@/components/domain/targeting"
import { KeyValue, Stepper } from "@/components/domain/widgets"
import { GuardedLink, useDirty, useGuardedRouter } from "@/components/nav-guard"
import { PageContainer, PageHeader } from "@/components/page-header"
import { CopyField } from "@/components/properties/code-block"
import { FormatPicker } from "@/components/properties/format-picker"
import { defaultFormatsFor, formatsFor, TEAMS } from "@/components/properties/property-utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toastError, useCan, useCountries, useIndex, useMe, useProperties } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const STEPS = ["Platform & identity", "Formats & countries", "Review", "Credentials"]

interface Draft {
  platform: Platform
  name: string
  identifier: string
  env: PropertyEnv
  team: string
  formats: AdFormat[]
  mode: CountryMode
  list: string[]
}
const INITIAL: Draft = { platform: "android", name: "", identifier: "", env: "production", team: "Sports", formats: defaultFormatsFor("android"), mode: "all", list: [] }

const TYPES: { platform: Platform; icon: typeof Smartphone; desc: string }[] = [
  { platform: "android", icon: Smartphone, desc: "Android app with the Orbit SDK" },
  { platform: "ios", icon: Smartphone, desc: "iOS app with the Orbit SDK" },
  { platform: "web", icon: Globe, desc: "Website with the Orbit web tag" },
]

interface Created { id: string; name: string; platform: Platform; secret: string; keyLabel: string }

export default function NewPropertyPage() {
  const canWrite = useCan("properties.write")
  if (!canWrite)
    return (
      <PageContainer className="max-w-4xl">
        <Empty className="mt-8 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ShieldAlert /></EmptyMedia>
            <EmptyTitle>You can’t register properties</EmptyTitle>
            <EmptyDescription>Ask an owner, admin or developer to add the app or website, or to change your role.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button asChild variant="outline"><GuardedLink href="/properties">Back to apps & websites</GuardedLink></Button></EmptyContent>
        </Empty>
      </PageContainer>
    )
  return <Wizard />
}

function Wizard() {
  const props = useProperties().data ?? []
  const countries = useCountries().data ?? []
  const me = useMe().data?.user
  const { ctryByCode } = useIndex()
  const guarded = useGuardedRouter()
  const router = useRouter()
  const [w, setW] = useState<Draft>(INITIAL)
  const [step, setStep] = useState(1)
  const [reached, setReached] = useState(1)
  const [showErr, setShowErr] = useState<Record<number, boolean>>({})
  const [serverErr, setServerErr] = useState<{ field: "identifier" | "name" | null; message: string } | null>(null)
  // The secret only ever lives in this component's state, and only until the page is left.
  const [created, setCreated] = useState<Created | null>(null)
  const [ack, setAck] = useState(false)

  const set = (patch: Partial<Draft>) => { setW((x) => ({ ...x, ...patch })); setServerErr(null) }
  const dirty = !created && JSON.stringify(w) !== JSON.stringify(INITIAL)
  // Also guard leaving the one-time credentials screen before the secret is confirmed as copied.
  useDirty(dirty || (!!created && !ack), created && !ack ? { title: "Leave without saving the key?", description: "The full SDK key is only shown on this screen. If you leave now you’ll have to rotate it to get a new one." } : undefined)

  const body = {
    name: w.name.trim(), platform: w.platform, identifier: w.identifier.trim(), team: w.team, env: w.env, formats: w.formats,
    countryRule: { mode: w.mode, countries: w.mode === "all" ? [] : w.list }, testMode: true,
  }

  // ----- validation: the shared schema first, then friendlier messages and uniqueness hints -----
  const parsed = zPropertyCreate.safeParse(body)
  const issue = (k: string) => (parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === k)?.message)
  const e: Partial<Record<"name" | "identifier" | "formats" | "list", string>> = {}
  const nm = body.name, id = body.identifier.toLowerCase()
  if (issue("name")) e.name = "Enter a name of at least 3 characters."
  else if (props.some((p) => p.name.toLowerCase() === nm.toLowerCase())) e.name = "A property with this name already exists."
  else if (serverErr?.field === "name") e.name = serverErr.message
  if (issue("identifier")) e.identifier = w.platform === "web" ? "Enter a domain like example.com (no https:// or path)." : `Enter a ${w.platform === "ios" ? "bundle ID" : "package name"} like com.company.app (lowercase, dot-separated).`
  else if (props.some((p) => p.platform === w.platform && p.identifier === id)) e.identifier = `This identifier is already registered as ${w.platform === "web" ? "a website" : `an ${PLATFORM_LABEL[w.platform]} app`}.`
  else if (serverErr?.field === "identifier") e.identifier = serverErr.message
  if (!w.formats.length || issue("formats")) e.formats = "Allow at least one ad format."
  if (w.mode !== "all" && !w.list.length) e.list = w.mode === "include" ? "Add at least one country, or choose “All enabled countries”." : "Add at least one country to exclude, or choose “All enabled countries”."
  const stepErr = (n: number) => (n === 1 ? !!(e.name || e.identifier) : n === 2 ? !!(e.formats || e.list) : false)
  const E = (k: keyof typeof e, n: number) => (showErr[n] ? e[k] : undefined)

  const go = (n: number) => { setStep(n); setReached((r) => Math.max(r, n)) }
  const next = () => {
    if (stepErr(step)) { setShowErr((s) => ({ ...s, [step]: true })); toast.error("Fix the highlighted fields first."); return }
    toast.dismiss()
    go(step + 1)
  }

  const isWeb = w.platform === "web"
  const identLabel = isWeb ? "Domain" : w.platform === "ios" ? "Bundle ID" : "Package name"
  const count = availSet(body.countryRule, countries).size

  const create = useApiMutation("createProperty", {
    onSuccess: (r) => {
      toast.dismiss()
      setCreated({ id: r.property.id, name: r.property.name, platform: r.property.platform, secret: r.testKey.secret, keyLabel: r.testKey.key.label })
      setStep(4)
      setReached(4)
      toast.success("Property registered. Copy the key now. It won’t be shown again.")
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.status === 409 || err.status === 400 || err.status === 422)) {
        const f = err.fieldErrors
        const field = err.status === 409 || f.identifier ? "identifier" : f.name ? "name" : null
        setServerErr({ field, message: field && f[field] ? f[field] : err.message })
        setShowErr({ 1: true, 2: true })
        if (field) setStep(1)
        toast.error("Couldn’t register the property", { description: err.message })
      } else toastError(err, "Couldn’t register the property")
    },
  })

  const register = () => {
    const bad = [1, 2].find(stepErr)
    if (bad || !parsed.success) { setShowErr({ 1: true, 2: true }); setStep(bad ?? 1); toast.error("Fix the highlighted fields first."); return }
    create.mutate({ body })
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        backHref="/properties"
        backLabel="Apps & websites"
        title="Add property"
        description="Register one of your company’s apps or websites so placements and campaigns can target it."
      />
      <Stepper
        steps={STEPS}
        current={step}
        maxStep={created ? 4 : Math.min(reached, 3)}
        onStep={(n) => { if (!created) setStep(n) }}
        errorSteps={created ? [] : [1, 2].filter((n) => showErr[n] && stepErr(n))}
      />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Platform & identity</CardTitle>
            <CardDescription>What are you registering, and who owns it?</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel id="ptype-label">Platform</FieldLabel>
                <div role="radiogroup" aria-labelledby="ptype-label" className="grid gap-2 sm:grid-cols-3">
                  {TYPES.map((t) => {
                    const on = w.platform === t.platform
                    return (
                      <button
                        key={t.platform}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => !on && set({ platform: t.platform, formats: defaultFormatsFor(t.platform) })}
                        className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50", on && "border-primary/50 bg-primary/5")}
                      >
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", on && "bg-primary text-primary-foreground")}><t.icon className="size-4" /></span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{PLATFORM_LABEL[t.platform]}</span>
                          <span className="block text-xs text-muted-foreground">{t.desc}</span>
                        </span>
                        {on && <Check className="ml-auto size-4 shrink-0 text-primary" />}
                      </button>
                    )
                  })}
                </div>
                <FieldDescription>Changing the platform resets the allowed formats to that platform’s defaults.</FieldDescription>
              </Field>
              <Field data-invalid={!!E("name", 1)}>
                <FieldLabel htmlFor="pw-name">Display name</FieldLabel>
                <Input id="pw-name" value={w.name} onChange={(ev) => set({ name: ev.target.value })} placeholder={isWeb ? "e.g. Cricket Live Web" : `e.g. Cricket Live ${PLATFORM_LABEL[w.platform]}`} aria-invalid={!!E("name", 1)} />
                {E("name", 1) ? <FieldError>{E("name", 1)}</FieldError> : <FieldDescription>Shown across campaigns, reports and placements. Must be unique.</FieldDescription>}
              </Field>
              <Field data-invalid={!!E("identifier", 1)}>
                <FieldLabel htmlFor="pw-ident">{identLabel}</FieldLabel>
                <Input id="pw-ident" className="font-mono" value={w.identifier} onChange={(ev) => set({ identifier: ev.target.value.trim().toLowerCase() })} placeholder={isWeb ? "example.com" : "com.company.app"} aria-invalid={!!E("identifier", 1)} autoCapitalize="none" spellCheck={false} />
                {E("identifier", 1) ? <FieldError>{E("identifier", 1)}</FieldError> : <FieldDescription>{isWeb ? "The site’s domain without https://. Subdomains are fine." : "Must match the identifier in your store listing."}</FieldDescription>}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="pw-env">Environment</FieldLabel>
                  <Select value={w.env} onValueChange={(v) => set({ env: v as PropertyEnv })}>
                    <SelectTrigger id="pw-env" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="staging">Staging</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pw-team">Owning team</FieldLabel>
                  <Select value={w.team} onValueChange={(v) => set({ team: v })}>
                    <SelectTrigger id="pw-team" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{TEAMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-between gap-2 border-t">
            <Button variant="outline" onClick={() => guarded.push("/properties")}>Cancel</Button>
            <Button onClick={next}>Continue <ArrowRight /></Button>
          </CardFooter>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Formats & countries</CardTitle>
            <CardDescription>Defaults for every placement and campaign on this property. You can change them later.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={!!E("formats", 2)}>
                <FieldLabel>Allowed ad formats</FieldLabel>
                <FormatPicker options={formatsFor(w.platform)} value={w.formats} onChange={(formats) => set({ formats })} invalid={!!E("formats", 2)} idPrefix="pw-fmt" />
                {E("formats", 2) && <FieldError>{E("formats", 2)}</FieldError>}
              </Field>
              <Field data-invalid={!!E("list", 2)}>
                <FieldLabel>Country availability</FieldLabel>
                <CountryRuleEditor mode={w.mode} countries={w.list} onChange={(x) => set({ mode: x.mode, list: x.countries })} labels={{ all: "All enabled countries", include: "Only these", exclude: "All except" }} />
                {E("list", 2) ? <FieldError>{E("list", 2)}</FieldError> : <FieldDescription>{w.mode !== "all" && `Accepts ads from ${count} ${count === 1 ? "country" : "countries"}. `}Campaign rules can narrow this but never widen it.</FieldDescription>}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="justify-between gap-2 border-t">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft /> Back</Button>
            <Button onClick={next}>Review <ArrowRight /></Button>
          </CardFooter>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>Check the details, then register the property to get its credentials.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <KeyValue
              items={[
                { k: "Platform", v: PLATFORM_LABEL[w.platform] },
                { k: "Display name", v: nm || "—" },
                { k: identLabel, v: <span className="font-mono text-xs break-all">{id || "—"}</span> },
                { k: "Environment", v: PROPERTY_ENV_LABEL[w.env] },
                { k: "Owning team", v: `${w.team} · owner ${me?.name ?? "you"}` },
                { k: "Allowed formats", v: <span className="flex flex-wrap justify-end gap-1">{w.formats.map((f) => <Badge key={f} variant="secondary" className="font-normal">{FORMAT_LABEL[f]}</Badge>)}</span> },
                {
                  k: "Countries",
                  v: w.mode === "all" ? `All enabled countries (${count})`
                    : `${w.mode === "include" ? "Only" : "All except"} ${w.list.slice(0, 6).map((c) => ctryByCode[c]?.name ?? c).join(", ")}${w.list.length > 6 ? ` +${w.list.length - 6}` : ""} · ${count} available`,
                },
              ]}
            />
            <Alert>
              <Code2 />
              <AlertTitle>Starts as Pending with test mode on</AlertTitle>
              <AlertDescription>No live ads serve until the {isWeb ? "web tag" : "SDK"} sends its first request and you turn test mode off. A test SDK key is created for you.</AlertDescription>
            </Alert>
            {serverErr && !serverErr.field && <FieldError>{serverErr.message}</FieldError>}
          </CardContent>
          <CardFooter className="justify-between gap-2 border-t">
            <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft /> Back</Button>
            <Button onClick={register} disabled={create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Check />} Register property</Button>
          </CardFooter>
        </Card>
      )}

      {step === 4 && created && (
        <Card>
          <CardHeader>
            <CardTitle>Credentials for {created.name}</CardTitle>
            <CardDescription>The property is registered. Add these to your {created.platform === "web" ? "site" : "app"} configuration.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <TriangleAlert />
              <AlertTitle>Copy the secret key now</AlertTitle>
              <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">It’s shown only once. After you leave this page only its last 4 characters are visible; you can rotate it from the Credentials tab if it’s lost. Create a live key there before launch.</AlertDescription>
            </Alert>
            <Field>
              <FieldLabel>{created.platform === "web" ? "Site ID (public)" : "App ID (public)"}</FieldLabel>
              <CopyField value={created.id} label={created.platform === "web" ? "Site ID" : "App ID"} />
            </Field>
            <Field>
              <FieldLabel>{created.keyLabel} (secret)</FieldLabel>
              <CopyField value={created.secret} label="Secret key" />
            </Field>
            <div className="flex items-start gap-2 rounded-lg border p-3">
              <Checkbox id="pw-ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
              <Label htmlFor="pw-ack" className="leading-snug font-normal">I’ve copied and stored the secret key somewhere safe</Label>
            </div>
          </CardContent>
          <CardFooter className="flex-col-reverse items-stretch justify-end gap-2 border-t sm:flex-row sm:items-center">
            <Button variant="outline" disabled={!ack} onClick={() => router.push(`/properties/${created.id}?tab=integration`)}><Code2 /> Go to integration steps</Button>
            <Button disabled={!ack} onClick={() => router.push(`/properties/${created.id}?tab=placements&new=placement`)}><LayoutTemplate /> Create first placement</Button>
          </CardFooter>
        </Card>
      )}
    </PageContainer>
  )
}
