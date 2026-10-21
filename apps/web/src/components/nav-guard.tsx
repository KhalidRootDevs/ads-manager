"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect } from "react"
import { confirm } from "@/components/confirm-dialog"
import { useUi } from "@/lib/ui-store"

export interface LeaveMessage { title: string; description: string; confirmLabel?: string; cancelLabel?: string }
const DEFAULT_LEAVE: LeaveMessage = {
  title: "Discard unsaved changes?",
  description: "You have changes that haven’t been saved. If you leave now they will be lost.",
  confirmLabel: "Discard and leave",
  cancelLabel: "Keep editing",
}
let leaveMessage: LeaveMessage = DEFAULT_LEAVE

async function canLeave() {
  if (!useUi.getState().dirty) return true
  const m = leaveMessage
  const ok = await confirm({ ...DEFAULT_LEAVE, ...m, destructive: true })
  if (ok) useUi.getState().setDirty(false)
  return ok
}

/** router.push that asks before discarding unsaved form/wizard changes. */
export function useGuardedRouter() {
  const router = useRouter()
  const push = useCallback(async (href: string) => {
    if (await canLeave()) router.push(href)
  }, [router])
  return { push, replace: router.replace, back: router.back }
}

/** Drop-in <Link> that respects the unsaved-changes guard. */
export function GuardedLink({ href, onClick, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter()
  return (
    <Link
      href={href}
      {...props}
      onClick={async (e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return
        if (useUi.getState().dirty) {
          e.preventDefault()
          if (await canLeave()) router.push(href)
        }
      }}
    />
  )
}

/** Mark the current form dirty/clean and warn on tab close while dirty. Clears on unmount. */
export function useDirty(dirty: boolean, message?: LeaveMessage) {
  const setDirty = useUi((s) => s.setDirty)
  const title = message?.title, description = message?.description
  useEffect(() => {
    leaveMessage = title ? { ...DEFAULT_LEAVE, title, description: description ?? DEFAULT_LEAVE.description } : DEFAULT_LEAVE
    return () => { leaveMessage = DEFAULT_LEAVE }
  }, [title, description])
  useEffect(() => { setDirty(dirty) }, [dirty, setDirty])
  useEffect(() => () => setDirty(false), [setDirty])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [dirty])
}
