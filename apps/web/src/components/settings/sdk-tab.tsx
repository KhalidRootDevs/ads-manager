"use client"

import { useApiMutation, useApiQuery } from "@orbit/api-client/react"
import { PLATFORM_LABEL, PLATFORMS, SDK_STATE_LABEL, type Platform, type PropertyEnv, type RequestSample } from "@orbit/domain"
import { Send } from "lucide-react"
import { useState } from "react"
import { KeyValue } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { CodeBlock, CopyField } from "@/components/properties/code-block"
import { ENDPOINTS, maskKey, serveSnippet, snippet, snippetLang } from "@/components/properties/property-utils"
import { ScreenState } from "@/components/screen-state"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { fmt } from "@/lib/format"
import { toastError, useCan, useIndex, useProperties } from "@/lib/hooks"

type Lang = Platform | "http"
const LANGS: { value: Lang; label: string }[] = [
  { value: "android", label: "Android · Kotlin" },
  { value: "ios", label: "iOS · Swift" },
  { value: "web", label: "Web tag" },
  { value: "http", label: "HTTP" },
]

export function SdkTab() {
  const props = useProperties()
  return (
    <ScreenState
      query={props}
      isEmpty={(props.data ?? []).length === 0}
      empty={{ icon: <Send />, title: "No apps or websites yet", description: "Register an app or website first; its integration details appear here." }}
      loading={<Skeleton className="h-96" />}
    >
      <SdkInner />
    </ScreenState>
  )
}

function SdkInner() {
  const { properties, propById, placements } = useIndex()
  const canTest = useCan("properties.write")
  const [propId, setPropId] = useState(properties[0]?.id ?? "")
  const [env, setEnv] = useState<PropertyEnv>("production")
  const sp = propById[propId] ?? properties[0]
  const [lang, setLang] = useState<Lang>(sp?.platform ?? "android")
  const [log, setLog] = useState<RequestSample[]>([])
  const keys = useApiQuery("listKeys", sp ? { params: { id: sp.id } } : null, { select: (r) => r.items })
  const test = useApiMutation("testRequest", {
    onSuccess: (s) => setLog((l) => [s, ...l].slice(0, 6)),
    onError: (e) => toastError(e, "Test request failed"),
  })

  if (!sp) return null
  const envKey = env === "production" ? "live" : "test"
  const key = (keys.data ?? []).find((k) => k.status === "active" && k.env === envKey) ?? (keys.data ?? []).find((k) => k.status === "active")
  const first = placements.find((x) => x.propertyId === sp.id)
  const testMode = env !== "production" || sp.testMode
  const pickProp = (id: string) => { setPropId(id); setLang(propById[id]?.platform ?? "android") }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>Endpoint and credentials for one app or website.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="sdk-prop">Property</FieldLabel>
              <Select value={sp.id} onValueChange={pickProp}>
                <SelectTrigger id="sdk-prop" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((g) => {
                    const list = properties.filter((p) => p.platform === g)
                    return list.length ? (
                      <SelectGroup key={g}>
                        <SelectLabel>{g === "web" ? "Websites" : `${PLATFORM_LABEL[g]} apps`}</SelectLabel>
                        {list.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectGroup>
                    ) : null
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel id="sdk-env-label">Environment</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={env} onValueChange={(v) => v && setEnv(v as PropertyEnv)} aria-labelledby="sdk-env-label" className="w-full sm:w-fit">
                <ToggleGroupItem value="production" className="flex-1 px-3 sm:flex-none">Production</ToggleGroupItem>
                <ToggleGroupItem value="staging" className="flex-1 px-3 sm:flex-none">Staging</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Endpoint · {env}</span>
              <CopyField value={ENDPOINTS[env]} label="Endpoint" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">{sp.platform === "web" ? "Site ID (public)" : "App ID (public)"}</span>
              <CopyField value={sp.id} label={sp.platform === "web" ? "Site ID" : "App ID"} />
            </div>
            <KeyValue
              items={[
                {
                  k: `SDK key · ${envKey}`,
                  v: (
                    <span className="flex flex-col items-end gap-0.5">
                      {keys.isPending ? <Skeleton className="h-4 w-40" /> : <code className="font-mono text-xs break-all">{key ? maskKey(key) : "No active key"}</code>}
                      <GuardedLink href={`/properties/${sp.id}?tab=credentials`} className="text-xs font-normal text-primary hover:underline">Manage keys</GuardedLink>
                    </span>
                  ),
                },
                { k: "SDK status", v: <StatusBadge status={SDK_STATE_LABEL[sp.sdk.state]} /> },
                { k: "SDK version", v: sp.sdk.version ?? "—" },
                { k: "Last heartbeat", v: <span title={fmt.dateTime(sp.sdk.lastHeartbeatAt)}>{fmt.ago(sp.sdk.lastHeartbeatAt)}</span> },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Test requests</CardTitle>
            <CardDescription>Send a test ad request for {sp.name} through the ad server and see what came back.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {canTest ? (
              <Button variant="outline" onClick={() => test.mutate({ params: { id: sp.id } })} disabled={test.isPending} className="w-full sm:w-fit"><Send /> {test.isPending ? "Sending…" : "Send test request"}</Button>
            ) : (
              <p className="text-sm text-muted-foreground">Developers, Admins and Owners can send test requests.</p>
            )}
            {log.length ? (
              <ul className="divide-y rounded-lg border" aria-live="polite">
                {log.map((r) => (
                  <li key={r.at + r.result} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{r.placementName ?? "Any placement"} · {r.country}</div>
                      <div className="font-mono text-xs text-muted-foreground">{new Date(r.at).toTimeString().slice(0, 8)}</div>
                    </div>
                    <StatusBadge status={`${r.result} · ${r.latencyMs} ms`} tone={r.result.startsWith("200") ? "success" : r.result.startsWith("204") ? "info" : "danger"} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No test requests sent in this session.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 lg:col-span-3">
        <CardHeader>
          <CardTitle>Sample snippets</CardTitle>
          <CardDescription>
            Pre-filled for {sp.name}{testMode ? " with test mode on" : ""}.{!first && " Replace plc_xxx with a placement ID."} The SDK key comes from your app’s own config.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)} className="min-w-0 gap-3">
            <div className="overflow-x-auto">
              <TabsList className="w-max">
                {LANGS.map((l) => <TabsTrigger key={l.value} value={l.value} className="px-3">{l.label}</TabsTrigger>)}
              </TabsList>
            </div>
            {LANGS.map((l) => (
              <TabsContent key={l.value} value={l.value} className="min-w-0">
                {l.value === "http"
                  ? <CodeBlock code={serveSnippet({ ...sp, testMode }, first)} lang="Shell" />
                  : <CodeBlock code={snippet({ id: sp.id, platform: l.value, testMode }, first)} lang={snippetLang(l.value)} />}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
