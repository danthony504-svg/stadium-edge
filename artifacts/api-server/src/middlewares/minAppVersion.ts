import type { NextFunction, Request, Response } from "express";
import {
  buildAppConfigPayload,
  getMinIosVersion,
  isAppVersionBelow,
  isMinVersionExemptPath,
} from "../lib/minAppVersion.js";

/**
 * Enforce MIN_IOS_APP_VERSION on protected /api routes via X-App-Version.
 * Missing header → allow (web / older clients without the header) so Apple
 * review web paths and server-to-server calls are not broken. Explicit old
 * versions are rejected with 426 + App Store URL.
 */
export function minAppVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const path = req.path || req.url || "";
    if (isMinVersionExemptPath(path)) {
      next();
      return;
    }
    const platform = String(req.get("x-app-platform") ?? "").toLowerCase();
    // Only enforce for iOS clients that identify themselves.
    if (platform && platform !== "ios") {
      next();
      return;
    }
    const version = String(req.get("x-app-version") ?? "").trim();
    if (!version) {
      next();
      return;
    }
    const min = getMinIosVersion();
    if (!isAppVersionBelow(version, min)) {
      next();
      return;
    }
    const cfg = buildAppConfigPayload();
    res.status(426).json({
      error: "update_required",
      message: cfg.updateRequiredMessage,
      minIosVersion: cfg.minIosVersion,
      appStoreUrl: cfg.appStoreUrl,
      currentVersion: version,
    });
  } catch {
    next();
  }
}
