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
  "coach_cancelled",
  "coach_question_received",
  "coach_question_failed",
  "coach_empty_response",
  "coach_grounding_failure",
  "coach_odds_mismatch",
  "coach_alt_market_failure",
  "coach_simulation_failure",
  "coach_scan_freeze",
] as const;

export type CoachEventType = (typeof COACH_EVENT_TYPES)[number];

/**
 * Always-alert event types (still fingerprint-deduped).
 * Bare underfill is NOT always alertable — see shouldAlertCoachEvent.
 */
export const COACH_ALERT_EVENT_TYPES: ReadonlySet<CoachEventType> = new Set([
  "parlay_zero_results",
  "coach_timeout",
  "coach_exception",
  "coach_question_failed",
  "coach_empty_response",
  "coach_grounding_failure",
  "coach_odds_mismatch",
  "coach_alt_market_failure",
  "coach_simulation_failure",
  "coach_scan_freeze",
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
  | "legitimate_underfill"
  | "slate_thin"
  | "zero_results"
  | "blocked_unvalidated_market"
  | "timeout"
  | "exception"
  | "cancelled"
  | "empty_response"
  | "preview_unsafe"
  | "preview_degraded"
  | "ai_config"
  | "upstream_error"
  | "grounding_failure"
  | "odds_mismatch"
  | "alt_market_failure"
  | "simulation_failure"
  | "missing_sim_output"
  | "scan_freeze"
  | "unknown";

export type CoachFailureCategory =
  | "fulfillment"
  | "grounding"
  | "odds"
  | "alt_market"
  | "simulation"
  | "scan_freeze"
  | "timeout"
  | "exception"
  | "question"
  | "blocked_unvalidated_market"
  | "none";

export type CoachReliabilityMeta = {
  eventType: CoachEventType;
  sportCategory: CoachSportCategory;
  questionKind: CoachQuestionKind;
  requestedLegCount: number | null;
  returnedLegCount: number | null;
  durationMs: number | null;
  failureReason: CoachFailureReason;
  failureCategory: CoachFailureCategory;
  realOddsAvailable: boolean | null;
  qualificationFiltersEliminated: boolean | null;
  answered: boolean | null;
  requestId: string | null;
  affectedGame: string | null;
  rootCause: string | null;
  /** Folded duration samples for percentile digest (capped). */
  durationSamples?: number[];
  /** Expo Updates.updateId from the mobile client (observe-only). */
  updateId?: string | null;
  loadMs?: number | null;
  enrichmentMs?: number | null;
  propSimMs?: number | null;
  gameSimMs?: number | null;
  qualificationMs?: number | null;
  scanMs?: number | null;
  finalizationMs?: number | null;
  totalMs?: number | null;
  lastCompletedPhase?: string | null;
  pendingOperation?: string | null;
  timeoutReason?: string | null;
  terminalStatus?: string | null;
  requestedSport?: string | null;
  effectiveSports?: string[] | null;
  candidatesPoolBefore?: number | null;
  candidatesPoolAfter?: number | null;
  candidatesSelected?: number | null;
  deepSimRequested?: number | null;
  deepSimCompleted?: number | null;
  qualifiedCount?: number | null;
};

function optionalMs(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.round(v));
}

function optionalInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.round(v));
}

function optionalSports(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = [
    ...new Set(
      v
        .map((s) => String(s ?? "").toLowerCase().trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 24)),
    ),
  ].slice(0, 8);
  return out.length ? out : null;
}

