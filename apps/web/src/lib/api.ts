"use client"

import { createClient } from "@orbit/api-client"
import { createQueryClient } from "@orbit/api-client/react"

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
export const AD_SERVER_URL = process.env.NEXT_PUBLIC_AD_SERVER_URL ?? "http://localhost:4100"

/** One client for the app. Responses are checked against the contract in development (§3.4). */
export const api = createClient({
  baseUrl: API_URL,
  parseResponses: process.env.NODE_ENV !== "production",
  onUnauthorized: () => {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/sign-in")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.assign(`/sign-in?next=${next}`)
    }
  },
})

export function makeQueryClient() {
  return createQueryClient()
}
