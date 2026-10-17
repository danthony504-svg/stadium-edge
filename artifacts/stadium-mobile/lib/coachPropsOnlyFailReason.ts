/**
 * Phone-visible props-only empty reasons.
 *
 * When "9 leg NFL player prop" still empties after #542/#543, Coach must show
 * WHY (pool / candidates / history / grade / odds gate) — not a bare quality bar.
 */

export type PropsOnlyFailCode =
  | "PROPS_ONLY_POOL_EMPTY"
  | "PROPS_ONLY_NO_CANDIDATES"
  | "PROPS_ONLY_NO_HISTORY"
  | "PROPS_ONLY_NO_GRADE"
  | "PROPS_ONLY_ODDS_GATE"
  | "PROPS_ONLY_CONFIDENCE_GATE"
  | "PROPS_ONLY_STAGED_SHORT"
  | "PROPS_ONLY_EMPTY";

/** Staging reject tallies after odds clear (qualify / diversity). */
export type PropsOnlyStageRejects = {
  qualifyFail: Record<string, number>;
  rareFail: number;
  anytimeFail: number;
  ladderDedupe: number;
  perGameCap: number;
  marketSideCap: number;
  rareFamilyCap: number;
};

export type PropsOnlyFailDiag = {
  code: PropsOnlyFailCode;
  target: number;
  pool: number;
  athleteLinked: number;
  candidates: number;
  historyLoaded: number;
  graded: number;
  bestEvSides: number;
  oddsCleared: number;
  staged: number;
  /** Distinct games among odds-cleared legs (thin-slate diagnosis). */
  uniqueGames?: number;
  /** nullReason → count from history/MC misses */
  nullReasons: Record<string, number>;
  /** Top sports in the pool (e.g. nfl:12 wnba:80) */
  sports?: Record<string, number>;
  /** Why odds-cleared legs did not seat (confidence / grade / correlation). */
  stageRejects?: PropsOnlyStageRejects;
};

function topEntries(map: Record<string, number>, limit = 4): string {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}

/** Pick the most actionable code from counters. */
export function derivePropsOnlyFailCode(
  d: Omit<PropsOnlyFailDiag, "code">,
): PropsOnlyFailCode {
  if (d.pool <= 0) return "PROPS_ONLY_POOL_EMPTY";
  if (d.candidates <= 0) return "PROPS_ONLY_NO_CANDIDATES";
  // Sparse history (e.g. 2 of 48) is still a history bottleneck, not a grade bug.
  const histFloor = Math.max(3, Math.ceil(d.candidates * 0.2));
  if (d.graded <= 0 && d.historyLoaded < histFloor) return "PROPS_ONLY_NO_HISTORY";
  if (d.graded <= 0) return "PROPS_ONLY_NO_GRADE";
  if (d.oddsCleared <= 0) return "PROPS_ONLY_ODDS_GATE";
  if (d.staged > 0 && d.staged < d.target) return "PROPS_ONLY_STAGED_SHORT";
  // Odds cleared but nothing seated — distinguish confidence wipe from empty catch-all.
  if (d.oddsCleared > 0 && d.staged <= 0) {
    const conf = d.stageRejects?.qualifyFail?.confidence_floor ?? 0;
    const grade = d.stageRejects?.qualifyFail?.grade_floor ?? 0;
    const edge = d.stageRejects?.qualifyFail?.non_positive_edge ?? 0;
    if (conf > 0 && conf >= grade && conf >= edge) {
      return "PROPS_ONLY_CONFIDENCE_GATE";
    }
  }
  return "PROPS_ONLY_EMPTY";
}

export function formatPropsOnlyFailTrace(d: PropsOnlyFailDiag): string {
  // LOG / MANIFEST ONLY — never concatenate onto Coach chat notes.
  const parts = [
    `pool=${d.pool}`,
    `athleteId=${d.athleteLinked}`,
    `cand=${d.candidates}`,
    `hist=${d.historyLoaded}`,
    `graded=${d.graded}`,
    `bestEv=${d.bestEvSides}`,
    `oddsOk=${d.oddsCleared}`,
    `staged=${d.staged}/${d.target}`,
  ];
  if (d.uniqueGames != null) parts.push(`games=${d.uniqueGames}`);
  const nulls = topEntries(d.nullReasons);
  if (nulls) parts.push(`nulls=${nulls}`);
  const sports = d.sports ? topEntries(d.sports) : "";
  if (sports) parts.push(`sports=${sports}`);
  const qFail = d.stageRejects?.qualifyFail
    ? topEntries(d.stageRejects.qualifyFail)
    : "";
  if (qFail) parts.push(`qualify=${qFail}`);
  return ` [${d.code}: ${parts.join(" ")}]`;
}

