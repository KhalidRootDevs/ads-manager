"use client"

import { PageContainer, PageHeader } from "@/components/page-header"
import { useActiveTabInView, useTabParam } from "@/components/properties/use-tab-param"
import { AuditTab } from "@/components/settings/audit-tab"
import { CountriesTab } from "@/components/settings/countries-tab"
import { EventsTab } from "@/components/settings/events-tab"
import { GeneralTab } from "@/components/settings/general-tab"
import { SdkTab } from "@/components/settings/sdk-tab"
import { TeamTab } from "@/components/settings/team-tab"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const TABS = [
  { value: "general", label: "General" },
  { value: "team", label: "Team & roles" },
  { value: "sdk", label: "SDK / Integration" },
  { value: "countries", label: "Countries & regions" },
  { value: "events", label: "Events" },
  { value: "audit", label: "Audit log" },
] as const
type Tab = (typeof TABS)[number]["value"]
const VALUES = TABS.map((t) => t.value) as Tab[]

export default function SettingsPage() {
  const [tab, setTab] = useTabParam(VALUES, "general")
  const tabsRef = useActiveTabInView<HTMLDivElement>(tab)
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Workspace defaults, team access, SDK integration, countries, events and the audit trail." />
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
        <div ref={tabsRef} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          <TabsList className="w-max">
            {TABS.map((t) => <TabsTrigger key={t.value} value={t.value} className="px-3">{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="general" className="min-w-0"><GeneralTab /></TabsContent>
        <TabsContent value="team" className="min-w-0"><TeamTab /></TabsContent>
        <TabsContent value="sdk" className="min-w-0"><SdkTab /></TabsContent>
        <TabsContent value="countries" className="min-w-0"><CountriesTab /></TabsContent>
        <TabsContent value="events" className="min-w-0"><EventsTab /></TabsContent>
        <TabsContent value="audit" className="min-w-0"><AuditTab /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}
