import { Suspense } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { AuthGate } from "@/components/auth-gate"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <SidebarProvider>
        {/* Static placeholder: identical markup on server and client at every width (avoids hydration mismatch on mobile). */}
        <Suspense fallback={<div aria-hidden className="hidden w-(--sidebar-width) shrink-0 md:block" />}>
          <AppSidebar />
        </Suspense>
        <SidebarInset className="min-w-0">
          <Suspense fallback={<div className="h-14 border-b" />}>
            <SiteHeader />
          </Suspense>
          <main className="flex min-w-0 flex-1 flex-col">
            <Suspense>{children}</Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGate>
  )
}
