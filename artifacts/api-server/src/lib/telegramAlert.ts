/**
 * Server-only Telegram alerts for reliability events.
 * Credentials never leave the API process.
 */

import { logger } from "./logger.js";

export type TelegramSendResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export function telegramConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if ((env.RELIABILITY_TELEGRAM_ENABLED ?? "1").trim() === "0") return false;
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chat = (env.TELEGRAM_CHAT_ID ?? "").trim();
  return token.length > 10 && chat.length > 0;
}

export function formatCriticalCrashAlert(event: {
  fingerprint: string;
  errorMessage: string;
  updateId: string;
  runtimeVersion: string;
  channel: string;
  appVersion: string;
  platform: string;
  occurrenceCount?: number;
}): string {
  const n = event.occurrenceCount ?? 1;
  return [
    "🚨 Stadium Edge critical crash",
    `msg: ${event.errorMessage}`,
    `fp: ${event.fingerprint}`,
    `update: ${event.updateId}`,
    `runtime: ${event.runtimeVersion} · channel: ${event.channel}`,
    `app: ${event.appVersion} · platform: ${event.platform}`,
    n > 1 ? `occurrences: ${n} (deduped)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export type CoachDigestTelegramStats = {
  totalRequests: number;
  successfulRequests: number;
  fulfillmentPct: number | null;
  underfillCount: number;
  zeroResultCount: number;
  questionFailureCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  topFailureReasons: Array<{ reason: string; count: number }>;
};

export function formatCoachReliabilityAlert(event: {
  eventType: string;
  summary: string;
  sportCategory: string;
  requestedLegCount: number | null;
  returnedLegCount: number | null;
  durationMs: number | null;
  failureReason: string;
  realOddsAvailable: boolean | null;
  qualificationFiltersEliminated: boolean | null;
  occurrenceCount?: number;
}): string {
  const n = event.occurrenceCount ?? 1;
  const legs =
    event.requestedLegCount != null
      ? `${event.returnedLegCount ?? 0}/${event.requestedLegCount}`
      : "—";
  return [
    "⚠️ Stadium Edge Coach alert",
    `type: ${event.eventType}`,
    `summary: ${event.summary}`,
    `sport: ${event.sportCategory}`,
    `legs: ${legs}`,
    `reason: ${event.failureReason}`,
    event.durationMs != null ? `durationMs: ${event.durationMs}` : null,
    event.realOddsAvailable != null
      ? `realOddsAvailable: ${event.realOddsAvailable}`
      : null,
    event.qualificationFiltersEliminated != null
      ? `qualificationFiltersEliminated: ${event.qualificationFiltersEliminated}`
      : null,
    n > 1 ? `occurrences: ${n} (deduped)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatCoachDailyDigestSection(
  coach: CoachDigestTelegramStats,
): string {
  const top =
    coach.topFailureReasons.length > 0
      ? coach.topFailureReasons
          .map((r) => `${r.reason}:${r.count}`)
          .join(", ")
      : "—";
  return [
    "🤖 Coach fulfillment",
    `requests: ${coach.totalRequests}`,
    `successful parlays: ${coach.successfulRequests}`,
    `fulfillment: ${coach.fulfillmentPct == null ? "—" : `${coach.fulfillmentPct}%`}`,
    `underfill: ${coach.underfillCount} · zero: ${coach.zeroResultCount}`,
    `question failures: ${coach.questionFailureCount}`,
    `p50/p95 ms: ${coach.p50Ms ?? "—"} / ${coach.p95Ms ?? "—"}`,
    `top failures: ${top}`,
  ].join("\n");
}

export function formatDailyHealthySummary(stats: {
  windowHours: number;
  criticalCount: number;
  distinctFingerprints: number;
  lastCriticalAt: string | null;
  coach?: CoachDigestTelegramStats | null;
}): string {
  const coachBlock = stats.coach
    ? ["", formatCoachDailyDigestSection(stats.coach)]
    : [];
  if (stats.criticalCount === 0) {
    return [
      "✅ Stadium Edge reliability — healthy",
      `Last ${stats.windowHours}h: 0 critical crashes`,
      "Ingest + Telegram path OK",
      ...coachBlock,
    ].join("\n");
  }
  return [
    "⚠️ Stadium Edge reliability — daily summary",
    `Last ${stats.windowHours}h: ${stats.criticalCount} critical report(s)`,
    `Distinct fingerprints: ${stats.distinctFingerprints}`,
    `Last critical: ${stats.lastCriticalAt ?? "—"}`,
    ...coachBlock,
  ].join("\n");
}

/** Pure helper: should we page Telegram for this fingerprint? */
export function shouldSendCriticalTelegram(opts: {
  lastAlertedAt: Date | null | undefined;
  nowMs: number;
  dedupeWindowMs: number;
}): boolean {
  if (!opts.lastAlertedAt) return true;
  return opts.nowMs - opts.lastAlertedAt.getTime() >= opts.dedupeWindowMs;
}

/**
 * POST to Telegram Bot API. Fail-soft — never throws to callers.
 */
export async function sendTelegramMessage(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<TelegramSendResult> {
  if (!telegramConfigured(env)) {
    return { ok: true, skipped: true, reason: "telegram not configured" };
  }
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID ?? "").trim();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5_000);
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, detail: detail.slice(0, 200) },
        "telegram send failed",
      );
      return { ok: false, error: `http ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, "telegram send error");
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}
