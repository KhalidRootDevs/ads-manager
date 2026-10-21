"use client"

import { useApiMutation } from "@orbit/api-client/react"
import { availSet, FORMAT_LABEL, ruleSummary, type AdFormat, type CountryRule, type Property, type PropertyPatch } from "@orbit/domain"
import { Info, Loader2, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { CountryRuleEditor } from "@/components/domain/targeting"
import { useDirty } from "@/components/nav-guard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldError } from "@/components/ui/field"
import { useMutationError } from "@/components/placements/placement-utils"
import { useCan, useCountries, usePlacements } from "@/lib/hooks"
import { FormatPicker } from "./format-picker"
import { formatsFor, sameSet } from "./property-utils"

/** Allowed formats + country availability defaults, edited as a local draft. Key by property id + rev. */
export function FormatsTab({ p }: { p: Property }) {
  const canWrite = useCan("properties.write")
  const countries = useCountries().data ?? []
  const placements = usePlacements(p.id).data ?? []
  const [formats, setFormats] = useState<AdFormat[]>(p.formats)
  const [rule, setRule] = useState<CountryRule>(p.countryRule)
  const [showErr, setShowErr] = useState(false)
  const onError = useMutationError("properties")
  const patch = useApiMutation("patchProperty", {
    onSuccess: () => { toast.dismiss(); toast.success("Defaults saved") },
    onError: (e) => onError(e),
  })

  const formatsChanged = !sameSet(formats, p.formats)
  const ruleChanged = rule.mode !== p.countryRule.mode || !sameSet(rule.countries, p.countryRule.countries)
  const dirty = canWrite && (formatsChanged || ruleChanged) && !patch.isPending
  useDirty(dirty)

  const fmtErr = formats.length ? "" : "Allow at least one ad format."
  const listErr = rule.mode !== "all" && !rule.countries.length ? (rule.mode === "include" ? "Add at least one country, or choose “All enabled countries”." : "Add at least one country to exclude, or choose “All enabled countries”.") : ""
  const orphaned = [...new Set(placements.filter((x) => !formats.includes(x.format)).map((x) => x.format))]
  const count = availSet(rule, countries).size

  const discard = () => { setFormats(p.formats); setRule(p.countryRule); setShowErr(false) }
  const save = () => {
    if (fmtErr || listErr) { setShowErr(true); toast.error("Fix the highlighted fields first."); return }
    // Send only what changed, plus rev (the API rejects stale revs with 409).
    const body: PropertyPatch = { rev: p.rev }
    if (formatsChanged) body.formats = formats
    if (ruleChanged) body.countryRule = { mode: rule.mode, countries: rule.mode === "all" ? [] : rule.countries }
    setShowErr(false)
    patch.mutate({ params: { id: p.id }, body })
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Allowed ad formats</CardTitle>
          <CardDescription>Placements and campaigns on {p.name} can only use the formats ticked here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canWrite ? (
            <FormatPicker options={formatsFor(p.platform)} value={formats} onChange={setFormats} invalid={showErr && !!fmtErr} />
          ) : (
            <div className="flex flex-wrap gap-1.5">{p.formats.map((f) => <Badge key={f} variant="secondary" className="font-normal">{FORMAT_LABEL[f]}</Badge>)}</div>
          )}
          {showErr && fmtErr && <FieldError>{fmtErr}</FieldError>}
          {orphaned.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>Existing {orphaned.map((f) => FORMAT_LABEL[f]).join(", ")} placements on this property will stop receiving ads if you remove {orphaned.length === 1 ? "that format" : "those formats"}.</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Country availability defaults</CardTitle>
          <CardDescription>Where {p.name} accepts ads from. Campaign country rules can narrow this list but never widen it.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {canWrite ? (
            <CountryRuleEditor mode={rule.mode} countries={rule.countries} onChange={setRule} labels={{ all: "All enabled countries", include: "Only these", exclude: "All except" }} />
          ) : (
            <p className="text-sm">{ruleSummary(p.countryRule)}</p>
          )}
          {showErr && listErr && <FieldError>{listErr}</FieldError>}
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>This property will accept ads from <b className="font-semibold text-foreground">{count}</b> {count === 1 ? "country" : "countries"}. Countries disabled platform-wide in Settings are never available.</span>
          </div>
        </CardContent>
      </Card>

      {(dirty || patch.isPending) && (
        <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary" className="bg-amber-500/15 text-amber-800 dark:text-amber-300">Unsaved changes</Badge>
            <span className="text-muted-foreground">Formats or country defaults were edited.</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={discard} disabled={patch.isPending}>Discard</Button>
            <Button className="flex-1 sm:flex-none" onClick={save} disabled={patch.isPending}>{patch.isPending && <Loader2 className="animate-spin" />} Save defaults</Button>
          </div>
        </div>
      )}
    </div>
  )
}
