/**
 * Production health probes for the 90-minute Reliability Center cron.
 * Pure check runners — Telegram / dedupe live in reliabilityHealthStore.
 */

import { logger } from "./logger.js";

export type HealthCheckId =
  | "website"
  | "api"
  | "ssl"
  | "response_time"
  | "database"
  | "odds_feed"
  | "player_props"
  | "ai_coach"
  | "game_simulator"
  | "steals_scanner";

export type HealthCheckResult = {
  id: HealthCheckId;
  ok: boolean;
  latencyMs: number;
  detail: string;
  httpStatus?: number;
};

export type HealthCheckEnv = {
  publicWebsiteUrl?: string;
  publicApiBase?: string;
  selfPort?: string | number;
  responseTimeBudgetMs?: number;
  fetchFn?: typeof fetch;
  /** Injected for synthetic failure tests. */
  forceFail?: Partial<Record<HealthCheckId, string>>;
};

const DEFAULT_WEBSITE = "https://stadiumedge.app";
const DEFAULT_API = "https://stadium-edge.onrender.com";
const DEFAULT_RT_BUDGET_MS = 12_000;

function apiBase(env: HealthCheckEnv): string {
  const raw = (env.publicApiBase ?? process.env.RELIABILITY_PUBLIC_API_BASE ?? DEFAULT_API)
    .trim()
    .replace(/\/$/, "");
  return raw.endsWith("/api") ? raw.slice(0, -4) : raw;
}

function websiteUrl(env: HealthCheckEnv): string {
  return (
    env.publicWebsiteUrl ??
    process.env.RELIABILITY_PUBLIC_WEBSITE_URL ??
    DEFAULT_WEBSITE
  ).trim();
}

