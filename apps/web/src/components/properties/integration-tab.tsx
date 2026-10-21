"use client"

import { useApiMutation } from "@orbit/api-client/react"
import { PLATFORM_LABEL, PROPERTY_ENV_LABEL, type Property } from "@orbit/domain"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Send } from "lucide-react"
import { toast } from "sonner"
import { KeyValue } from "@/components/domain/widgets"
import { GuardedLink } from "@/components/nav-guard"
import { useMutationError } from "@/components/placements/placement-utils"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useCan, usePlacements } from "@/lib/hooks"
import { CodeBlock, CopyField } from "./code-block"
import { SERVE_URL, serveSnippet, snippet, snippetLang } from "./property-utils"

/**
 * "Send test request": calls the ad server through the API; the first success marks a property integrated.
 * The sample reaches Diagnostics through the event pipeline (ad server → stream → workers), so refetch a few times.
 */
export function useTestRequest(p: Property, onDone?: () => void) {
  const onError = useMutationError("properties")
  const qc = useQueryClient()
  return useApiMutation("testRequest", {
    onSuccess: (s) => {
      for (const ms of [2_000, 5_000, 10_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ["properties", "diagnostics"] }), ms)
      const goLive = p.sdk.state === "not_integrated"
      toast.success(goLive ? "Test request answered. The integration is now live." : `Test request answered in ${Math.round(s.latencyMs)} ms`, { description: s.result })
      onDone?.()
    },
    onError: (e) => onError(e, "Test request failed"),
  })
}

export function IntegrationTab({ p, onTab }: { p: Property; onTab: (t: string) => void }) {
  const canWrite = useCan("properties.write")
  const placements = usePlacements(p.id).data ?? []
  const first = placements.find((x) => x.status === "active") ?? placements[0]
  const isWeb = p.platform === "web"
  const onError = useMutationError("properties")
  const patch = useApiMutation("patchProperty", {
    onSuccess: (x) => { toast.success(x.testMode ? "Test mode on. Only test ads will serve." : "Test mode off. Live campaigns will serve.") },
    onError: (e) => onError(e),
  })
  const test = useTestRequest(p, () => onTab("diagnostics"))

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{isWeb ? "Add the web tag" : `Add the ${PLATFORM_LABEL[p.platform]} SDK`}</CardTitle>
            <CardDescription>
              {isWeb ? "Paste the tag once per page, then add a container where each placement should render." : "Install the package, initialize it at launch with your App ID and SDK key, then load a placement."}
              {first ? ` The snippet uses ${first.name}.` : " Replace plc_xxx with a placement ID once you create one."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={snippet(p, first)} lang={snippetLang(p.platform)} label="Snippet" />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Raw ad request</CardTitle>
            <CardDescription>What the {isWeb ? "tag" : "SDK"} sends, for custom or server-side integrations. Use a key from the Credentials tab; secrets are never shown here.</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock code={serveSnippet(p, first)} lang="Shell" label="Request" />
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Test the integration</CardTitle>
            <CardDescription>Send a request from Orbit to check that the ad server sees this {isWeb ? "site" : "app"}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="test-mode">Test mode</Label>
                <p className="text-xs text-muted-foreground">Serve only test ads. Nothing is counted or billed.</p>
              </div>
              <Switch id="test-mode" checked={patch.isPending ? !!patch.variables?.body.testMode : p.testMode} disabled={!canWrite || patch.isPending} onCheckedChange={(on) => patch.mutate({ params: { id: p.id }, body: { rev: p.rev, testMode: on } })} />
            </div>
            {canWrite && (
              <Button onClick={() => test.mutate({ params: { id: p.id } })} disabled={test.isPending}>
                {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send test request
              </Button>
            )}
            {p.sdk.state === "not_integrated" && <p className="text-xs text-muted-foreground">The first successful test request marks this property as integrated.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Connection details</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Endpoint</span>
              <CopyField value={SERVE_URL} label="Endpoint" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">{isWeb ? "Site ID" : "App ID"}</span>
              <CopyField value={p.id} label={isWeb ? "Site ID" : "App ID"} />
            </div>
            {first && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-muted-foreground">Placement ID · {first.name}</span>
                <CopyField value={first.id} label="Placement ID" />
              </div>
            )}
            <KeyValue
              items={[
                { k: "Environment", v: PROPERTY_ENV_LABEL[p.env] },
                { k: "SDK status", v: <StatusBadge status={p.sdk.state} /> },
                { k: "API keys", v: <GuardedLink href={`/properties/${p.id}?tab=credentials`} className="text-primary hover:underline" onClick={(e) => { e.preventDefault(); onTab("credentials") }}>Manage keys</GuardedLink> },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
