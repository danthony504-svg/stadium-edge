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
  legitimateUnderfillCount?: number;
  zeroResultCount: number;
  /** Policy gate (e.g. NCAAF unvalidated) — digest only, not a failure alert. */
  blockedUnvalidatedMarketCount?: number;
  questionFailureCount: number;
  groundingFailureCount?: number;
  altMarketFailureCount?: number;
  simulationFailureCount?: number;
  scanFreezeCount?: number;
  /** Legacy unknown outcomes — separate from underfill/zero/freeze. */
  unknownOutcomeCount?: number;
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
  failureCategory?: string | null;
  realOddsAvailable: boolean | null;
  qualificationFiltersEliminated: boolean | null;
  requestId?: string | null;
  affectedGame?: string | null;
  rootCause?: string | null;
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
    `category: ${event.failureCategory ?? "—"}`,
    `summary: ${event.summary}`,
    `sport: ${event.sportCategory}`,
    `legs: ${legs}`,
    `reason: ${event.failureReason}`,
    event.requestId ? `requestId: ${event.requestId}` : null,
    event.affectedGame ? `game: ${event.affectedGame}` : null,
    event.rootCause ? `rootCause: ${event.rootCause}` : null,
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
  const coverageNote =
    coach.totalRequests === 0
      ? "coverage: 0 received Coach events ≠ verified zero Coach usage (tip-boot crash can block client; check server chat path separately)"
      : "coverage: counts are received reliability events only";
  return [
    "🤖 Coach activity (received events)",
    `requests received: ${coach.totalRequests}`,
    `successful parlays: ${coach.successfulRequests}`,
    `fulfillment: ${coach.fulfillmentPct == null ? "—" : `${coach.fulfillmentPct}%`}`,
    `underfill: ${coach.underfillCount}` +
      (coach.legitimateUnderfillCount != null
        ? ` (legit ${coach.legitimateUnderfillCount})`
        : "") +
      ` · zero: ${coach.zeroResultCount}`,
    `blocked unvalidated market: ${coach.blockedUnvalidatedMarketCount ?? 0}`,
    `question failures: ${coach.questionFailureCount}`,
    `grounding/alt/sim/freeze: ${coach.groundingFailureCount ?? 0}/${coach.altMarketFailureCount ?? 0}/${coach.simulationFailureCount ?? 0}/${coach.scanFreezeCount ?? 0}`,
    `unknown outcomes: ${coach.unknownOutcomeCount ?? 0}`,
    `p50/p95 ms: ${coach.p50Ms ?? "—"} / ${coach.p95Ms ?? "—"}`,
    `top failures: ${top}`,
    coverageNote,
  ].join("\n");
}

export function formatHealthFailureAlert(event: {
  checkId: string;
  detail: string;
  latencyMs: number;
  httpStatus?: number;
  occurrenceCount?: number;
}): string {
  const n = event.occurrenceCount ?? 1;
  return [
    "🚨 Stadium Edge health check FAILED",
    `check: ${event.checkId}`,
    `detail: ${event.detail}`,
    `latencyMs: ${event.latencyMs}`,
    event.httpStatus != null ? `http: ${event.httpStatus}` : null,
    n > 1 ? `occurrences: ${n} (deduped)` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatHealthRecoveryAlert(event: {
  checkId: string;
  detail: string;
  latencyMs: number;
}): string {
  return [
    "✅ Stadium Edge health check RECOVERED",
    `check: ${event.checkId}`,
    `detail: ${event.detail}`,
    `latencyMs: ${event.latencyMs}`,
  ].join("\n");
}

export function formatDailyHealthySummary(stats: {
  windowHours: number;
  criticalCount: number;
  distinctFingerprints: number;
  lastCriticalAt: string | null;
  coach?: CoachDigestTelegramStats | null;
  healthOk?: boolean | null;
  healthFailed?: string[] | null;
}): string {
  const coachBlock = stats.coach
    ? ["", formatCoachDailyDigestSection(stats.coach)]
    : [];

  // Server health probes (website/api/db/odds/…) — independent of crash ingest.
  const healthBlock =
    stats.healthOk == null
      ? [
          "🩺 Server health (probes)",
          "status: probe unavailable this digest run",
          "note: probe failure ≠ device crash status",
        ]
      : stats.healthOk
        ? [
            "🩺 Server health (probes)",
            "status: all checks OK (last probe)",
            "note: server OK ≠ verified client health",
          ]
        : [
            "🩺 Server health (probes)",
            `status: FAILING ${(stats.healthFailed ?? []).join(", ") || "checks"}`,
          ];

  // Crash rows in PG — received JS/client reports only. Tip-boot / native Expo
  // ErrorRecovery fatals often never reach this path.
  const crashBlock =
    stats.criticalCount === 0
      ? [
          "📱 Device crash telemetry (JS ingest)",
          `Last ${stats.windowHours}h: 0 critical crash reports received`,
          "coverage: 0 received ≠ 0 actual crashes or verified app health",
          "gap: tip-boot / Expo ErrorRecovery fatals before JS handlers do not POST",
        ]
      : [
          "📱 Device crash telemetry (JS ingest)",
          `Last ${stats.windowHours}h: ${stats.criticalCount} critical report(s) received`,
          `Distinct fingerprints: ${stats.distinctFingerprints}`,
          `Last critical: ${stats.lastCriticalAt ?? "—"}`,
          "coverage: received client reports only — not a full crash census",
        ];

  const headline =
    stats.criticalCount === 0 && stats.healthOk === true
      ? "📋 Stadium Edge reliability — daily digest (received telemetry)"
      : stats.criticalCount > 0 || stats.healthOk === false
        ? "⚠️ Stadium Edge reliability — daily digest"
        : "📋 Stadium Edge reliability — daily digest (received telemetry)";

  return [
    headline,
    "",
    ...healthBlock,
    "",
    ...crashBlock,
    ...coachBlock,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
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