function selfLoopback(env: HealthCheckEnv): string {
  const port = env.selfPort ?? process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

async function timedFetch(
  url: string,
  init: RequestInit | undefined,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<{ res: Response | null; latencyMs: number; error?: string }> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ac.signal });
    return { res, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      res: null,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkWebsite(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "website";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const url = websiteUrl(env);
  const { res, latencyMs, error } = await timedFetch(url, undefined, fetchFn, 15_000);
  if (!res) {
    return { id, ok: false, latencyMs, detail: error ?? "unreachable" };
  }
  const ok = res.status >= 200 && res.status < 400;
  return {
    id,
    ok,
    latencyMs,
    httpStatus: res.status,
    detail: ok ? `http ${res.status}` : `http ${res.status}`,
  };
}

async function checkSsl(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "ssl";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const url = `${apiBase(env)}/api/healthz`;
  const { res, latencyMs, error } = await timedFetch(url, undefined, fetchFn, 15_000);
  if (!res) {
    const detail = (error ?? "").toLowerCase();
    const sslFail =
      detail.includes("cert") ||
      detail.includes("ssl") ||
      detail.includes("tls") ||
      detail.includes("unable to verify");
    return {
      id,
      ok: false,
      latencyMs,
      detail: sslFail ? `ssl error: ${error}` : `unreachable: ${error}`,
    };
  }
  // Successful HTTPS fetch implies TLS handshake + cert validation succeeded
  // for the Node runtime trust store.
  return {
    id,
    ok: true,
    latencyMs,
    httpStatus: res.status,
    detail: "tls handshake ok",
  };
}

async function checkApi(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "api";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  // Prefer loopback so the cron exercise the live process; fall back to public.
  const urls = [
    `${selfLoopback(env)}/api/healthz`,
    `${apiBase(env)}/api/healthz`,
  ];
  let last: HealthCheckResult = {
    id,
    ok: false,
    latencyMs: 0,
    detail: "no attempt",
  };
  for (const url of urls) {
    const { res, latencyMs, error } = await timedFetch(url, undefined, fetchFn, 20_000);
    if (!res) {
      last = { id, ok: false, latencyMs, detail: error ?? "unreachable" };
      continue;
    }
    let bodyOk = false;
    try {
      const j = (await res.json()) as { status?: string };
      bodyOk = j?.status === "ok";
    } catch {
      bodyOk = false;
    }
    const ok = res.status === 200 && bodyOk;
    last = {
      id,
      ok,
      latencyMs,
      httpStatus: res.status,
      detail: ok ? "healthz ok" : `healthz bad status=${res.status}`,
    };
    if (ok) return last;
  }
  return last;
}

async function checkResponseTime(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "response_time";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const budget =
    env.responseTimeBudgetMs ??
    Number(process.env.RELIABILITY_RESPONSE_TIME_BUDGET_MS ?? DEFAULT_RT_BUDGET_MS);
  const url = `${apiBase(env)}/api/healthz`;
  const { res, latencyMs, error } = await timedFetch(url, undefined, fetchFn, budget + 5_000);
  if (!res) {
    return { id, ok: false, latencyMs, detail: error ?? "unreachable" };
  }
  const ok = latencyMs <= budget && res.status >= 200 && res.status < 500;
  return {
    id,
    ok,
    latencyMs,
    httpStatus: res.status,
    detail: ok
      ? `${latencyMs}ms ≤ ${budget}ms`
      : `${latencyMs}ms exceeds budget ${budget}ms`,
  };
}

async function checkDatabase(env: HealthCheckEnv): Promise<HealthCheckResult> {
  const id: HealthCheckId = "database";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const started = Date.now();
  try {
    // Lazy import so unit tests that only exercise forceFail / formatters
    // do not require DATABASE_URL + full drizzle schema resolution.
    const { sql } = await import("drizzle-orm");
    const { db } = await import("@workspace/db");
    await db.execute(sql`select 1 as ok`);
    return {
      id,
      ok: true,
      latencyMs: Date.now() - started,
      detail: "select 1 ok",
    };
  } catch (err) {
    return {
      id,
      ok: false,
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message.slice(0, 160) : "db error",
    };
  }
}

/** Games that started more than this ago with zero upcoming → stale slate. */
export const ODDS_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Pure freshness gate for odds health. Empty slate stays OK (off-season).
 * Non-empty slate must include at least one game that has not been finished
 * for ODDS_STALE_AFTER_MS (allows live/in-progress; fails all-historical dumps).
 */
export function oddsFeedFreshness(
  games: readonly { commenceTime?: string | null; markets?: unknown[] | null }[],
  nowMs: number = Date.now(),
): { ok: boolean; detail: string } {
  if (!games.length) {
    return { ok: true, detail: "odds route ok (empty slate)" };
  }
  const first = games[0]!;
  const hasMarkets = Array.isArray(first.markets) && first.markets.length > 0;
  if (!hasMarkets) {
    return { ok: false, detail: "odds games missing markets" };
  }
  let upcomingOrLive = 0;
  for (const g of games) {
    const t = g.commenceTime ? Date.parse(String(g.commenceTime)) : NaN;
    if (!Number.isFinite(t)) continue;
    // Still upcoming, or started within the staleness window (live/recent).
    if (t + ODDS_STALE_AFTER_MS >= nowMs) upcomingOrLive += 1;
  }
  if (upcomingOrLive === 0) {
    return {
      ok: false,
      detail: `odds stale — ${games.length} games all older than ${ODDS_STALE_AFTER_MS / 3600000}h`,
    };
  }
  return {
    ok: true,
    detail: `odds ok games=${games.length} fresh=${upcomingOrLive}`,
  };
}

async function checkOddsFeed(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "odds_feed";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const url = `${selfLoopback(env)}/api/sports/odds?sport=nfl`;
  const publicUrl = `${apiBase(env)}/api/sports/odds?sport=nfl`;
  for (const target of [url, publicUrl]) {
    const { res, latencyMs, error } = await timedFetch(target, undefined, fetchFn, 45_000);
    if (!res) {
      continue;
    }
    if (res.status >= 500) {
      return {
        id,
        ok: false,
        latencyMs,
        httpStatus: res.status,
        detail: `odds http ${res.status}`,
      };
    }
    try {
      const body = (await res.json()) as unknown;
      const arr = Array.isArray(body) ? body : null;
      if (!arr) {
        return {
          id,
          ok: false,
          latencyMs,
          httpStatus: res.status,
          detail: "odds payload not array",
        };
      }
      const freshness = oddsFeedFreshness(
        arr as { commenceTime?: string; markets?: unknown[] }[],
      );
      return {
        id,
        ok: freshness.ok,
        latencyMs,
        httpStatus: res.status,
        detail: freshness.detail,
      };
    } catch {
      return {
        id,
        ok: false,
        latencyMs,
        httpStatus: res.status,
        detail: "odds json parse failed",
      };
    }
  }
  return { id, ok: false, latencyMs: 0, detail: errorOr("odds unreachable") };
}

function errorOr(fallback: string): string {
  return fallback;
}

async function checkPlayerProps(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "player_props";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  // Resolve a real event id from odds, then probe props.
  const oddsUrl = `${apiBase(env)}/api/sports/odds?sport=nfl`;
  const odds = await timedFetch(oddsUrl, undefined, fetchFn, 45_000);
  if (!odds.res || odds.res.status >= 500) {
    return {
      id,
      ok: false,
      latencyMs: odds.latencyMs,
      httpStatus: odds.res?.status,
      detail: odds.error ?? `odds prerequisite http ${odds.res?.status ?? "?"}`,
    };
  }
  let eventId = "00000000000000000000000000000000";
  try {
    const body = (await odds.res.json()) as Array<{ id?: string }>;
    if (Array.isArray(body) && body[0]?.id) eventId = String(body[0].id);
  } catch {
    /* keep sentinel */
  }
  // eventId-only is valid: props route resolves ESPN team ids authoritatively.
  const propsUrl = `${apiBase(env)}/api/sports/props?sport=nfl&eventId=${encodeURIComponent(eventId)}`;
  const { res, latencyMs, error } = await timedFetch(propsUrl, undefined, fetchFn, 45_000);
  if (!res) {
    return { id, ok: false, latencyMs, detail: error ?? "props unreachable" };
  }
  // 400 on bad id is still a live route; 502 (missing ODDS_API_KEY / upstream) fails.
  if (res.status >= 500) {
    return {
      id,
      ok: false,
      latencyMs,
      httpStatus: res.status,
      detail: `props http ${res.status}`,
    };
  }
  try {
    const j = (await res.json()) as { props?: unknown; error?: string };
    if (res.status === 400 && j?.error) {
      // Route is up and validating — acceptable for monitoring.
      return {
        id,
        ok: true,
        latencyMs,
        httpStatus: res.status,
        detail: "props route validating",
      };
    }
    const props = Array.isArray(j?.props) ? j.props : null;
    return {
      id,
      ok: props != null,
      latencyMs,
      httpStatus: res.status,
      detail:
        props != null
          ? `props ok count=${props.length}`
          : "props payload missing props[]",
    };
  } catch {
    return {
      id,
      ok: false,
      latencyMs,
      httpStatus: res.status,
      detail: "props json parse failed",
    };
  }
}

async function checkAiCoach(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "ai_coach";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const url = `${apiBase(env)}/api/healthz`;
  const { res, latencyMs, error } = await timedFetch(url, undefined, fetchFn, 30_000);
  if (!res) {
    return { id, ok: false, latencyMs, detail: error ?? "unreachable" };
  }
  try {
    const j = (await res.json()) as {
      ai?: { configured?: boolean; ok?: boolean; chat?: { ok?: boolean } };
    };
    const configured = !!j?.ai?.configured;
    const ok = configured && j?.ai?.ok === true && j?.ai?.chat?.ok === true;
    return {
      id,
      ok,
      latencyMs,
      httpStatus: res.status,
      detail: ok
        ? "ai+chat probe ok"
        : `ai configured=${configured} ok=${j?.ai?.ok} chat=${j?.ai?.chat?.ok}`,
    };
  } catch {
    return {
      id,
      ok: false,
      latencyMs,
      httpStatus: res.status,
      detail: "healthz json parse failed",
    };
  }
}

async function checkGameSimulator(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "game_simulator";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const url = `${apiBase(env)}/api/sports/simulate/game-outcome`;
  const { res, latencyMs, error } = await timedFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: "nfl",
        homeTeamId: "1",
        awayTeamId: "2",
        homeTeam: "Health Check Home",
        awayTeam: "Health Check Away",
        simulations: 10,
      }),
    },
    fetchFn,
    60_000,
  );
  if (!res) {
    return { id, ok: false, latencyMs, detail: error ?? "simulate unreachable" };
  }
  // 5xx = system failure. 4xx validation / insufficient data still proves route is live.
  if (res.status >= 500) {
    return {
      id,
      ok: false,
      latencyMs,
      httpStatus: res.status,
      detail: `simulate http ${res.status}`,
    };
  }
  return {
    id,
    ok: true,
    latencyMs,
    httpStatus: res.status,
    detail: `simulate route http ${res.status}`,
  };
}

