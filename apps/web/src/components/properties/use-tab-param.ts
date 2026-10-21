"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef } from "react"
import { confirm } from "@/components/confirm-dialog"
import { useUi } from "@/lib/ui-store"

/**
 * Keeps the active tab in `?tab=`. Switching tabs while a form inside the current tab is dirty
 * asks before discarding, since inactive tab panels unmount.
 */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const raw = params.get("tab")
  const tab = (tabs as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback

  const setTab = useCallback(
    async (next: string) => {
      if (next === tab) return
      if (useUi.getState().dirty) {
        const ok = await confirm({
          title: "Discard unsaved changes?",
          description: "You have changes on this tab that haven’t been saved. Switching tabs will discard them.",
          confirmLabel: "Discard changes",
          cancelLabel: "Keep editing",
          destructive: true,
        })
        if (!ok) return
        useUi.getState().setDirty(false)
      }
      const sp = new URLSearchParams(params.toString())
      sp.set("tab", next)
      sp.delete("new")
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    },
    [tab, params, pathname, router],
  )
  return [tab, setTab] as const
}

/**
 * Ref for a horizontally scrollable tab strip. Keeps the active trigger in view when the tab
 * changes (e.g. deep links like ?tab=credentials on a 390 px screen).
 */
export function useActiveTabInView<E extends HTMLElement>(tab: string) {
  const ref = useRef<E>(null)
  useEffect(() => {
    const box = ref.current
    const el = box?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    if (!box || !el || box.scrollWidth <= box.clientWidth) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    if (r.left < b.left + 16 || r.right > b.right - 16) box.scrollTo({ left: box.scrollLeft + (r.left - b.left) - (b.width - r.width) / 2, behavior: "smooth" })
  }, [tab])
  return ref
}
