/**
 * Sanitized Coach reliability metadata — no emails, Clerk userIds, JWTs,
 * Authorization headers, or raw user question text in Telegram / DB rows.
 */

import {
  isParlayBuildAsk,
  resolveBuildLegTarget,
  wantsLiveCoachAsk,
} from "./coachAskAccess.js";
import { sanitizeReliabilityText } from "./reliabilitySanitize.js";

export const COACH_EVENT_TYPES = [
  "parlay_requested",
  "parlay_fulfilled",
  "parlay_underfilled",
  "parlay_zero_results",
  "coach_timeout",
  "coach_exception",
  "coach_question_received",
  "coach_question_failed",
  "coach_empty_response",
] as const;

export type CoachEventType = (typeof COACH_EVENT_TYPES)[number];

/** Events that page Telegram immediately (still fingerprint-deduped). */
export const COACH_ALERT_EVENT_TYPES: ReadonlySet<CoachEventType> = new Set([
  "parlay_underfilled",
  "parlay_zero_results",
  "coach_timeout",
  "coach_exception",
  "coach_question_failed",
  "coach_empty_response",
]);

export type CoachSportCategory =
  | "nfl"
  | "ncaaf"
  | "nba"
  | "wnba"
  | "mlb"
  | "nhl"
  | "soccer"
  | "ufc"
  | "tennis"
  | "multi"
  | "unspecified";

export type CoachQuestionKind =
  | "parlay_build"
  | "live_qa"
  | "roster_qa"
  | "odds_qa"
  | "injury_qa"
  | "photo_qa"
  | "general_qa";

export type CoachFailureReason =
  | "none"
  | "underfilled"
  | "zero_results"
  | "timeout"
  | "exception"
  | "empty_response"
  | "preview_unsafe"
  | "preview_degraded"
  | "ai_config"
  | "upstream_error"
  | "unknown";

export type CoachReliabilityMeta = {
  eventType: CoachEventType;
  sportCategory: CoachSportCategory;
  questionKind: CoachQuestionKind;
  requestedLegCount: number | null;
  returnedLegCount: number | null;
  durationMs: number | null;
  failureReason: CoachFailureReason;
  realOddsAvailable: boolean | null;
  qualificationFiltersEliminated: boolean | null;
  answered: boolean | null;
  /** Folded duration samples for percentile digest (capped). */
  durationSamples?: number[];
};

const MAX_SAMPLES = 64;

export function classifyCoachSportCategory(text: string): CoachSportCategory {
  const t = String(text || "").toLowerCase();
  const hits: CoachSportCategory[] = [];
  if (/\bnfl\b/.test(t)) hits.push("nfl");
  if (/\bncaaf\b|\bcfb\b|\bcollege\s+football\b/.test(t)) hits.push("ncaaf");
  if (/\bnba\b/.test(t)) hits.push("nba");
  if (/\bwnba\b/.test(t)) hits.push("wnba");
  if (/\bmlb\b|\bbaseball\b/.test(t)) hits.push("mlb");
  if (/\bnhl\b|\bhockey\b/.test(t)) hits.push("nhl");
  if (/\bsoccer\b|\bepl\b|\bmls\b|\buefa\b/.test(t)) hits.push("soccer");
  if (/\bufc\b|\bmma\b/.test(t)) hits.push("ufc");
  if (/\btennis\b/.test(t)) hits.push("tennis");
  const unique = [...new Set(hits)];
  if (unique.length === 0) return "unspecified";
  if (unique.length > 1) return "multi";
  return unique[0]!;
}

export function classifyCoachQuestionKind(
  text: string,
  opts: { hasImages?: boolean } = {},
): CoachQuestionKind {
  if (opts.hasImages) return "photo_qa";
  if (isParlayBuildAsk(text)) return "parlay_build";
  if (wantsLiveCoachAsk(text)) return "live_qa";
  const t = String(text || "").toLowerCase();
  if (/\binjur/.test(t) || /\bout\s+for\b/.test(t)) return "injury_qa";
  if (/\broster\b|\bwho\s+plays\b|\bstarting\b|\blineup\b/.test(t)) {
    return "roster_qa";
  }
  if (/\bodds\b|\bline\b|\bspread\b|\bmoneyline\b|\btotal\b/.test(t)) {
    return "odds_qa";
  }
  return "general_qa";
}