async function checkStealsScanner(
  env: HealthCheckEnv,
  fetchFn: typeof fetch,
): Promise<HealthCheckResult> {
  const id: HealthCheckId = "steals_scanner";
  if (env.forceFail?.[id]) {
    return { id, ok: false, latencyMs: 0, detail: env.forceFail[id]! };
  }
  const url = `${apiBase(env)}/api/sports/live-steals`;
  const { res, latencyMs, error } = await timedFetch(url, undefined, fetchFn, 45_000);
  if (!res) {
    return { id, ok: false, latencyMs, detail: error ?? "steals unreachable" };
  }
  if (res.status >= 500) {
    return {
      id,
      ok: false,
      latencyMs,
      httpStatus: res.status,
      detail: `steals http ${res.status}`,
    };
  }
  try {
    const j = (await res.json()) as { steals?: unknown };
    const ok = Array.isArray(j?.steals);
    return {
      id,
      ok,
      latencyMs,
      httpStatus: res.status,
      detail: ok
        ? `steals ok count=${(j.steals as unknown[]).length}`
        : "steals payload missing steals[]",
    };
  } catch {
    return {
      id,
      ok: false,
      latencyMs,
      httpStatus: res.status,
      detail: "steals json parse failed",
    };
  }
}

export async function runReliabilityHealthChecks(
  env: HealthCheckEnv = {},
): Promise<HealthCheckResult[]> {
  const fetchFn = env.fetchFn ?? fetch;
  const checks = await Promise.all([
    checkWebsite(env, fetchFn),
    checkApi(env, fetchFn),
    checkSsl(env, fetchFn),
    checkResponseTime(env, fetchFn),
    checkDatabase(env),
    checkOddsFeed(env, fetchFn),
    checkPlayerProps(env, fetchFn),
    checkAiCoach(env, fetchFn),
    checkGameSimulator(env, fetchFn),
    checkStealsScanner(env, fetchFn),
  ]);
  logger.info(
    {
      failed: checks.filter((c) => !c.ok).map((c) => c.id),
      okCount: checks.filter((c) => c.ok).length,
    },
    "reliability health checks complete",
  );
  return checks;
}

export function summarizeHealthChecks(checks: HealthCheckResult[]): {
  ok: boolean;
  failed: HealthCheckId[];
  passed: HealthCheckId[];
} {
  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  const passed = checks.filter((c) => c.ok).map((c) => c.id);
  return { ok: failed.length === 0, failed, passed };
}
