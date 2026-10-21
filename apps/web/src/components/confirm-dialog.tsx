"use client"

import { create } from "zustand"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface ConfirmState {
  open: boolean
  opts: ConfirmOptions | null
  resolve: ((v: boolean) => void) | null
}
const useConfirmStore = create<ConfirmState>(() => ({ open: false, opts: null, resolve: null }))

/** Imperative confirm: `if (await confirm({ title: "Archive?" , destructive: true })) ...` */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ open: true, opts, resolve }))
}

export function ConfirmDialogHost() {
  const { open, opts, resolve } = useConfirmStore()
  const close = (v: boolean) => {
    resolve?.(v)
    useConfirmStore.setState({ open: false, resolve: null })
  }
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description ? <AlertDialogDescription>{opts.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{opts?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={cn(opts?.destructive && buttonVariants({ variant: "destructive" }), opts?.destructive && "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive")}
          >
            {opts?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