/** Pull observe-only perf fields from a coach-events POST body. */
export function parseCoachPerfFields(
  b: Record<string, unknown>,
): Partial<CoachReliabilityMeta> {
  return {
    updateId:
      typeof b.updateId === "string"
        ? sanitizeReliabilityText(b.updateId, 80) || null
        : null,
    loadMs: optionalMs(b.loadMs),
    enrichmentMs: optionalMs(b.enrichmentMs),
    propSimMs: optionalMs(b.propSimMs),
    gameSimMs: optionalMs(b.gameSimMs),
    qualificationMs: optionalMs(b.qualificationMs),
    scanMs: optionalMs(b.scanMs),
    finalizationMs: optionalMs(b.finalizationMs),
    totalMs: optionalMs(b.totalMs) ?? optionalMs(b.durationMs),
    lastCompletedPhase:
      typeof b.lastCompletedPhase === "string"
        ? sanitizeReliabilityText(b.lastCompletedPhase, 40) || null
        : null,
    pendingOperation:
      typeof b.pendingOperation === "string"
        ? sanitizeReliabilityText(b.pendingOperation, 40) || null
        : null,
    timeoutReason:
      typeof b.timeoutReason === "string"
        ? sanitizeReliabilityText(b.timeoutReason, 40) || null
        : null,
    terminalStatus:
      typeof b.terminalStatus === "string"
        ? sanitizeReliabilityText(b.terminalStatus, 40) || null
        : null,
    requestedSport:
      typeof b.requestedSport === "string"
        ? sanitizeReliabilityText(b.requestedSport, 24) || null
        : null,
    effectiveSports: optionalSports(b.effectiveSports),
    candidatesPoolBefore: optionalInt(b.candidatesPoolBefore),
    candidatesPoolAfter: optionalInt(b.candidatesPoolAfter),
    candidatesSelected: optionalInt(b.candidatesSelected),
    deepSimRequested: optionalInt(b.deepSimRequested),
    deepSimCompleted: optionalInt(b.deepSimCompleted),
    qualifiedCount: optionalInt(b.qualifiedCount),
  };
}

const MAX_SAMPLES = 64;
const LEGITIMATE_UNDERFILL_REASONS: ReadonlySet<CoachFailureReason> = new Set([
  "legitimate_underfill",
  "slate_thin",
  "underfilled",
]);

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

/**
 * Distinguish thin-slate / quality-bar shortfalls (digest only) from system
 * failures that should page Telegram.
 */
export function classifyParlayFailureReason(opts: {
  outcome: Extract<
    CoachEventType,
    "parlay_fulfilled" | "parlay_underfilled" | "parlay_zero_results"
  >;
  realOddsAvailable: boolean | null;
  systemFailureReason?: CoachFailureReason | null;
}): CoachFailureReason {
  if (opts.systemFailureReason && opts.systemFailureReason !== "none") {
    return opts.systemFailureReason;
  }
  if (opts.outcome === "parlay_fulfilled") return "none";
  if (opts.outcome === "parlay_zero_results") {
    if (opts.realOddsAvailable === false) return "odds_mismatch";
    return "zero_results";
  }
  // Partial ticket with real odds present → usually thin slate / quality bar.
  if (opts.realOddsAvailable === true) return "legitimate_underfill";
  if (opts.realOddsAvailable === false) return "odds_mismatch";
  return "slate_thin";
}

export function failureCategoryFor(
  eventType: CoachEventType,
  reason: CoachFailureReason,
): CoachFailureCategory {
  if (eventType === "coach_cancelled" || reason === "cancelled") return "none";
  if (eventType === "coach_grounding_failure" || reason === "grounding_failure") {
    return "grounding";
  }
  if (eventType === "coach_odds_mismatch" || reason === "odds_mismatch") {
    return "odds";
  }
  if (eventType === "coach_alt_market_failure" || reason === "alt_market_failure") {
    return "alt_market";
  }
  if (
    eventType === "coach_simulation_failure" ||
    reason === "simulation_failure" ||
    reason === "missing_sim_output"
  ) {
    return "simulation";
  }
  if (eventType === "coach_scan_freeze" || reason === "scan_freeze") {
    return "scan_freeze";
  }
  if (eventType === "coach_timeout" || reason === "timeout") return "timeout";
  if (
    eventType === "coach_exception" ||
    reason === "exception" ||
    reason === "upstream_error"
  ) {
    return "exception";
  }
  if (
    eventType === "coach_question_failed" ||
    eventType === "coach_empty_response"
  ) {
    return "question";
  }
  if (reason === "blocked_unvalidated_market") {
    return "blocked_unvalidated_market";
  }
  if (
    eventType === "parlay_underfilled" ||
    eventType === "parlay_zero_results" ||
    eventType === "parlay_fulfilled"
  ) {
    return "fulfillment";
  }
  return "none";
}

