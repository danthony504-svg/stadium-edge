/**
 * Reject oversized crash POSTs before the global express.json({ limit: "5mb" })
 * parser allocates a large body. Only applies to /api/reliability/crashes.
 */

import type { NextFunction, Request, Response } from "express";
import express from "express";
import { CRASH_MAX_BODY_BYTES } from "../lib/reliabilitySanitize";

declare module "express-serve-static-core" {
  interface Request {
    __reliabilityCrashBodyParsed?: boolean;
  }
}

function isCrashIngestPath(req: Request): boolean {
  if (req.method !== "POST") return false;
  const path = (req.path || "").replace(/\/+$/, "") || "/";
  const url = (req.url || "").split("?")[0] ?? "";
  return (
    path === "/api/reliability/crashes" ||
    path === "/reliability/crashes" ||
    url === "/api/reliability/crashes" ||
    url.startsWith("/api/reliability/crashes")
  );
}

/**
 * Early Content-Length reject + 8kb JSON parse for crash ingest only.
 * Must be mounted BEFORE `express.json({ limit: "5mb" })`.
 */
export function reliabilityCrashBodyLimitEarly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isCrashIngestPath(req)) {
    next();
    return;
  }

  const rawLen = req.headers["content-length"];
  if (rawLen != null && rawLen !== "") {
    const len = Number(rawLen);
    if (Number.isFinite(len) && len > CRASH_MAX_BODY_BYTES) {
      res.status(413).json({ error: "payload too large" });
      return;
    }
  }

  express.json({ limit: CRASH_MAX_BODY_BYTES })(req, res, (err?: unknown) => {
    if (err) {
      const status =
        typeof err === "object" &&
        err &&
        "status" in err &&
        typeof (err as { status: unknown }).status === "number"
          ? (err as { status: number }).status
          : 413;
      res.status(status === 413 || status === 400 ? status : 413).json({
        error: "payload too large",
      });
      return;
    }
    req.__reliabilityCrashBodyParsed = true;
    next();
  });
}

/**
 * Skip the global 5mb JSON parser when the crash body was already parsed.
 */
export function skipJsonIfCrashBodyParsed(
  jsonParser: ReturnType<typeof express.json>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (req.__reliabilityCrashBodyParsed) {
      next();
      return;
    }
    jsonParser(req, res, next);
  };
}
