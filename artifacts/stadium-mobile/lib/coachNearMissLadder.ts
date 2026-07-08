// When a Coach leg barely misses the quality bar, walk the real alternate ladder
// (props: other posted lines; game lines: spread/ML/total rungs) and swap in the
// first rung that clears the same simulator + Final AI gates.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { GameMeta, PropPoolEntry, RealOddsEntry } from "./api.ts";
import { classifySimAlignment } from "./finalAiScore.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
  passesCoachSimQualityGate,
} from "./gameSimQualityGates.ts";
import { evalLinesForGame, gameLabelsMatch } from "./gameLineOptimizer.ts";
import {
  gameSimHitForPick,
  GAME_SIM_MIN_HIT,
  isGameLinePick,
  type CoachGameSimEntry,
} from "./gameSimScoring.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import { propSimKey } from "./propSelection.ts";
import { pickLegFingerprint, type ParlayLegReject } from "./parlayReachCore.ts";

/** How close a leg must be to the bar before we search alternates. */
export const NEAR_MISS_MARGIN_PCT = 3;

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function numLine(pick: string): number | null {
  const m = String(pick).match(/([+-]?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function pickTeamName(pick: string): string | null {
  const p = String(pick ?? "");
  if (/\b(over|under)\b/i.test(p)) return null;
  return (
    p
      .replace(/\s*(ml|moneyline)\s*$/i, "")
      .replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, "")
      .trim() || null
  );
}

function teamsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const nick = (s: string) => {
    const parts = norm(s).split(" ").filter(Boolean);
    return parts[parts.length - 1] ?? "";
  };
  const na = nick(a);
  const nb = nick(b);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  return y
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function metricsFromPick(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit: number | null | undefined,
) {
  const conf = pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null;
  const edge = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const grade = pick.finalAiScore?.grade ?? null;
  const hit =
    pick.isProp && propHit != null
      ? propHit
      : (pick.finalAiScore?.simHit ?? gameSimHitForPick(pick, sim ?? null));
  return { conf, edge, grade, hit };
}

export function passesCoachPropQualityGate(
  pick: ParsedPick,
  propHit: number | null | undefined,
): boolean {
  if (!pick.isProp) return true;
  const m = metricsFromPick(pick, null, propHit);
  if (m.edge == null || m.edge <= 0) return false;
  if (gradeRank(m.grade) < gradeRank(COACH_SIM_MIN_GRADE)) return false;
  if (m.conf == null || m.conf < COACH_SIM_MIN_CONFIDENCE) return false;
  const { simAligned, highRiskValuePlay } = classifySimAlignment(m.hit, m.edge);
  return simAligned || highRiskValuePlay;
}

/** Leg failed the bar but is within NEAR_MISS_MARGIN_PCT on confidence, edge, or sim hit. */
export function isNearMissQualityFailure(
  pick: ParsedPick,
  sim: CoachGameSimEntry | null | undefined,
  propHit?: number | null,
): boolean {
  if (pick.isProp) {
    if (passesCoachPropQualityGate(pick, propHit)) return false;
  } else if (passesCoachSimQualityGate(pick, sim, { finalAi: pick.finalAiScore, odds: pick.odds })) {
    return false;
  }

  const m = metricsFromPick(pick, sim, propHit);
  const confNear =
    m.conf != null &&
    m.conf >= COACH_SIM_MIN_CONFIDENCE - NEAR_MISS_MARGIN_PCT &&
    m.conf < COACH_SIM_MIN_CONFIDENCE;
  const hitNear =
    m.hit != null &&
    m.hit >= GAME_SIM_MIN_HIT - NEAR_MISS_MARGIN_PCT / 100 &&
    m.hit < GAME_SIM_MIN_HIT;
  const edgeNear = m.edge != null && m.edge > -NEAR_MISS_MARGIN_PCT && m.edge <= 0;
  const gradeNear =
    gradeRank(m.grade) === gradeRank("C") && gradeRank(COACH_SIM_MIN_GRADE) === gradeRank("C+");
  return confNear || hitNear || edgeNear || gradeNear;
}

function propHitForPick(
  pick: ParsedPick,
  propSims?: Map<string, { hitProbability: number | null }>,
): number | null | undefined {
  if (!pick.isProp || !pick.player || pick.propLine == null || !pick.propSide) return null;
  const key = propSimKey(
    pick.player,
    pick.propMarketKey ?? pick.market,
    pick.propLine,
    pick.propSide,
  );
  return propSims?.get(key)?.hitProbability;
}

function parsedPickFromPoolEntry(e: PropPoolEntry): ParsedPick {
  const pick =
    e.line != null
      ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
      : `${e.player} ${e.marketLabel}`;
  return {
    game: e.game,
    market: e.marketLabel,
    pick,
    odds: e.odds,
    sport: e.sport,
    isProp: true,
    startsAt: e.startsAt,
    headshot: e.headshot,
    teamAbbr: e.teamAbbr,
    player: e.player,
    athleteId: e.athleteId,
    propMarketKey: e.marketKey,
    propLine: e.line,
    propSide: e.side,
  };
}

function ladderPropCandidates(pick: ParsedPick, propPool: PropPoolEntry[]): PropPoolEntry[] {
  if (!pick.isProp || !pick.player) return [];
  const marketKey = pick.propMarketKey ?? pick.market;
  const side = pick.propSide;
  const rows = propPool.filter(
    (e) =>
      e.player === pick.player &&
      (e.marketKey === marketKey || norm(e.marketLabel) === norm(pick.market)) &&
      (!side || e.side === side) &&
      gameLabelsMatch(e.game, pick.game) &&
      e.line != null &&
      e.line !== pick.propLine,
  );
  const over = side === "Over" || /\bover\b/i.test(pick.pick);
  const under = side === "Under" || /\bunder\b/i.test(pick.pick);
  return rows.sort((a, b) => {
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (over) return la - lb;
    if (under) return lb - la;
    return Math.abs(la - (pick.propLine ?? la)) - Math.abs(lb - (pick.propLine ?? lb));
  });
}

function isGameTotalEntry(e: RealOddsEntry): boolean {
  return /\b(over|under)\b/i.test(e.pick) && !/team total/i.test(e.market);
}

function isTeamSidedEntry(e: RealOddsEntry): boolean {
  const m = e.market.toLowerCase();
  if (/total|over|under|o\/u/.test(m)) return false;
  return /moneyline|spread|run line|puck line|alt spread/i.test(m);
}

function marketRank(market: string): number {
  const m = market.toLowerCase();
  if (/moneyline|\bml\b/.test(m)) return 2;
  if (/spread|run line|puck line/.test(m)) return 0;
  if (/alt spread/.test(m)) return 1;
  if (/total|alt total|team total/.test(m)) return 3;
  return 4;
}

function ladderGameLineCandidates(
  pick: ParsedPick,
  lines: RealOddsEntry[],
): RealOddsEntry[] {
  const pool = lines.filter(
    (e) =>
      gameLabelsMatch(e.game, pick.game) && (isTeamSidedEntry(e) || isGameTotalEntry(e)),
  );
  const pickTeam = pickTeamName(pick.pick);
  const isTotal = /\b(over|under)\b/i.test(pick.pick) && !/team total/i.test(pick.market);
  const over = /\bover\b/i.test(pick.pick);
  const under = /\bunder\b/i.test(pick.pick);

  let candidates: RealOddsEntry[];
  if (isTotal) {
    candidates = pool.filter((e) => {
      if (!isGameTotalEntry(e)) return false;
      if (over) return /\bover\b/i.test(e.pick);
      if (under) return /\bunder\b/i.test(e.pick);
      return true;
    });
    candidates.sort((a, b) => {
      const la = numLine(a.pick) ?? 0;
      const lb = numLine(b.pick) ?? 0;
      if (over) return la - lb;
      if (under) return lb - la;
      return 0;
    });
  } else if (pickTeam) {
    candidates = pool.filter((e) => {
      const t = pickTeamName(e.pick);
      return t != null && teamsMatch(t, pickTeam);
    });
    candidates.sort((a, b) => {
      const ra = marketRank(a.market);
      const rb = marketRank(b.market);
      if (ra !== rb) return ra - rb;
      const la = numLine(a.pick);
      const lb = numLine(b.pick);
      if (la == null || lb == null) return 0;
      const neg = la < 0 || lb < 0;
      if (neg) return lb - la;
      return la - lb;
    });
  } else {
    candidates = pool;
  }

  const seen = new Set<string>();
  const out: RealOddsEntry[] = [];
  const origKey = `${pick.market}|${pick.pick}`.toLowerCase();
  for (const e of candidates) {
    const k = `${e.market}|${e.pick}`.toLowerCase();
    if (k === origKey || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export type NearMissLadderOpts = {
  evalLinesByGame?: Map<string, RealOddsEntry[]>;
  realOdds?: RealOddsEntry[];
  propPool?: PropPoolEntry[];
  propSimulations?: Map<string, { hitProbability: number | null }>;
  gameSimulations?: Map<string, CoachGameSimEntry>;
  matchupHistory?: Record<string, import("./api.ts").MatchupHistoryEntry>;
  matchupInjuries?: Record<string, import("./injuries.ts").GameInjuryReport>;
  gameMeta?: GameMeta[];
};

export type NearMissSwapResult = {
  pick: ParsedPick | null;
  note: string;
};

function scoreOpts(opts: NearMissLadderOpts) {
  return {
    realOdds: opts.realOdds ?? [],
    propPool: opts.propPool ?? [],
    propSimulations: opts.propSimulations,
    gameSimulations: opts.gameSimulations,
    matchupHistory: opts.matchupHistory,
    matchupInjuries: opts.matchupInjuries,
  };
}

/** Search posted alternates and return the first qualifying replacement, if any. */
export function swapNearMissPick(
  failed: ParsedPick,
  opts: NearMissLadderOpts,
): NearMissSwapResult {
  if (failed.isProp) {
    const pool = opts.propPool ?? [];
    if (!pool.length) return { pick: null, note: "" };
    const candidates = ladderPropCandidates(failed, pool);
    for (const row of candidates) {
      let candidate = parsedPickFromPoolEntry(row);
      const hit = propHitForPick(candidate, opts.propSimulations);
      candidate = attachPickScores([candidate], scoreOpts(opts))[0] ?? candidate;
      if (passesCoachPropQualityGate(candidate, hit ?? null)) {
        return {
          pick: candidate,
          note: `_Swapped **${failed.pick}** for **${candidate.pick}** — the original line was within ${NEAR_MISS_MARGIN_PCT}% of the quality bar; this posted alternate cleared the 10k sim and Final AI gates._`,
        };
      }
    }
    return { pick: null, note: "" };
  }

  if (!isGameLinePick(failed) || failed.isProp) return { pick: null, note: "" };
  const evalMap = opts.evalLinesByGame;
  if (!evalMap) return { pick: null, note: "" };
  const lines = evalLinesForGame(failed.game, evalMap);
  if (!lines.length) return { pick: null, note: "" };
  const sim =
    opts.gameSimulations?.get(failed.game) ??
    [...(opts.gameSimulations ?? [])].find(([k]) => gameLabelsMatch(k, failed.game))?.[1];
  if (!sim) return { pick: null, note: "" };

  const candidates = ladderGameLineCandidates(failed, lines);
  for (const entry of candidates) {
    const stub: ParsedPick = {
      game: entry.game,
      market: entry.market,
      pick: entry.pick,
      odds: entry.odds,
      sport: entry.sport ?? failed.sport,
      isProp: false,
      startsAt: entry.startsAt ?? failed.startsAt ?? null,
    };
    const scored = attachPickScores([stub], scoreOpts(opts))[0]!;
    if (
      passesCoachSimQualityGate(scored, sim, {
        finalAi: scored.finalAiScore,
        odds: scored.odds,
      })
    ) {
      return {
        pick: scored,
        note: `_Swapped **${failed.pick}** for **${scored.pick}** — the original line was within ${NEAR_MISS_MARGIN_PCT}% of the quality bar; this posted alternate cleared the 10k sim and Final AI gates._`,
      };
    }
  }
  return { pick: null, note: "" };
}

function lookupSim(
  game: string,
  sims?: Map<string, CoachGameSimEntry>,
): CoachGameSimEntry | undefined {
  if (!sims) return undefined;
  const direct = sims.get(game);
  if (direct) return direct;
  for (const [label, sim] of sims) {
    if (gameLabelsMatch(label, game)) return sim;
  }
  return undefined;
}

/**
 * After picks are scored, try near-miss ladder swaps and drop legs that still
 * fail the quality bar with no qualifying alternate.
 */
export function applyNearMissLadderToPicks(
  picks: ParsedPick[],
  opts: NearMissLadderOpts,
): { picks: ParsedPick[]; note: string } {
  const notes: string[] = [];
  const out: ParsedPick[] = [];

  for (const p of picks) {
    const sim = lookupSim(p.game, opts.gameSimulations);
    const hit = propHitForPick(p, opts.propSimulations);
    const failsProp = !!p.isProp && !passesCoachPropQualityGate(p, hit ?? null);
    const failsGame =
      !p.isProp &&
      isGameLinePick(p) &&
      !passesCoachSimQualityGate(p, sim, {
        finalAi: p.finalAiScore,
        odds: p.odds,
      });
    const fails = failsProp || failsGame;

    if (fails && isNearMissQualityFailure(p, sim, hit ?? null)) {
      const swapped = swapNearMissPick(p, opts);
      if (swapped.pick) {
        notes.push(swapped.note);
        out.push(swapped.pick);
      }
      continue;
    }
    out.push(p);
  }

  return { picks: out, note: notes.filter(Boolean).join("\n\n") };
}

const PROMOTABLE_POOL_SCAN_CAP = 150;

function promotableFromPool(
  ticket: ParsedPick[],
  limit: number,
  opts: NearMissLadderOpts,
): ParsedPick[] {
  const pool = opts.propPool ?? [];
  if (!pool.length || limit <= 0) return [];
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const seenPlayers = new Set(
    ticket.filter((p) => p.isProp && p.player).map((p) => norm(p.player!)),
  );
  const out: ParsedPick[] = [];
  const stubs: ParsedPick[] = [];
  for (const e of pool) {
    if (stubs.length >= PROMOTABLE_POOL_SCAN_CAP) break;
    if (seenPlayers.has(norm(e.player))) continue;
    const stub = parsedPickFromPoolEntry(e);
    const fp = pickLegFingerprint(stub);
    if (onTicket.has(fp)) continue;
    stubs.push(stub);
  }
  const scored = attachPickScores(stubs, scoreOpts(opts));
  const ranked = scored
    .map((pick) => ({
      pick,
      hit: propHitForPick(pick, opts.propSimulations),
      edge: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? 0,
    }))
    .filter(({ pick, hit }) => passesCoachPropQualityGate(pick, hit ?? null))
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  for (const row of ranked) {
    const fp = pickLegFingerprint(row.pick);
    if (onTicket.has(fp)) continue;
    onTicket.add(fp);
    seenPlayers.add(norm(row.pick.player ?? ""));
    out.push(row.pick);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Promote near-miss rejects and qualifying prop-board alternates onto the main
 * ticket (not backup cards) until the requested leg count or candidates run out.
 */
export function fillTicketFromNearMissLadder(
  picks: ParsedPick[],
  rejects: ParlayLegReject[],
  target: number,
  opts: NearMissLadderOpts,
): {
  picks: ParsedPick[];
  note: string;
  filled: number;
  remainingRejects: ParlayLegReject[];
} {
  if (picks.length >= target) {
    return { picks, note: "", filled: 0, remainingRejects: rejects };
  }

  const onTicket = new Set(picks.map(pickLegFingerprint));
  const notes: string[] = [];
  const out = [...picks];
  const remaining: ParlayLegReject[] = [];
  const sorted = [...rejects].sort((a, b) => b.nearScore - a.nearScore);

  for (const reject of sorted) {
    if (out.length >= target) {
      remaining.push(reject);
      continue;
    }
    const rejectFp = pickLegFingerprint(reject.pick);
    if (onTicket.has(rejectFp)) {
      remaining.push(reject);
      continue;
    }

    const sim = lookupSim(reject.pick.game, opts.gameSimulations);
    const hit = propHitForPick(reject.pick, opts.propSimulations);
    const scored = attachPickScores([reject.pick], scoreOpts(opts))[0] ?? reject.pick;
    let promoted: ParsedPick | null = null;

    if (reject.pick.isProp) {
      if (passesCoachPropQualityGate(scored, hit ?? null)) promoted = scored;
    } else if (isGameLinePick(reject.pick)) {
      if (
        passesCoachSimQualityGate(scored, sim, {
          finalAi: scored.finalAiScore,
          odds: scored.odds,
        })
      ) {
        promoted = scored;
      }
    }

    if (!promoted && isNearMissQualityFailure(scored, sim, hit ?? null)) {
      const swapped = swapNearMissPick(scored, opts);
      if (swapped.pick) {
        promoted = swapped.pick;
        if (swapped.note) notes.push(swapped.note);
      }
    }

    if (promoted) {
      const pfp = pickLegFingerprint(promoted);
      if (!onTicket.has(pfp)) {
        out.push(promoted);
        onTicket.add(pfp);
        continue;
      }
    }
    remaining.push(reject);
  }

  if (out.length < target) {
    const fromPool = promotableFromPool(out, target - out.length, opts);
    for (const p of fromPool) {
      out.push(p);
      notes.push(
        `_Added **${p.pick}** from the live prop board — a posted line cleared the 10k sim and Final AI gates._`,
      );
    }
  }

  return {
    picks: out,
    note: notes.filter(Boolean).join("\n\n"),
    filled: out.length - picks.length,
    remainingRejects: remaining,
  };
}
