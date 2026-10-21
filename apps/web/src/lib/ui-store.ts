"use client"

import { create } from "zustand"

/**
 * Zustand holds UI state only (guideline §3.4). Server data lives in TanStack Query.
 */
interface UiState {
  /** Set by forms/wizards with unsaved changes; checked by guarded navigation. */
  dirty: boolean
  setDirty: (d: boolean) => void
}

export const useUi = create<UiState>()((set) => ({
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
}))