/** Map mobile CoachScanFailureCode → alertable event + reason. */
export function mapScanFailureCode(code: string): {
  eventType: CoachEventType;
  failureReason: CoachFailureReason;
  alertable: boolean;
} | null {
  switch (code) {
    case "TEAM_ID_MAP_EMPTY":
    case "TEAM_IDS_UNRESOLVED":
      return {
        eventType: "coach_grounding_failure",
        failureReason: "grounding_failure",
        alertable: true,
      };
    case "NO_ODDS_GAMES":
      return {
        eventType: "coach_odds_mismatch",
        failureReason: "odds_mismatch",
        alertable: true,
      };
    case "PROP_POOL_EMPTY":
      return {
        eventType: "coach_alt_market_failure",
        failureReason: "alt_market_failure",
        alertable: true,
      };
    case "GAME_SIMS_TIMED_OUT":
    case "GAME_SIMS_FETCH_EMPTY":
    case "GAME_SIMS_ALL_NULL":
    case "GAME_LINES_NO_SIM_GRADE":
    case "PROP_ALL_NO_SIM_GRADE":
      return {
        eventType: "coach_simulation_failure",
        failureReason:
          code === "GAME_SIMS_FETCH_EMPTY" || code === "GAME_SIMS_ALL_NULL"
            ? "missing_sim_output"
            : "simulation_failure",
        alertable: true,
      };
    case "SCAN_THREW":
    case "ABSOLUTE_BUDGET":
    case "PROP_PHASE_INCOMPLETE":
      return {
        eventType: "coach_scan_freeze",
        failureReason: "scan_freeze",
        alertable: true,
      };
    case "QUALITY_BAR_EMPTY":
    case "SCORED_BUT_NOT_STAGED":
      return {
        eventType: "parlay_underfilled",
        failureReason: "legitimate_underfill",
        alertable: false,
      };
    case "P0_UNVALIDATED_MARKETS":
      return {
        eventType: "parlay_zero_results",
        failureReason: "blocked_unvalidated_market",
        alertable: false,
      };
    default:
      return null;
  }
}

/**
 * Should this Coach event page Telegram?
 * Legitimate underfills / thin slate / unvalidated-market blocks stay digest-only.
 */
export function shouldAlertCoachEvent(meta: CoachReliabilityMeta): boolean {
  // Retain cancellations for diagnostics; they are not exception/timeout pages.
  if (meta.eventType === "coach_cancelled" || (meta.eventType === "coach_exception" && meta.terminalStatus === "cancelled" && meta.rootCause === "user_cancelled")) return false;
  // Known policy gate (e.g. NCAAF game lines while unvalidated) — never a
  // misleading "Coach failure" Telegram page; still counted in the digest.
  if (meta.failureReason === "blocked_unvalidated_market") {
    return false;
  }
  if (LEGITIMATE_UNDERFILL_REASONS.has(meta.failureReason)) {
    // Only page if a dedicated system-failure event type was used.
    return (
      meta.eventType !== "parlay_underfilled" &&
      COACH_ALERT_EVENT_TYPES.has(meta.eventType)
    );
  }
  if (meta.eventType === "parlay_underfilled") {
    // System-flavored underfill reasons still page.
    return (
      meta.failureReason === "odds_mismatch" ||
      meta.failureReason === "grounding_failure" ||
      meta.failureReason === "alt_market_failure" ||
      meta.failureReason === "simulation_failure" ||
      meta.failureReason === "missing_sim_output" ||
      meta.failureReason === "scan_freeze"
    );
  }
  return COACH_ALERT_EVENT_TYPES.has(meta.eventType);
}

