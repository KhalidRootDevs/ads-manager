"use client"

import { ApiProvider } from "@orbit/api-client/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { ThemeProvider } from "next-themes"
import { useState } from "react"
import { ConfirmDialogHost } from "@/components/confirm-dialog"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, makeQueryClient } from "@/lib/api"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            {children}
            <ConfirmDialogHost />
            <Toaster position="bottom-right" mobileOffset={{ bottom: 88 }} richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </ApiProvider>
      {process.env.NODE_ENV !== "production" && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />}
    </QueryClientProvider>
  )
}
