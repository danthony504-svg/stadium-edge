/**
 * Shared cron auth for reliability / notification schedules.
 * Expects header `x-cron-key` equal to env NOTIFY_CRON_KEY (trimmed).
 * Never logs or returns secret values.
 */

import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export type CronAuthDiag = {
  authHeaderPresent: boolean;
  expectedSecretConfigured: boolean;
  authSchemeRecognized: boolean;
  rejectionLayer: string;
  providedLength: number;
  expectedLength: number;
  lengthMatch: boolean;
  fingerprintMatch: boolean;
};

const REJECTION_LAYER =
  "artifacts/api-server/src/lib/cronAuth.ts:authorizeCronRequest";

function safeEqualTrimmed(a: string, b: string): boolean {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

/** Read expected cron secret (trimmed). Empty → unset. */
export function expectedCronSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.NOTIFY_CRON_KEY ?? "").trim();
}

/**
 * Provided secret from the request.
 * Recognized schemes: `x-cron-key` header (primary), or
 * `Authorization: Bearer <key>` / `Authorization: Cron <key>` (secondary).
 */
export function providedCronSecret(req: Request): {
  value: string;
  schemeRecognized: boolean;
  headerPresent: boolean;
} {
  const rawHeader = req.get("x-cron-key");
  if (rawHeader != null && String(rawHeader).length > 0) {
    return {
      value: String(rawHeader).trim(),
      schemeRecognized: true,
      headerPresent: true,
    };
  }

  const auth = req.get("authorization");
  if (auth != null && String(auth).length > 0) {
    const m = String(auth).match(/^\s*(Bearer|Cron)\s+(.+?)\s*$/i);
    if (m?.[2]) {
      return {
        value: m[2].trim(),
        schemeRecognized: true,
        headerPresent: true,
      };
    }
    return {
      value: "",
      schemeRecognized: false,
      headerPresent: true,
    };
  }

  return { value: "", schemeRecognized: false, headerPresent: false };
}

export function buildCronAuthDiag(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): CronAuthDiag {
  const expected = expectedCronSecret(env);
  const provided = providedCronSecret(req);
  const fingerprintMatch =
    expected.length > 0 &&
    provided.value.length > 0 &&
    safeEqualTrimmed(provided.value, expected);
  return {
    authHeaderPresent: provided.headerPresent,
    expectedSecretConfigured: expected.length > 0,
    authSchemeRecognized: provided.schemeRecognized,
    rejectionLayer: REJECTION_LAYER,
    providedLength: provided.value.length,
    expectedLength: expected.length,
    lengthMatch:
      expected.length > 0 && provided.value.length === expected.length,
    fingerprintMatch,
  };
}

/**
 * Authorize a cron request. On failure, responds with 503/403 and safe diag.
 * Returns true when the caller may proceed.
 */
export function authorizeCronRequest(
  req: Request,
  res: Response,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const diag = buildCronAuthDiag(req, env);
  if (!diag.expectedSecretConfigured) {
    res.status(503).json({
      error: "cron not configured",
      ...diag,
    });
    return false;
  }
  if (!diag.fingerprintMatch) {
    res.status(403).json({
      error: "forbidden",
      ...diag,
    });
    return false;
  }
  return true;
}
