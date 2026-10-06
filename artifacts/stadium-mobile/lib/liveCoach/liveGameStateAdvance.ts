/**
 * Detect when live game state advances past a price snapshot (race protection).
 * Marks quotes unsafe — Phase 1 does not recommend.
 */

import type { LiveGameStateRecord, LivePriceRecord } from "./types.ts";

export type GameStateAdvanceResult = {
  advanced: boolean;
  reasons: string[];
};

/**
 * Compare quote-captured game state to the current scoreboard for the same event.
 * Score change, period change, or material clock advance → advanced.
 */
export function detectLiveGameStateAdvance(
  current: Pick<
    LiveGameStateRecord,
    "awayScore" | "homeScore" | "period" | "periodLabel" | "clock" | "state"
  >,
  quoteState:
    | Partial<
        Pick<
          LiveGameStateRecord,
          "awayScore" | "homeScore" | "period" | "periodLabel" | "clock" | "state"
        >
      >
    | null
    | undefined,
): GameStateAdvanceResult {
  if (!quoteState) {
    return { advanced: false, reasons: [] };
  }

  const reasons: string[] = [];

  if (
    quoteState.awayScore != null &&
    current.awayScore != null &&
    quoteState.awayScore !== current.awayScore
  ) {
    reasons.push("away_score_changed");
  }
  if (
    quoteState.homeScore != null &&
    current.homeScore != null &&
    quoteState.homeScore !== current.homeScore
  ) {
    reasons.push("home_score_changed");
  }
  if (
    quoteState.period != null &&
    current.period != null &&
    quoteState.period !== current.period
  ) {
    reasons.push("period_changed");
  }
  if (
    quoteState.periodLabel != null &&
    current.periodLabel != null &&
    normalizeLabel(quoteState.periodLabel) !== normalizeLabel(current.periodLabel) &&
    (quoteState.period == null || current.period == null)
  ) {
    reasons.push("period_label_changed");
  }

  if (materialClockAdvance(quoteState.clock, current.clock)) {
    reasons.push("clock_advanced");
  }

  if (
    quoteState.state != null &&
    current.state != null &&
    String(quoteState.state).toLowerCase() !== String(current.state).toLowerCase()
  ) {
    reasons.push("state_changed");
  }

  return { advanced: reasons.length > 0, reasons };
}

function normalizeLabel(s: string): string {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Material clock change between quote and current board.
 * - "M:SS" countdown: remaining time drops by ≥5s
 * - Soccer-style "45'" / "45+2": elapsed rises by ≥5s
 * - Unparsed but different labels (e.g. HT → 2nd) count as advance
 */
export function materialClockAdvance(
  quoteClock: string | null | undefined,
  currentClock: string | null | undefined,
): boolean {
  if (quoteClock == null || currentClock == null) return false;
  const q = String(quoteClock).trim();
  const c = String(currentClock).trim();
  if (!q || !c || q === c) return false;

  const qKind = classifyClock(q);
  const cKind = classifyClock(c);
  if (qKind && cKind && qKind.kind === cKind.kind) {
    if (qKind.kind === "countdown") return qKind.seconds > cKind.seconds + 4;
    if (qKind.kind === "elapsed") return cKind.seconds > qKind.seconds + 4;
  }

  return normalizeLabel(q) !== normalizeLabel(c);
}

type ClockKind =
  | { kind: "countdown"; seconds: number }
  | { kind: "elapsed"; seconds: number };

function classifyClock(raw: string): ClockKind | null {
  const s = String(raw).trim();
  const mmss = s.match(/^(\d{1,3}):(\d{2})$/);
  if (mmss) {
    return {
      kind: "countdown",
      seconds: parseInt(mmss[1]!, 10) * 60 + parseInt(mmss[2]!, 10),
    };
  }
  const soccer = s.match(/^(\d{1,3})(?:\+(\d{1,2}))?['′]?$/);
  if (soccer) {
    const base = parseInt(soccer[1]!, 10);
    const stoppage = soccer[2] ? parseInt(soccer[2], 10) : 0;
    return { kind: "elapsed", seconds: (base + stoppage) * 60 };
  }
  return null;
}

/** Parse clock helpers for tests. */
export function parseClockToSeconds(raw: string): number | null {
  const k = classifyClock(raw);
  return k ? k.seconds : null;
}

export function quoteStateFromPrice(
  price: LivePriceRecord,
): LivePriceRecord["quoteGameState"] {
  return price.quoteGameState ?? null;
}