export function buildPropsOnlyFailDiag(opts: {
  target: number;
  pool: number;
  athleteLinked: number;
  candidates: number;
  historyLoaded: number;
  graded: number;
  bestEvSides: number;
  oddsCleared: number;
  staged: number;
  uniqueGames?: number;
  nullReasons?: Record<string, number>;
  sports?: Record<string, number>;
  stageRejects?: PropsOnlyStageRejects;
}): PropsOnlyFailDiag {
  const base = {
    target: opts.target,
    pool: opts.pool,
    athleteLinked: opts.athleteLinked,
    candidates: opts.candidates,
    historyLoaded: opts.historyLoaded,
    graded: opts.graded,
    bestEvSides: opts.bestEvSides,
    oddsCleared: opts.oddsCleared,
    staged: opts.staged,
    uniqueGames: opts.uniqueGames,
    nullReasons: opts.nullReasons ?? {},
    sports: opts.sports,
    stageRejects: opts.stageRejects,
  };
  return { ...base, code: derivePropsOnlyFailCode(base) };
}

import { COACH_SIM_MIN_CONFIDENCE } from "./gameSimQualityGates.ts";
import { sanitizeCoachUserNote } from "./sanitizeCoachUserNote.ts";

/** Human lead for the Coach chat bubble — never append machine `[CODE: …]` traces. */
export function propsOnlyFailNote(lead: string, diag: PropsOnlyFailDiag): string {
  void diag;
  return sanitizeCoachUserNote(lead);
}

/** True when odds cleared but every seat died on the confidence floor (not grade/edge). */
export function isPropsOnlyConfidenceTerminal(d: PropsOnlyFailDiag): boolean {
  if (d.oddsCleared <= 0 || d.staged > 0) return false;
  if (d.code === "PROPS_ONLY_CONFIDENCE_GATE") return true;
  const conf = d.stageRejects?.qualifyFail?.confidence_floor ?? 0;
  const grade = d.stageRejects?.qualifyFail?.grade_floor ?? 0;
  const edge = d.stageRejects?.qualifyFail?.non_positive_edge ?? 0;
  return conf > 0 && conf >= grade && conf >= edge;
}

/** True when grade_floor (not confidence) is the dominant post-odds reject. */
export function isPropsOnlyGradeTerminal(d: PropsOnlyFailDiag): boolean {
  if (d.oddsCleared <= 0 || d.staged > 0) return false;
  if (isPropsOnlyConfidenceTerminal(d)) return false;
  const conf = d.stageRejects?.qualifyFail?.confidence_floor ?? 0;
  const grade = d.stageRejects?.qualifyFail?.grade_floor ?? 0;
  const edge = d.stageRejects?.qualifyFail?.non_positive_edge ?? 0;
  return grade > 0 && grade >= conf && grade >= edge;
}

/**
 * Soft-retry / recovery must not wipe a further-along funnel diagnosis.
 * Example bug: skill board CONFIDENCE_GATE (oddsCleared=11) overwritten by
 * preferred-pool ODDS_GATE (oddsCleared=0) → wrong "none cleared recovery odds".
 */
export function preferPropsOnlyFailDiag(
  current: PropsOnlyFailDiag | undefined,
  incoming: PropsOnlyFailDiag | undefined,
): PropsOnlyFailDiag | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const rank = (d: PropsOnlyFailDiag): number => {
    let r = 0;
    r += Math.max(0, d.graded) * 1_000_000;
    r += Math.max(0, d.bestEvSides) * 10_000;
    r += Math.max(0, d.oddsCleared) * 100;
    r += Math.max(0, d.staged) * 10;
    if (d.code === "PROPS_ONLY_CONFIDENCE_GATE" || isPropsOnlyConfidenceTerminal(d)) {
      r += 8;
    } else if (d.code === "PROPS_ONLY_STAGED_SHORT") {
      r += 6;
    } else if (d.code === "PROPS_ONLY_EMPTY" || isPropsOnlyGradeTerminal(d)) {
      r += 4;
    } else if (d.code === "PROPS_ONLY_ODDS_GATE") {
      r += 2;
    }
    return r;
  };
  return rank(incoming) >= rank(current) ? incoming : current;
}

