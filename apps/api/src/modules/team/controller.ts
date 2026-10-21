import type { endpoints } from "@orbit/domain"
import type { Handler } from "@orbit/server-kit"
import { ctxOf, p } from "../../lib/http"
import type { TeamService } from "./service"

type E = typeof endpoints

export function teamController(svc: TeamService) {
  return {
    list: (() => svc.list()) satisfies Handler<E["listTeam"]>,
    invite: (({ req, body }) => svc.invite(ctxOf(req), body)) satisfies Handler<E["inviteMember"]>,
    changeRole: (({ req, body }) => svc.changeRole(ctxOf(req), p(req, "id"), body)) satisfies Handler<E["changeRole"]>,
    remove: (({ req }) => svc.remove(ctxOf(req), p(req, "id"))) satisfies Handler<E["removeMember"]>,
  }
}