/** Count model-emitted PICK lines (observe-only; does not change selection). */
export function countCoachPickLines(text: string): number {
  const m = String(text || "").match(/^\s*PICK\s*:/gim);
  return m ? m.length : 0;
}

export function coachRequestedLegs(text: string): number {
  return resolveBuildLegTarget(text);
}

export function classifyParlayOutcome(opts: {
  requestedLegCount: number;
  returnedLegCount: number;
}): Extract<
  CoachEventType,
  "parlay_fulfilled" | "parlay_underfilled" | "parlay_zero_results"
> {
  if (opts.returnedLegCount <= 0) return "parlay_zero_results";
  if (opts.returnedLegCount < opts.requestedLegCount) return "parlay_underfilled";
  return "parlay_fulfilled";
}

export function coachAlertFingerprint(meta: CoachReliabilityMeta): string {
  const parts = [
    "coach",
    meta.eventType,
    meta.failureReason,
    meta.sportCategory,
    meta.questionKind,
    meta.requestedLegCount ?? "x",
    meta.returnedLegCount ?? "x",
  ];
  return sanitizeReliabilityText(parts.join("|"), 200);
}

export function coachEventSummary(meta: CoachReliabilityMeta): string {
  const legs =
    meta.requestedLegCount != null
      ? `${meta.returnedLegCount ?? 0}/${meta.requestedLegCount} legs`
      : "n/a legs";
  return sanitizeReliabilityText(
    `Coach ${meta.eventType} · ${meta.sportCategory} · ${meta.questionKind} · ${legs}` +
      (meta.failureReason !== "none" ? ` · ${meta.failureReason}` : ""),
    400,
  );
}

export function serializeCoachMeta(meta: CoachReliabilityMeta): string {
  const safe: CoachReliabilityMeta = {
    eventType: meta.eventType,
    sportCategory: meta.sportCategory,
    questionKind: meta.questionKind,
    requestedLegCount: meta.requestedLegCount,
    returnedLegCount: meta.returnedLegCount,
    durationMs:
      typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)
        ? Math.max(0, Math.round(meta.durationMs))
        : null,
    failureReason: meta.failureReason,
    realOddsAvailable: meta.realOddsAvailable,
    qualificationFiltersEliminated: meta.qualificationFiltersEliminated,
    answered: meta.answered,
    durationSamples: Array.isArray(meta.durationSamples)
      ? meta.durationSamples
          .filter((n) => typeof n === "number" && Number.isFinite(n))
          .map((n) => Math.max(0, Math.round(n)))
          .slice(-MAX_SAMPLES)
      : undefined,
  };
  return JSON.stringify(safe).slice(0, 1800);
}

export function parseCoachMeta(raw: string | null | undefined): CoachReliabilityMeta | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<CoachReliabilityMeta>;
    if (!j || typeof j !== "object") return null;
    if (!COACH_EVENT_TYPES.includes(j.eventType as CoachEventType)) return null;
    return {
      eventType: j.eventType as CoachEventType,
      sportCategory: (j.sportCategory as CoachSportCategory) || "unspecified",
      questionKind: (j.questionKind as CoachQuestionKind) || "general_qa",
      requestedLegCount:
        typeof j.requestedLegCount === "number" ? j.requestedLegCount : null,
      returnedLegCount:
        typeof j.returnedLegCount === "number" ? j.returnedLegCount : null,
      durationMs: typeof j.durationMs === "number" ? j.durationMs : null,
      failureReason: (j.failureReason as CoachFailureReason) || "unknown",
      realOddsAvailable:
        typeof j.realOddsAvailable === "boolean" ? j.realOddsAvailable : null,
      qualificationFiltersEliminated:
        typeof j.qualificationFiltersEliminated === "boolean"
          ? j.qualificationFiltersEliminated
          : null,
      answered: typeof j.answered === "boolean" ? j.answered : null,
      durationSamples: Array.isArray(j.durationSamples)
        ? j.durationSamples.filter((n): n is number => typeof n === "number")
        : undefined,
    };
  } catch {
    return null;
  }
}

export function appendDurationSample(
  existing: CoachReliabilityMeta | null,
  durationMs: number | null,
): number[] {
  const prev = existing?.durationSamples ?? [];
  const next = [...prev];
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    next.push(Math.max(0, Math.round(durationMs)));
  }
  return next.slice(-MAX_SAMPLES);
}

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx]!;
}