export type PropsOnlyTerminalNoteOpts = {
  /** e.g. "college football" — kept out of this module's ask parsers. */
  sportLabel?: string;
  confidenceFloor?: number;
  /** Recovery soft-empty context for odds-gate copy only. */
  recoveryGraded?: { preferred: number; skill: number };
};

/**
 * Single user-facing empty-ticket lead from failDiag.
 * oddsCleared>0 + confidence-only → confidence floor (never "recovery odds").
 */
export function propsOnlyTerminalEmptyNote(
  diag: PropsOnlyFailDiag,
  opts?: PropsOnlyTerminalNoteOpts,
): string {
  const floor = opts?.confidenceFloor ?? COACH_SIM_MIN_CONFIDENCE;
  const sport = (opts?.sportLabel ?? "football").trim() || "football";

  if (isPropsOnlyConfidenceTerminal(diag)) {
    return propsOnlyFailNote(
      `I found ${diag.oddsCleared} ${sport} player props within the allowed odds range, but none met the ${floor}% confidence floor. I kept the quality bar intact and did not use another sport to fill the ticket.`,
      diag,
    );
  }

  if (diag.oddsCleared <= 0 || diag.code === "PROPS_ONLY_ODDS_GATE") {
    if (opts?.recoveryGraded) {
      return propsOnlyFailNote(
        `Graded ${opts.recoveryGraded.preferred} locked-market props and ${opts.recoveryGraded.skill} skill alts (yards / receptions / sacks) — none cleared recovery odds. No ungraded filler was added.`,
        diag,
      );
    }
    const lead =
      diag.graded > 0
        ? `Graded ${diag.graded} props but none cleared the ticket odds bar. No ungraded filler was added.`
        : `You asked for ${diag.target} legs — no player props cleared the ticket odds bar. No ungraded filler was added.`;
    return propsOnlyFailNote(lead, diag);
  }

  if (isPropsOnlyGradeTerminal(diag)) {
    return propsOnlyFailNote(
      `Graded ${diag.graded} props and ${diag.oddsCleared} cleared odds, but none met the grade floor for a ticket seat. No ungraded filler was added.`,
      diag,
    );
  }

  const lead =
    diag.graded > 0
      ? `Graded ${diag.graded} props but none cleared the ticket quality bar. No ungraded filler was added.`
      : `You asked for ${diag.target} legs — no AI-backed player props cleared the quality bar. No ungraded filler was added.`;
  return propsOnlyFailNote(lead, diag);
}

function looksLikePropsOnlyEmptyLead(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("none met the") ||
    t.includes("none cleared") ||
    t.includes("confidence floor") ||
    t.includes("recovery odds") ||
    t.includes("quality bar") ||
    t.includes("within the allowed odds range") ||
    t.includes("hit the delivery budget")
  );
}

/**
 * Partial + final (or budget + late) must show one coherent terminal diagnosis —
 * never append a second empty-ticket lead onto the first.
 */
export function reconcileCoachTerminalNote(opts: {
  priorText?: string | null;
  nextText: string;
  priorFailDiag?: PropsOnlyFailDiag;
  nextFailDiag?: PropsOnlyFailDiag;
  sportLabel?: string;
  confidenceFloor?: number;
  recoveryGraded?: { preferred: number; skill: number };
}): string {
  const preferred = preferPropsOnlyFailDiag(opts.priorFailDiag, opts.nextFailDiag);
  const prior = String(opts.priorText ?? "").trim();
  const next = String(opts.nextText ?? "").trim();

  if (preferred && preferred.staged <= 0) {
    return propsOnlyTerminalEmptyNote(preferred, {
      sportLabel: opts.sportLabel,
      confidenceFloor: opts.confidenceFloor,
      recoveryGraded: opts.recoveryGraded,
    });
  }

  if (!prior) return next;
  if (!next) return prior;
  if (prior === next) return next;

  // Two empty leads → keep one (final/next), never concatenate.
  if (looksLikePropsOnlyEmptyLead(prior) && looksLikePropsOnlyEmptyLead(next)) {
    return next;
  }
  return next;
}
