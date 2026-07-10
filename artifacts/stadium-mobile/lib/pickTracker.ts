// AI Coach pick ledger — captures every grounded recommendation before kickoff,
// grades it against real results after the game, and feeds honest performance
// history back into the scoring layer.

import { americanToDecimal } from "./format.ts";
import { familyKeyForPick } from "./marketWeighting.ts";
import { parsePropLeg } from "./propLegParse.ts";

export type GradeOutcome = "win" | "loss" | "push" | "ungraded";

function simEvPct(simHit: number, americanOdds: number): number | null {
  if (!Number.isFinite(simHit) || !Number.isFinite(americanOdds)) return null;
  const ev = simHit * americanToDecimal(americanOdds) - 1;
  if (!Number.isFinite(ev)) return null;
  return Math.round(ev * 1000) / 10;
}

/** Minimal coach pick shape for capture (structurally compatible with ParsedPick). */
export type CapturablePick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  isProp?: boolean;
  startsAt?: string | null;
  player?: string;
  propMarketKey?: string;
  propLine?: number | null;
  propSide?: string;
  scores?: {
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
  } | null;
  finalAiScore?: {
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    simHit?: number | null;
  } | null;
};

export type TrackedPickStatus = "pending" | GradeOutcome;

export type TrackedPick = {
  id: string;
  capturedAt: number;
  /** Calendar date for the pick (game day when known, else capture day). */
  date: string;
  sport: string;
  game: string;
  player: string | null;
  market: string;
  line: number | null;
  pick: string;
  odds: number;
  aiGrade: string | null;
  confidence: number | null;
  edge: number | null;
  ev: number | null;
  simHitPct: number | null;
  isProp: boolean;
  propMarketKey?: string;
  startsAt?: string;
  status: TrackedPickStatus;
  /** Grader detail text when settled. */
  finalResult?: string;
  family?: string;
  side?: string;
  settledAt?: number;
  source: "coach";
};

export const MAX_TRACKED_PICKS = 500;

/** Graded prop outcomes for the cross-sport prop engine learning layer. */
export function buildPropLearningHistory(
  picks: TrackedPick[],
): Array<{ sport: string; market: string; outcome: "win" | "loss" | "push" }> {
  return picks
    .filter((p) => p.isProp && p.status !== "pending" && p.status !== "ungraded")
    .map((p) => ({
      sport: p.sport,
      market: (p.propMarketKey ?? p.market).toLowerCase(),
      outcome: p.status as "win" | "loss" | "push",
    }));
}

const pickKey = (p: {
  sport?: string;
  game: string;
  market: string;
  pick: string;
  startsAt?: string | null;
}) =>
  `${p.sport ?? ""}|${p.game}|${p.market}|${p.pick}|${p.startsAt ?? ""}`.toLowerCase();

/** Odds bucket for performance breakdowns (matches web tracker). */
export type OddsBucket = "heavyFav" | "fav" | "plus" | "longshot";

export function oddsBucket(odds: number): OddsBucket {
  if (odds < -200) return "heavyFav";
  if (odds < 0) return "fav";
  if (odds <= 150) return "plus";
  return "longshot";
}

export type OddsRole = "favorite" | "underdog" | "longshot";

export function oddsRole(odds: number): OddsRole {
  if (odds > 200) return "longshot";
  if (odds > 0) return "underdog";
  return "favorite";
}

export function gradeBucket(grade: string | null | undefined): string | null {
  if (!grade) return null;
  const g = grade.trim().toUpperCase();
  if (g.startsWith("A")) return "A";
  if (g.startsWith("B")) return "B";
  if (g.startsWith("C")) return "C";
  if (g.startsWith("D")) return "D";
  return "F";
}

export function confidenceBucket(conf: number | null | undefined): string | null {
  if (conf == null || !Number.isFinite(conf)) return null;
  if (conf < 45) return "low";
  if (conf < 60) return "mid";
  return "high";
}

export function edgeBucket(edge: number | null | undefined): string | null {
  if (edge == null || !Number.isFinite(edge)) return null;
  if (edge < 0) return "negative";
  if (edge <= 2) return "neutral";
  return "positive";
}

