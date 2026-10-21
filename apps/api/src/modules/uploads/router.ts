import { endpoints, ID_PATTERN } from "@orbit/domain"
import express, { type Express } from "express"
import type { Deps } from "../../context"
import type { Reg } from "../../lib/registry"
import { uploadsController } from "./controller"
import { MAX_BYTES, uploadsService } from "./service"
import { localDriver, s3Driver, uploadDir, type StorageDriver } from "./storage"

export async function storageDriver(env: Deps["env"]): Promise<StorageDriver> {
  return env.STORAGE_DRIVER === "s3" ? s3Driver(env) : localDriver(env)
}

export function uploadRoutes(reg: Reg, deps: Deps, driver: StorageDriver) {
  const c = uploadsController(uploadsService(deps, driver))
  reg(endpoints.createUpload, c.create)
  return c
}

const SAFE_NAME = /^[a-z0-9_-]{1,60}\.(png|jpg|gif|webp|mp4|webm)$/

/**
 * Local driver extras, mounted before CSRF/session middleware: the signed PUT target and `/media` file serving
 * (immutable, nosniff, cross-origin readable so the admin UI on another port can show previews).
 */
export function mountLocalStorage(app: Express, deps: Deps, c: ReturnType<typeof uploadsController>) {
  app.put("/v1/uploads/:id", express.raw({ type: () => true, limit: MAX_BYTES.video }), c.receive)
  const root = uploadDir(deps.env)
  app.get("/media/:uploadId/:name", (req, res, next) => {
    const { uploadId, name } = req.params
    if (!ID_PATTERN.upload.test(uploadId) || !SAFE_NAME.test(name)) return next()
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
    res.sendFile(`${uploadId}/${name}`, { root, dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) next()
    })
  })
}
