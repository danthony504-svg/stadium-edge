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
  "admin_test" | "live_probe" | "app_browse";

let notifiedPeriod = "";
let notifiedThreshold = 0;
const pausedKeys = new Map<string, string>();

function headerInteger(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  return raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function oddsProviderFetch(url: string, caller: OddsCaller, init?: RequestInit): Promise<Response> {
  const endpoint = new URL(url);
  const day = new Date().toISOString().slice(0, 10);
  const budget = process.env[`ODDS_DAILY_BUDGET_${caller.toUpperCase()}`];
  const key = createHash("sha256").update(endpoint.searchParams.get("apiKey") ?? "").digest("hex");
  const paused = pausedKeys.get(key);
  if (paused && Date.parse(paused) > Date.now()) throw new OddsQuotaExhausted(paused);
  if (budget != null && /^\d+$/.test(budget)) {
    const markets = endpoint.searchParams.get("markets")?.split(",").length ?? 0;
    const regions = endpoint.searchParams.get("regions")?.split(",").length ?? 1;
    const reserved = markets * regions;
    if (!await reserveDailyOddsCredits(caller, reserved, Number(budget))) {
      logger.warn({ caller, day, reserved }, "odds provider daily budget reached");
      return Response.json({ error_code: "LOCAL_DAILY_CREDIT_BUDGET" }, { status: 403 });
    }
  }
  const isTestKey = Boolean(process.env.ODDS_TEST_API_KEY) &&
    endpoint.searchParams.get("apiKey") === process.env.ODDS_TEST_API_KEY;
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
    if (period !== notifiedPeriod) { notifiedPeriod = period; notifiedThreshold = 0; }
    for (const percent of [70, 90]) {
      if (used * 100 >= monthly * percent && percent > notifiedThreshold) {
        notifiedThreshold = percent;
        logger.warn({ caller, percent, used, remaining, monthly, period }, "odds provider credit threshold");
      }
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