function lineFromPick(p: CapturablePick): number | null {
  if (p.propLine != null && Number.isFinite(p.propLine)) return p.propLine;
  const m = p.pick.match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function playerFromPick(p: CapturablePick): string | null {
  if (p.player?.trim()) return p.player.trim();
  if (!p.isProp) return null;
  const parsed = parsePropLeg(p);
  return parsed?.player ?? null;
}

function evForPick(p: CapturablePick): number | null {
  const simHit = p.finalAiScore?.simHit ?? null;
  if (simHit != null && Number.isFinite(p.odds)) return simEvPct(simHit, p.odds);
  return null;
}

function scoresFromPick(p: CapturablePick) {
  const final = p.finalAiScore;
  const rubric = p.scores;
  return {
    aiGrade: final?.grade ?? rubric?.grade ?? null,
    confidence: final?.confidencePct ?? rubric?.confidencePct ?? null,
    edge: final?.edgePct ?? rubric?.edgePct ?? null,
    simHitPct:
      final?.simHit != null ? Math.round(final.simHit * 1000) / 10 : null,
  };
}

/** Build a tracked pick from a grounded Coach card. Returns null when the game already started. */
export function trackedPickFromParsedPick(
  p: CapturablePick,
  now = Date.now(),
): TrackedPick | null {
  if (!p.game?.trim() || !p.market?.trim() || !p.pick?.trim()) return null;
  if (!Number.isFinite(p.odds) || p.odds === 0) return null;

  const startsAt = p.startsAt ?? undefined;
  if (startsAt) {
    const t = Date.parse(startsAt);
    if (Number.isFinite(t) && t < now - 5 * 60_000) return null;
  }

  const scores = scoresFromPick(p);
  const gameDay = startsAt ? startsAt.slice(0, 10) : new Date(now).toISOString().slice(0, 10);

  return {
    id: pickKey({ sport: p.sport, game: p.game, market: p.market, pick: p.pick, startsAt }),
    capturedAt: now,
    date: gameDay,
    sport: (p.sport ?? "unknown").toLowerCase(),
    game: p.game,
    player: playerFromPick(p),
    market: p.market,
    line: lineFromPick(p),
    pick: p.pick,
    odds: p.odds,
    aiGrade: scores.aiGrade,
    confidence: scores.confidence,
    edge: scores.edge,
    ev: evForPick(p),
    simHitPct: scores.simHitPct,
    isProp: !!p.isProp,
    propMarketKey: p.propMarketKey,
    startsAt,
    status: "pending",
    source: "coach",
  };
}

/** Merge score updates onto an existing pending pick (e.g. after Monte Carlo refines). */
export function mergeTrackedScores(
  existing: TrackedPick,
  p: CapturablePick,
): TrackedPick {
  if (existing.status !== "pending") return existing;
  const scores = scoresFromPick(p);
  return {
    ...existing,
    aiGrade: scores.aiGrade ?? existing.aiGrade,
    confidence: scores.confidence ?? existing.confidence,
    edge: scores.edge ?? existing.edge,
    ev: evForPick(p) ?? existing.ev,
    simHitPct: scores.simHitPct ?? existing.simHitPct,
  };
}

export function mergeTrackedPicks(a: TrackedPick[], b: TrackedPick[]): TrackedPick[] {
  const byId = new Map<string, TrackedPick>();
  for (const e of [...a, ...b]) {
    if (!e?.id) continue;
    const cur = byId.get(e.id);
    if (!cur) {
      byId.set(e.id, e);
      continue;
    }
    const eRec = e.settledAt ?? e.capturedAt;
    const cRec = cur.settledAt ?? cur.capturedAt;
    byId.set(e.id, eRec >= cRec ? e : cur);
  }
  return Array.from(byId.values())
    .sort((x, y) => (y.settledAt ?? y.capturedAt) - (x.settledAt ?? x.capturedAt))
    .slice(0, MAX_TRACKED_PICKS);
}

export function captureCoachPicks(
  existing: TrackedPick[],
  picks: CapturablePick[],
  now = Date.now(),
): TrackedPick[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const p of picks) {
    const next = trackedPickFromParsedPick(p, now);
    if (!next) continue;
    const cur = byId.get(next.id);
    if (!cur) {
      byId.set(next.id, next);
    } else if (cur.status === "pending") {
      byId.set(next.id, mergeTrackedScores(cur, p));
    }
  }
  return Array.from(byId.values())
    .sort((x, y) => (y.settledAt ?? y.capturedAt) - (x.settledAt ?? x.capturedAt))
    .slice(0, MAX_TRACKED_PICKS);
}

export function familyForTracked(p: TrackedPick): string | null {
  if (p.family) return p.family.toLowerCase();
  return familyKeyForPick({
    isProp: p.isProp,
    sport: p.sport,
    market: p.market,
    propMarketKey: p.propMarketKey,
  });
}

export function isDecidedStatus(s: TrackedPickStatus): boolean {
  return s === "win" || s === "loss";
}
