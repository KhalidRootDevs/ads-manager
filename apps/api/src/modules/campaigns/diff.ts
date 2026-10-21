/** Short human summary of what changed between two campaign versions (revision history and the activity feed). */
import { PACING_LABEL, PRIORITY_LABEL, ruleSummary, type Campaign } from "@orbit/domain"
import { arrow, capText, usd } from "../../lib/format"

type Names = Record<string, string>

const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} +${xs.length - 3}` : xs.join(", "))
const hours = (h: { from: number; to: number }) => (h.from === 0 && h.to === 24 ? "all day" : `${h.from}:00–${h.to}:00`)

export function campaignDiff(prev: Campaign | null, next: Campaign, names: Names = {}): string[] {
  const n = (id: string) => names[id] ?? id
  if (!prev) {
    return [
      "First publish",
      `${next.targets.length} propert${next.targets.length === 1 ? "y" : "ies"}`,
      `${next.creativeIds.length} creative${next.creativeIds.length === 1 ? "" : "s"}`,
      `Budget ${usd(next.budget.amountMicros)}`,
    ]
  }
  const out: string[] = []
  if (prev.name !== next.name) out.push(`Renamed “${prev.name}” → “${next.name}”`)
  if (prev.objective !== next.objective) out.push(`Objective ${arrow(prev.objective, next.objective)}`)
  if (prev.flight.start !== next.flight.start || prev.flight.end !== next.flight.end) out.push(`Flight ${prev.flight.start} – ${prev.flight.end} → ${next.flight.start} – ${next.flight.end}`)
  if (prev.priority !== next.priority) out.push(`Priority ${arrow(PRIORITY_LABEL[prev.priority], PRIORITY_LABEL[next.priority])}`)

  const addedCr = next.creativeIds.filter((id) => !prev.creativeIds.includes(id))
  const removedCr = prev.creativeIds.filter((id) => !next.creativeIds.includes(id))
  if (addedCr.length) out.push(`Added creative${addedCr.length === 1 ? "" : "s"} ${list(addedCr.map(n))}`)
  if (removedCr.length) out.push(`Removed creative${removedCr.length === 1 ? "" : "s"} ${list(removedCr.map(n))}`)

  const prevT = new Map(prev.targets.map((t) => [t.propertyId, t]))
  const nextT = new Map(next.targets.map((t) => [t.propertyId, t]))
  const addedP = [...nextT.keys()].filter((id) => !prevT.has(id))
  const removedP = [...prevT.keys()].filter((id) => !nextT.has(id))
  if (addedP.length) out.push(`Added ${list(addedP.map(n))}`)
  if (removedP.length) out.push(`Removed ${list(removedP.map(n))}`)
  for (const [id, t] of nextT) {
    const p = prevT.get(id)
    if (!p) continue
    if (JSON.stringify(p.countryRule) !== JSON.stringify(t.countryRule)) out.push(`${n(id)} countries: ${ruleSummary(p.countryRule)} → ${ruleSummary(t.countryRule)}`)
    if ([...p.placementIds].sort().join() !== [...t.placementIds].sort().join()) out.push(`${n(id)} placements: ${p.placementIds.length} → ${t.placementIds.length}`)
    if ((p.allocationPct ?? null) !== (t.allocationPct ?? null)) out.push(`${n(id)} allocation ${arrow(p.allocationPct ?? "auto", t.allocationPct ?? "auto")}${t.allocationPct != null ? "%" : ""}`)
  }

  const a = prev.constraints, b = next.constraints
  if (capText(a.freqCap) !== capText(b.freqCap)) out.push(`Frequency cap ${arrow(capText(a.freqCap), capText(b.freqCap))}`)
  if (a.days.join() !== b.days.join()) out.push(`Days ${arrow(a.days.length === 7 ? "every day" : a.days.join(", "), b.days.length === 7 ? "every day" : b.days.join(", "))}`)
  if (a.hours.from !== b.hours.from || a.hours.to !== b.hours.to) out.push(`Hours ${arrow(hours(a.hours), hours(b.hours))}`)
  if ([...a.devices].sort().join() !== [...b.devices].sort().join()) out.push(`Devices ${arrow(a.devices.join(", "), b.devices.join(", "))}`)
  if ((a.minAppVersion ?? "") !== (b.minAppVersion ?? "")) out.push(`Min app version ${arrow(a.minAppVersion ?? "any", b.minAppVersion ?? "any")}`)

  if (prev.budget.amountMicros !== next.budget.amountMicros) out.push(`Budget ${arrow(usd(prev.budget.amountMicros), usd(next.budget.amountMicros))}`)
  if (prev.budget.pacing !== next.budget.pacing) out.push(`Pacing ${arrow(PACING_LABEL[prev.budget.pacing], PACING_LABEL[next.budget.pacing])}`)
  const goal = (g: Campaign["budget"]["goal"]) => (g ? `${g.value.toLocaleString("en-US")} ${g.type}` : "none")
  if (goal(prev.budget.goal) !== goal(next.budget.goal)) out.push(`Goal ${arrow(goal(prev.budget.goal), goal(next.budget.goal))}`)
  return out.length ? out : ["No changes"]
}
