import { endpoints } from "@orbit/domain"
import type { Reg } from "../lib/registry"
import { authController } from "./controller"
import type { AuthService } from "./service"
import type { SessionService } from "./sessions"

export function authRoutes(reg: Reg, svc: AuthService, sessions: SessionService) {
  const c = authController(svc, sessions)
  reg(endpoints.me, c.me)
  reg(endpoints.devLogin, c.devLogin)
  reg(endpoints.logout, c.logout)
}
