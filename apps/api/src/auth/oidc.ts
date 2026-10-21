/**
 * Google Workspace (OIDC) sign-in (§9): authorization code + PKCE, state and nonce kept in a short-lived
 * signed cookie. Only pre-invited (or active) users may sign in; MFA is enforced at the identity provider.
 * Enabled when OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI are set.
 * These two routes are browser redirects, so they live outside the JSON contract.
 */
import { truncateIp } from "@orbit/domain/node"
import { Router } from "express"
import * as oidc from "openid-client"
import type { Deps } from "../context"
import type { AuthService } from "./service"
import type { SessionService } from "./sessions"

const STATE_COOKIE = "orbit_oidc"
const STATE_PATH = "/v1/auth/oidc"

/** Only same-site relative paths are accepted as a post-login destination. */
const safeReturn = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) && v.length < 300 ? v : "/")

export function oidcEnabled(env: Deps["env"]) {
  return !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_REDIRECT_URI)
}

export function oidcRouter(deps: Pick<Deps, "env" | "log">, svc: AuthService, sessions: SessionService): Router {
  const env = deps.env
  const router = Router()
  if (!oidcEnabled(env)) return router
  let configP: Promise<oidc.Configuration> | null = null
  const config = () => (configP ??= oidc.discovery(new URL(env.OIDC_ISSUER!), env.OIDC_CLIENT_ID!, env.OIDC_CLIENT_SECRET!).catch((e: unknown) => {
    configP = null
    throw e
  }))
  const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production", signed: true, path: STATE_PATH }
  const fail = (res: import("express").Response, code: string) => res.redirect(`${env.WEB_ORIGIN}/sign-in?error=${code}`)

  router.get(`${STATE_PATH}/start`, async (req, res) => {
    const cfg = await config()
    const verifier = oidc.randomPKCECodeVerifier()
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    res.cookie(STATE_COOKIE, JSON.stringify({ state, verifier, nonce, returnTo: safeReturn(req.query.returnTo) }), { ...cookieOpts, maxAge: 10 * 60_000 })
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: env.OIDC_REDIRECT_URI!, scope: "openid email profile", code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256",
      state, nonce, prompt: "select_account", ...(env.OIDC_ALLOWED_DOMAIN ? { hd: env.OIDC_ALLOWED_DOMAIN } : {}),
    })
    res.redirect(url.href)
  })

  router.get(`${STATE_PATH}/callback`, async (req, res) => {
    const raw = req.signedCookies?.[STATE_COOKIE] as string | undefined
    res.clearCookie(STATE_COOKIE, { ...cookieOpts, signed: undefined })
    if (!raw) return fail(res, "expired")
    try {
      const st = JSON.parse(raw) as { state: string; verifier: string; nonce: string; returnTo: string }
      const current = new URL(env.OIDC_REDIRECT_URI!)
      current.search = new URL(req.originalUrl, "http://x").search
      const tokens = await oidc.authorizationCodeGrant(await config(), current, { pkceCodeVerifier: st.verifier, expectedState: st.state, expectedNonce: st.nonce, idTokenExpected: true })
      const claims = tokens.claims()
      const email = typeof claims?.email === "string" ? claims.email : null
      if (!claims || !email || claims.email_verified === false) return fail(res, "email_unverified")
      if (env.OIDC_ALLOWED_DOMAIN && claims.hd !== env.OIDC_ALLOWED_DOMAIN) return fail(res, "wrong_domain")
      let signedIn
      try {
        signedIn = await svc.signIn(email, { ip: req.ip ? truncateIp(req.ip) : null, ua: req.header("user-agent") ?? null, requestId: String(req.id) }, "Google sign-in")
      } catch {
        return fail(res, "not_invited")
      }
      await svc.users.setSso(signedIn.me.user.id, { provider: "google", subject: String(claims.sub) })
      sessions.setCookie(res, signedIn.token)
      res.redirect(env.WEB_ORIGIN + safeReturn(st.returnTo))
    } catch (err) {
      deps.log.warn({ err }, "OIDC callback failed")
      return fail(res, "sign_in_failed")
    }
  })
  return router
}
