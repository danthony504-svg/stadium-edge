import { createHash, timingSafeEqual } from "node:crypto";
import { reserveDailyOddsCredits } from "./store.js";
import { logger } from "./logger.js";

export const ODDS_QUOTA_EXHAUSTED = "ODDS_PROVIDER_QUOTA_EXHAUSTED";

export function nextOddsQuotaReset(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export class OddsQuotaExhausted extends Error {
  readonly resetAt: string;
  constructor(resetAt: string) {
    super(ODDS_QUOTA_EXHAUSTED);
    this.resetAt = resetAt;
  }
}

export type OddsCaller = "scheduled_refresh" | "coach_build" | "first_basket_collection" |
  "admin_test" | "live_probe" | "app_browse" | "unattributed";

let notifiedPeriod = "";
const notifiedThresholds = new Set<number>();
const pausedKeys = new Map<string, string>();

function headerInteger(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  return raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function sendOddsCreditAlert(text: string): Promise<boolean> {
  const destination = process.env.ODDS_CREDIT_ALERT_WEBHOOK_URL;
  if (!destination) return false;
  try {
    if (new URL(destination).protocol !== "https:") return false;
    const result = await fetch(destination, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }), signal: AbortSignal.timeout(3000), redirect: "error",
    });
    return result.ok;
  } catch { return false; }
}

export async function oddsProviderFetch(url: string, caller: OddsCaller = "unattributed", init?: RequestInit): Promise<Response> {
  const endpoint = new URL(url);
  const day = new Date().toISOString().slice(0, 10);
  const suppliedKey = endpoint.searchParams.get("apiKey");
  const isTestKey = Boolean(process.env.ODDS_TEST_API_KEY) &&
    suppliedKey === process.env.ODDS_TEST_API_KEY;
  if (isTestKey && (suppliedKey === process.env.ODDS_API_KEY ||
      (caller !== "live_probe" && caller !== "admin_test"))) {
    return Response.json({ error_code: "ODDS_TEST_KEY_ISOLATION" }, { status: 503 });
  }
  const budget = process.env[`ODDS_DAILY_BUDGET_${caller.toUpperCase()}`];
  const key = createHash("sha256").update(endpoint.searchParams.get("apiKey") ?? "").digest("hex");
  const paused = pausedKeys.get(key);
  if (paused && Date.parse(paused) > Date.now()) throw new OddsQuotaExhausted(paused);
  if (isTestKey || (budget != null && /^\d+$/.test(budget))) {
    const markets = endpoint.searchParams.get("markets")?.split(",").length ?? 0;
    const regions = endpoint.searchParams.get("regions")?.split(",").length ?? 1;
    const reserved = markets * regions;
    const cap = budget != null && /^\d+$/.test(budget) ? Number(budget) : 25;
    if (!await reserveDailyOddsCredits(isTestKey ? "test_key" : caller, reserved, isTestKey ? Math.min(25, cap) : cap, isTestKey)) {
      logger.warn({ caller, day, reserved }, "odds provider daily budget reached");
      return Response.json({ error_code: "LOCAL_DAILY_CREDIT_BUDGET" }, { status: 403 });
    }
  }
  const keyTier = isTestKey ? "test" : "production";
  const response = await fetch(url, init).catch((error: unknown) => {
    logger.warn({ caller, keyTier, endpoint: endpoint.pathname, status: null, remaining: null, cost: null }, "odds provider request failed");
    throw error;
  });
  const remaining = headerInteger(response.headers, "x-requests-remaining");
  const cost = headerInteger(response.headers, "x-requests-last");
  const used = headerInteger(response.headers, "x-requests-used");
  const monthly = Number(process.env.ODDS_MONTHLY_CREDIT_LIMIT ?? 0);
  logger.info({ caller, keyTier, endpoint: endpoint.pathname, status: response.status, remaining, cost, used }, "odds provider usage");
  if (!isTestKey && monthly > 0 && used != null) {
    const period = day.slice(0, 7);
    if (period !== notifiedPeriod) { notifiedPeriod = period; notifiedThresholds.clear(); }
    for (const percent of [70, 90]) {
      if (used * 100 < monthly * percent || notifiedThresholds.has(percent)) continue;
      notifiedThresholds.add(percent);
      logger.warn({ caller, percent, used, remaining, monthly, period }, "odds provider credit threshold");
      void sendOddsCreditAlert(`Stadium Edge Odds API usage reached ${percent}% for ${period}. ${used} of ${monthly} credits used.`).then(sent => {
        if (!sent) {
          if (notifiedPeriod === period) notifiedThresholds.delete(percent);
          logger.warn({ percent, period }, "odds credit alert delivery unavailable");
        }
      });
    }
  }
  if (response.status === 401) {
    const payload: unknown = await response.clone().json().catch(() => null);
    if (payload && typeof payload === "object" && "error_code" in payload &&
        payload.error_code === "OUT_OF_USAGE_CREDITS") {
      const resetAt = nextOddsQuotaReset();
      pausedKeys.set(key, resetAt);
      throw new OddsQuotaExhausted(resetAt);
    }
  }
  return response;
}


/** Only a server-authenticated diagnostics call may select the small-cap key. */
export function oddsDiagnosticCaller(token: string | undefined, label: string | undefined): "admin_test" | "live_probe" | null {
  const configured = process.env.ODDS_DIAGNOSTIC_TOKEN;
  if (!configured || !token || (label !== "admin_test" && label !== "live_probe")) return null;
  const provided = Buffer.from(token), expected = Buffer.from(configured);
  return provided.length === expected.length && timingSafeEqual(provided, expected) ? label : null;
}
