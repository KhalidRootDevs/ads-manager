"use client"

import { ApiError, useApiMutation } from "@orbit/api-client/react"
import { useQueryClient } from "@tanstack/react-query"
import { fromMicros, toMicros } from "@orbit/domain"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fmt } from "@/lib/format"
import { toastError } from "@/lib/hooks"

export interface BudgetTarget {
  team: string
  quarter: string
  /** Human quarter span, e.g. "Oct 1 – Dec 31, 2026". */
  span: string
  budgetMicros: number
  allocatedMicros: number
  /** null when the team has no budget for this quarter yet (PUT creates it). */
  rev: number | null
}

const MAX_USD = 10_000_000

/** Adjust a team's quarterly internal budget. Mount with a `key` per team so the input resets. */
export function BudgetDialog({ target, onClose }: { target: BudgetTarget | null; onClose: () => void }) {
  const [value, setValue] = useState(target ? String(Math.round(fromMicros(target.budgetMicros))) : "")
  const [touched, setTouched] = useState(false)
  const qc = useQueryClient()
  const put = useApiMutation("putBudget", {
    onSuccess: (b) => {
      toast.success(`${b.team} budget updated`, { description: `${fmt.money(target?.budgetMicros)} → ${fmt.money(b.amountMicros)} · recorded in the audit log` })
      onClose()
    },
    onError: (e) => {
      toastError(e, "Couldn’t save the budget")
      // Someone else changed it: reload the latest amount and rev, and let the user reopen the dialog on fresh data.
      if (e instanceof ApiError && e.status === 409) {
        void qc.invalidateQueries({ queryKey: ["budgets"] })
        onClose()
      }
    },
    // Spend vs budget tiles read campaigns and analytics.
    invalidate: ["analytics"],
  })

  const n = Number(value)
  const error =
    value.trim() === "" || !Number.isFinite(n) ? "Enter a budget of $0 or more."
      : n < 0 ? "Budget can’t be negative."
        : n > MAX_USD ? `Budget can’t exceed ${fmt.usd(MAX_USD)}.`
          : !Number.isInteger(n) ? "Use whole dollars."
            : ""
  const showError = touched && !!error
  const over = target && !error ? fromMicros(target.allocatedMicros) - n : 0

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (error || !target) return
    const amountMicros = toMicros(n)
    if (amountMicros === target.budgetMicros && target.rev != null) { onClose(); return }
    put.mutate({ params: { team: target.team, quarter: target.quarter }, body: { amountMicros, rev: target.rev } })
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !put.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Adjust {target?.team} {target?.quarter.replace(/^(\d{4})-(Q\d)$/, "$2 $1")} budget</DialogTitle>
            <DialogDescription>Internal budget for {target?.span}. Existing campaign budgets are not changed.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={showError || undefined}>
            <FieldLabel htmlFor="budget-value">Internal budget (USD)</FieldLabel>
            <Input
              id="budget-value"
              type="number"
              inputMode="numeric"
              min={0}
              step={100}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? "budget-error" : "budget-help"}
              autoFocus
            />
            {showError ? (
              <FieldError id="budget-error">{error}</FieldError>
            ) : (
              <FieldDescription id="budget-help">
                {target && (target.rev == null ? "No budget set for this quarter yet. " : `Currently ${fmt.money(target.budgetMicros)} · `)}
                {target && `${fmt.money(target.allocatedMicros)} allocated to live campaigns.`}
                {over > 0 && <span className="mt-1 block text-amber-700 dark:text-amber-400">Live campaigns would be over-allocated by {fmt.usd(over)}.</span>}
              </FieldDescription>
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={put.isPending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={put.isPending}>{put.isPending ? "Saving…" : "Save budget"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