export function coachAlertFingerprint(meta: CoachReliabilityMeta): string {
  const parts = [
    "coach",
    meta.eventType,
    meta.failureReason,
    meta.failureCategory,
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
    failureCategory: meta.failureCategory,
    realOddsAvailable: meta.realOddsAvailable,
    qualificationFiltersEliminated: meta.qualificationFiltersEliminated,
    answered: meta.answered,
    requestId: meta.requestId
      ? sanitizeReliabilityText(meta.requestId, 80)
      : null,
    affectedGame: meta.affectedGame
      ? sanitizeReliabilityText(meta.affectedGame, 120)
      : null,
    rootCause: meta.rootCause
      ? sanitizeReliabilityText(meta.rootCause, 240)
      : null,
    durationSamples: Array.isArray(meta.durationSamples)
      ? meta.durationSamples
          .filter((n) => typeof n === "number" && Number.isFinite(n))
          .map((n) => Math.max(0, Math.round(n)))
          .slice(-MAX_SAMPLES)
      : undefined,
    updateId: meta.updateId
      ? sanitizeReliabilityText(meta.updateId, 80)
      : null,
    loadMs: optionalMs(meta.loadMs),
    enrichmentMs: optionalMs(meta.enrichmentMs),
    propSimMs: optionalMs(meta.propSimMs),
    gameSimMs: optionalMs(meta.gameSimMs),
    qualificationMs: optionalMs(meta.qualificationMs),
    scanMs: optionalMs(meta.scanMs),
    finalizationMs: optionalMs(meta.finalizationMs),
    totalMs: optionalMs(meta.totalMs),
    lastCompletedPhase: meta.lastCompletedPhase
      ? sanitizeReliabilityText(meta.lastCompletedPhase, 40)
      : null,
    pendingOperation: meta.pendingOperation
      ? sanitizeReliabilityText(meta.pendingOperation, 40)
      : null,
    timeoutReason: meta.timeoutReason
      ? sanitizeReliabilityText(meta.timeoutReason, 40)
      : null,
    terminalStatus: meta.terminalStatus
      ? sanitizeReliabilityText(meta.terminalStatus, 40)
      : null,
    requestedSport: meta.requestedSport
      ? sanitizeReliabilityText(meta.requestedSport, 24)
      : null,
    effectiveSports: optionalSports(meta.effectiveSports),
    candidatesPoolBefore: optionalInt(meta.candidatesPoolBefore),
    candidatesPoolAfter: optionalInt(meta.candidatesPoolAfter),
    candidatesSelected: optionalInt(meta.candidatesSelected),
    deepSimRequested: optionalInt(meta.deepSimRequested),
    deepSimCompleted: optionalInt(meta.deepSimCompleted),
    qualifiedCount: optionalInt(meta.qualifiedCount),
  };
  // Compact — drop null optional perf keys so meta stays under the 1800 cap.
  const compact: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(safe)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    compact[k] = v;
  }
  return JSON.stringify(compact).slice(0, 1800);
}

export function parseCoachMeta(raw: string | null | undefined): CoachReliabilityMeta | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<CoachReliabilityMeta>;
    if (!j || typeof j !== "object") return null;
    if (!COACH_EVENT_TYPES.includes(j.eventType as CoachEventType)) return null;
    const failureReason = (j.failureReason as CoachFailureReason) || "unknown";
    const eventType = j.eventType as CoachEventType;
    return {
      eventType,
      sportCategory: (j.sportCategory as CoachSportCategory) || "unspecified",
      questionKind: (j.questionKind as CoachQuestionKind) || "general_qa",
      requestedLegCount:
        typeof j.requestedLegCount === "number" ? j.requestedLegCount : null,
      returnedLegCount:
        typeof j.returnedLegCount === "number" ? j.returnedLegCount : null,
      durationMs: typeof j.durationMs === "number" ? j.durationMs : null,
      failureReason,
      failureCategory:
        (j.failureCategory as CoachFailureCategory) ||
        failureCategoryFor(eventType, failureReason),
      realOddsAvailable:
        typeof j.realOddsAvailable === "boolean" ? j.realOddsAvailable : null,
      qualificationFiltersEliminated:
        typeof j.qualificationFiltersEliminated === "boolean"
          ? j.qualificationFiltersEliminated
          : null,
      answered: typeof j.answered === "boolean" ? j.answered : null,
      requestId: typeof j.requestId === "string" ? j.requestId : null,
      affectedGame: typeof j.affectedGame === "string" ? j.affectedGame : null,
      rootCause: typeof j.rootCause === "string" ? j.rootCause : null,
      durationSamples: Array.isArray(j.durationSamples)
        ? j.durationSamples.filter((n): n is number => typeof n === "number")
        : undefined,
      ...parseCoachPerfFields(j as Record<string, unknown>),
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
