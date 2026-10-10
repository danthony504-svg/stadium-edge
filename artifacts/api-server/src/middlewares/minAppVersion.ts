import type { NextFunction, Request, Response } from "express";
import {
  buildAppConfigPayload,
  getMinIosVersion,
  isAppVersionBelow,
  isMinIosVersionEnforcementEnabled,
  isMinVersionExemptPath,
} from "../lib/minAppVersion.js";

/**
 * Optionally enforce MIN_IOS_APP_VERSION on protected /api routes via
 * X-App-Version. Disabled unless MIN_IOS_VERSION_ENFORCEMENT=true so 1.0.3
 * migration can complete before API blocking. Missing header → allow.
 */
export function minAppVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!isMinIosVersionEnforcementEnabled()) {
      next();
      return;
    }
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
