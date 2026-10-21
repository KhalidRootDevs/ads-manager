"use client"

import { BarChart3, Building2, ChartPie, CreditCard, Image as ImageIcon, LayoutDashboard, LayoutTemplate, Megaphone, Orbit, Settings, Users } from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect } from "react"
import { GuardedLink } from "@/components/nav-guard"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { useAlerts } from "@/lib/hooks"

export const NAV_MAIN = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: ChartPie },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/creatives", label: "Ad creatives", icon: ImageIcon },
  { href: "/properties", label: "Apps & websites", icon: Building2 },
  { href: "/placements", label: "Placements", icon: LayoutTemplate },
  { href: "/reports", label: "Reports", icon: BarChart3 },
]
export const NAV_MANAGE = [
  { href: "/audiences", label: "Audiences", icon: Users },
  { href: "/billing", label: "Billing & budgets", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
]

/** Open alerts (maintained by the jobs worker). */
export function useAlertCount() {
  const alerts = useAlerts()
  return (alerts.data ?? []).filter((a) => a.status === "open").length
}

export function AppSidebar() {
  const pathname = usePathname()
  const { setOpenMobile, setOpen } = useSidebar()
  const alertCount = useAlertCount()
  // Tablet widths start with the compact icon rail; desktop starts expanded.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px) and (max-width: 1199px)")
    const apply = () => { if (mq.matches) setOpen(false) }
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [setOpen])
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"))

  const item = (n: (typeof NAV_MAIN)[number]) => (
    <SidebarMenuItem key={n.href}>
      <SidebarMenuButton asChild isActive={isActive(n.href)} tooltip={n.label}>
        <GuardedLink href={n.href} onClick={() => setOpenMobile(false)}>
          <n.icon />
          <span>{n.label}</span>
        </GuardedLink>
      </SidebarMenuButton>
      {n.href === "/" && alertCount > 0 && <SidebarMenuBadge className="bg-red-500/10 text-red-600 dark:text-red-400">{alertCount}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <GuardedLink href="/" onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Orbit className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Orbit Ads</span>
                  <span className="truncate text-xs text-muted-foreground">Internal ad platform</span>
                </div>
              </GuardedLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{NAV_MAIN.map(item)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{NAV_MANAGE.map(item)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {process.env.NEXT_PUBLIC_ENV_LABEL && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 group-data-[collapsible=icon]:hidden dark:text-amber-300">
            {process.env.NEXT_PUBLIC_ENV_LABEL} environment
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
