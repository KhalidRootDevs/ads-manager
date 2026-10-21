"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { apiKey, useApiMutation } from "@orbit/api-client/react"
import { zDevLoginInput } from "@orbit/domain"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, Orbit } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { API_URL } from "@/lib/api"
import { errorMessage } from "@/lib/hooks"

const DEMO = ["arif.hossain@orbit.example", "priya.menon@orbit.example", "tanvir.ahmed@orbit.example", "sara.lindqvist@orbit.example"]
const DEV_LOGIN = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEV_LOGIN === "true"

export function SignInForm() {
  const router = useRouter()
  const sp = useSearchParams()
  const qc = useQueryClient()
  const next = sp.get("next")?.startsWith("/") ? sp.get("next")! : "/"
  const form = useForm<z.input<typeof zDevLoginInput>>({ resolver: zodResolver(zDevLoginInput), defaultValues: { email: "" } })
  const login = useApiMutation("devLogin", {
    onSuccess: async (me) => {
      qc.setQueryData(apiKey("me", {}), me)
      await qc.invalidateQueries()
      router.replace(next)
    },
  })
  const submit = form.handleSubmit((v) => login.mutate({ body: v }))

  return (
    <div className="grid min-h-svh place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Orbit className="size-5" /></div>
          <CardTitle className="text-xl">Sign in to Orbit Ads</CardTitle>
          <CardDescription>Internal ad platform for our apps and websites.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button asChild variant="outline" className="w-full">
            <a href={`${API_URL}/v1/auth/oidc/start?next=${encodeURIComponent(next)}`}>Continue with Google Workspace</a>
          </Button>
          {DEV_LOGIN && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><Separator className="flex-1" />Development sign-in<Separator className="flex-1" /></div>
              <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
                <Field data-invalid={!!form.formState.errors.email}>
                  <FieldLabel htmlFor="email">Work email</FieldLabel>
                  <Input id="email" type="email" autoComplete="email" placeholder="name@orbit.example" {...form.register("email")} />
                  {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
                  <FieldDescription>Only works when the API runs with AUTH_DEV_LOGIN=true.</FieldDescription>
                </Field>
                {login.error && <p role="alert" className="text-sm text-destructive">{errorMessage(login.error)}</p>}
                <Button type="submit" disabled={login.isPending}>{login.isPending && <Loader2 className="animate-spin" />} Sign in</Button>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {DEMO.map((e) => (
                  <Button key={e} type="button" variant="secondary" size="xs" onClick={() => { form.setValue("email", e); void submit() }}>{e.split("@")[0]}</Button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
