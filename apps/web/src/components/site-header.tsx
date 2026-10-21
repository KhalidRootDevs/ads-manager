"use client"

import { apiKey, useApiMutation } from "@orbit/api-client/react"
import { CAMPAIGN_STATUS_LABEL, CREATIVE_STATUS_LABEL, FORMAT_LABEL, ROLE_LABEL } from "@orbit/domain"
import { useQueryClient } from "@tanstack/react-query"
import { Check, LogOut, Moon, Search, Sun, UserRound } from "lucide-react"
import { useTheme } from "next-themes"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Fragment, useEffect, useState } from "react"
import { NAV_MAIN, NAV_MANAGE } from "@/components/app-sidebar"
import { GuardedLink, useGuardedRouter } from "@/components/nav-guard"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { fmt } from "@/lib/format"
import { toastError, useCan, useLookups, useMe } from "@/lib/hooks"

const SECTION: Record<string, string> = {
  analytics: "Analytics", campaigns: "Campaigns", creatives: "Ad creatives", properties: "Apps & websites", placements: "Placements", reports: "Reports", audiences: "Audiences", billing: "Billing & budgets", settings: "Settings",
}

function useCrumbs() {
  const pathname = usePathname()
  const lk = useLookups().data
  const parts = pathname.split("/").filter(Boolean)
  if (!parts.length) return [{ label: "Overview" }]
  const crumbs: { label: string; href?: string }[] = [{ label: SECTION[parts[0]] ?? parts[0], href: "/" + parts[0] }]
  if (parts[1] === "new") crumbs.push({ label: parts[0] === "properties" ? "Add property" : "New" })
  else if (parts[1]) {
    const list = { campaigns: lk?.campaigns, creatives: lk?.creatives, properties: lk?.properties, placements: lk?.placements }[parts[0]] as { id: string; name: string }[] | undefined
    crumbs.push({ label: list?.find((x) => x.id === parts[1])?.name ?? "…", href: `/${parts[0]}/${parts[1]}` })
    if (parts[2] === "edit") crumbs.push({ label: "Edit" })
  }
  return crumbs
}

export function SiteHeader() {
  const crumbs = useCrumbs()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o) }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 rounded-t-xl border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator className={i < crumbs.length - 1 ? "hidden md:block" : ""} />}
                <BreadcrumbItem className={!last ? "hidden md:inline-flex" : "min-w-0"}>
                  {last || !c.href ? <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage> : <BreadcrumbLink asChild><GuardedLink href={c.href}>{c.label}</GuardedLink></BreadcrumbLink>}
                </BreadcrumbItem>
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <Button variant="outline" size="sm" className="hidden w-56 justify-start text-muted-foreground lg:inline-flex" onClick={() => setOpen(true)}>
        <Search /> Search… <Kbd className="ml-auto">⌘K</Kbd>
      </Button>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Search"><Search /></Button>
      <ThemeToggle />
      <AccountMenu />
      <GlobalSearch open={open} setOpen={setOpen} />
    </header>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
      <Sun className="dark:hidden" />
      <Moon className="hidden dark:block" />
    </Button>
  )
}

function AccountMenu() {
  const me = useMe().data?.user
  const router = useGuardedRouter()
  const plain = useRouter()
  const qc = useQueryClient()
  const logout = useApiMutation("logout", {
    onSuccess: () => {
      qc.removeQueries({ queryKey: apiKey("me", {}) })
      qc.clear()
      plain.replace("/sign-in")
    },
    onError: (e) => toastError(e, "Couldn’t sign out"),
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-7"><AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{me ? fmt.initials(me.name) : "…"}</AvatarFallback></Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{me?.name}</div>
          <div className="truncate text-xs text-muted-foreground">{me?.email} · {me ? ROLE_LABEL[me.role] : ""}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings?tab=team")}><UserRound /> Team & roles</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate({})}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GlobalSearch({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const router = useGuardedRouter()
  const lk = useLookups().data
  const canCampaign = useCan("campaigns.write")
  const canCreative = useCan("creatives.write")
  const canProperty = useCan("properties.write")
  const go = (href: string) => { setOpen(false); router.push(href) }
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search campaigns, creatives, apps and placements">
      <CommandInput placeholder="Search campaigns, creatives, apps, placements…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Go to">
          {[...NAV_MAIN, ...NAV_MANAGE].map((n) => (
            <CommandItem key={n.href} value={"page " + n.label} onSelect={() => go(n.href)}><n.icon /> {n.label}</CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Campaigns">
          {lk?.campaigns.map((c) => <CommandItem key={c.id} value={"campaign " + c.name} onSelect={() => go(`/campaigns/${c.id}`)}>{c.name}<span className="ml-auto text-xs text-muted-foreground">{CAMPAIGN_STATUS_LABEL[c.status]}</span></CommandItem>)}
        </CommandGroup>
        <CommandGroup heading="Creatives">
          {lk?.creatives.map((c) => <CommandItem key={c.id} value={"creative " + c.name} onSelect={() => go(`/creatives/${c.id}`)}>{c.name}<span className="ml-auto text-xs text-muted-foreground">{FORMAT_LABEL[c.format]} · {CREATIVE_STATUS_LABEL[c.status]}</span></CommandItem>)}
        </CommandGroup>
        <CommandGroup heading="Apps & websites">
          {lk?.properties.map((p) => <CommandItem key={p.id} value={"property " + p.name + " " + p.identifier} onSelect={() => go(`/properties/${p.id}`)}>{p.name}<span className="ml-auto text-xs text-muted-foreground">{p.identifier}</span></CommandItem>)}
        </CommandGroup>
        <CommandGroup heading="Placements">
          {lk?.placements.map((p) => <CommandItem key={p.id} value={"placement " + p.name + " " + p.id} onSelect={() => go(`/placements/${p.id}`)}>{p.name}<span className="ml-auto text-xs text-muted-foreground">{FORMAT_LABEL[p.format]}</span></CommandItem>)}
        </CommandGroup>
        {(canCampaign || canCreative || canProperty) && <CommandSeparator />}
        {(canCampaign || canCreative || canProperty) && (
          <CommandGroup heading="Create">
            {canCampaign && <CommandItem value="create new campaign" onSelect={() => go("/campaigns/new")}><Check /> New campaign</CommandItem>}
            {canCreative && <CommandItem value="create new creative" onSelect={() => go("/creatives/new")}><Check /> New creative</CommandItem>}
            {canProperty && <CommandItem value="create add property" onSelect={() => go("/properties/new")}><Check /> Add property</CommandItem>}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}

/** Small hook other pages can use to read ?tab= */
export function useTabParam(fallback: string) {
  const sp = useSearchParams()
  return sp.get("tab") ?? fallback
}
