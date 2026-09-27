/**
 * Greenfield NFL / NCAAF props-only ticket builder.
 *
 * Rebuild after #539 phone empty: selection worked, but per-batch enrich/server
 * race still left propLegsScored=0. New contract:
 * 1. AthleteId-required finishable skill set
 * 2. Prefetch game logs for ALL candidates first
 * 3. Grade synchronously from history (no enrich race)
 * 4. Soft-clip binary TD 0/1
 * 5. Optional short server MC boost only for still-null rows — never wipe locals
 * 6. Stage graded props — never invent odds
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchPropSimulations } from "./api.ts";
import { prefetchPropPlayerHistory } from "./coachBoardContext.ts";
import type { GameTeamIds } from "./coachGameMonteCarlo.ts";
import {
  FOOTBALL_PROPS_ONLY_BATCH,
  selectFootballPropsOnlyFromPicks,
} from "./coachFootballPropsOnly.ts";
import {
  gradeFootballPropsOnlyFromHistory,
  propsOnlyPickHasGrade,
  softClipPropsOnlyHits,
  type PropsOnlyHistorySlice,
} from "./coachFootballPropsOnlyGrade.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import {
  clipPropSimHitForGrade,
  pickHasSimGrade,
  sanitizeSimHitForGrade,
  parseMarketPeriod,
} from "./simMarketSupport.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import { impliedProb } from "./format.ts";
import {
  buildStagedTicketFromScan,
  type BoardScoredLeg,
} from "./ticketStaging.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { collapseScoredLegsByMarketLadder } from "./marketLadderExhaustion.ts";

export {
  FOOTBALL_PROPS_ONLY_BATCH,
  footballPropsOnlyFamilyCounts,
  footballPropsOnlyMaxCandidates,
  selectFootballPropsOnlyFromPicks,
  shouldBuildFootballPropsOnlyTicket,
} from "./coachFootballPropsOnly.ts";

export {
  gradeFootballPropFromHistory,
  gradeFootballPropsOnlyFromHistory,
  propsOnlyPickHasGrade,
  softClipPropsOnlyHits,
} from "./coachFootballPropsOnlyGrade.ts";

export function selectFootballPropsOnlyCandidates(
  pool: PropPoolEntry[],
  targetLegs: number,
): ParsedPick[] {
  return selectFootballPropsOnlyFromPicks(pool.map(parsedPickFromPoolEntry), targetLegs);
}

function legFromScoredPick(pick: ParsedPick): BoardScoredLeg | null {
  const raw = pick.finalAiScore?.simHit ?? null;
  const clipped = clipPropSimHitForGrade(pick, raw);
  const hit = sanitizeSimHitForGrade(clipped, {
    market: pick.market,
    sport: pick.sport,
    isProp: true,
    period: parseMarketPeriod(pick.market ?? ""),
    line: pick.propLine ?? null,
    odds: pick.odds ?? null,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
  });
  if (!pickHasSimGrade(pick, hit)) return null;
  const ev = hit != null && pick.odds != null ? simEvPct(hit, pick.odds) : null;
  const implied =
    pick.odds != null ? Math.round(impliedProb(pick.odds) * 1000) / 10 : null;
  const composite = pick.finalAiScore?.composite ?? pick.scores?.composite ?? null;
  return {
    pick: { ...pick, finalAiScore: pick.finalAiScore },
    evPct: ev,
    edgePct: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null,
    confidencePct: pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null,
    impliedProbPct: implied,
    lineShoppingScore:
      pick.finalAiScore?.rubric?.scores?.lineShopping ?? pick.scores?.lineShopping ?? null,
    grade: pick.finalAiScore?.grade ?? pick.scores?.grade ?? null,
    simHit: hit,
    composite,
    rankScore: composite ?? 0,
  };
}

function toLocalHistory(
  slice: PlayerHistorySlice | undefined,
): PropsOnlyHistorySlice | undefined {
  if (!slice?.recent?.length) return undefined;
  return {
    player: slice.player,
    recent: slice.recent.map((g) => ({
      stats: (g.stats ?? {}) as Record<string, string>,
    })),
  };
}

export type FootballPropsOnlyBuildOpts = {
  target: number;
  pool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  teamIdMap: Map<string, GameTeamIds>;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onPartialPicks?: (picks: ParsedPick[]) => void;
  /** Optional prefetched history (Player#athleteId) — skips duplicate network. */
  playerHistory?: Record<string, PlayerHistorySlice>;
  requestId?: string;
};

export type FootballPropsOnlyResult = {
  picks: ParsedPick[];
  note: string;
  propPoolSize: number;
  propSimEvaluated: number;
  propLegsScored: number;
  scanComplete: boolean;
};

/**
 * Build an NFL/NCAAF props-only ticket from posted odds + real player history.
 */
export async function buildFootballPropsOnlyTicket(
  opts: FootballPropsOnlyBuildOpts,
): Promise<FootballPropsOnlyResult> {
  const propPoolSize = opts.pool.length;
  const candidates = selectFootballPropsOnlyCandidates(opts.pool, opts.target);
  if (!candidates.length) {
    return {
      picks: [],
      note: "No athlete-linked NFL skill props were posted that we can grade from real history.",
      propPoolSize,
      propSimEvaluated: 0,
      propLegsScored: 0,
      scanComplete: true,
    };
  }

  opts.onStatus?.(
    `Loading game logs for ${candidates.length} NFL skill props…`,
  );

  // Prefetch histories for the finishable candidate set (not the whole board).
  const candidatePoolRows: PropPoolEntry[] = [];
  for (const p of candidates) {
    const side = p.propSide === "Under" ? "Under" : p.propSide === "Over" ? "Over" : null;
    if (!side || !p.player || !p.athleteId) continue;
    const found = opts.pool.find(
      (e) =>
        e.player === p.player &&
        e.side === side &&
        e.line === p.propLine &&
        String(e.athleteId ?? "") === String(p.athleteId),
    );
    if (found) {
      candidatePoolRows.push(found);
      continue;
    }
    candidatePoolRows.push({
      player: p.player,
      side,
      line: p.propLine ?? null,
      game: p.game,
      sport: p.sport ?? "nfl",
      marketLabel: p.market ?? "",
      marketKey: p.propMarketKey ?? null,
      odds: p.odds ?? 0,
      athleteId: String(p.athleteId),
    } as PropPoolEntry);
  }

  const seededHistory = { ...(opts.playerHistory ?? {}) };
  let fetched: Record<string, PlayerHistorySlice> = {};
  try {
    fetched = await prefetchPropPlayerHistory(candidatePoolRows, {
      signal: opts.signal,
      maxPlayers: Math.min(candidates.length, 48),
      concurrency: 8,
    });
  } catch {
    fetched = {};
  }
  Object.assign(seededHistory, fetched);

  const localHistories: Record<string, PropsOnlyHistorySlice | undefined> = {};
  for (const [k, v] of Object.entries(seededHistory)) {
    localHistories[k] = toLocalHistory(v);
  }

  opts.onStatus?.(`Grading ${candidates.length} NFL skill props from real history…`);

  // Synchronous local grade — no enrich race that can wipe the map.
  const propHits = gradeFootballPropsOnlyFromHistory(
    candidates,
    localHistories,
    opts.pool,
  );
  softClipPropsOnlyHits(candidates, propHits, opts.pool);

  // Optional short server boost for rows still null — never overwrite local grades.
  const stillNull = candidates.filter((p) => !propsOnlyPickHasGrade(p, propHits, opts.pool));
  if (stillNull.length && !opts.signal?.aborted) {
    opts.onStatus?.(
      `Local grades ready — boosting ${stillNull.length} remaining via deep sim…`,
    );
    for (let i = 0; i < stillNull.length; i += FOOTBALL_PROPS_ONLY_BATCH) {
      if (opts.signal?.aborted) break;
      const batch = stillNull.slice(i, i + FOOTBALL_PROPS_ONLY_BATCH);
      try {
        const serverRows = await Promise.race([
          fetchPropSimulations(
            batch,
            opts.pool,
            {
              tier: "deep",
              teamIdsByGame: opts.teamIdMap as Map<string, PropSimTeamIds>,
            },
            opts.signal,
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
        ]);
        if (!serverRows) continue;
        for (const [k, v] of serverRows) {
          if (v.hitProbability != null && Number.isFinite(v.hitProbability)) {
            const existing = propHits.get(k)?.hitProbability;
            if (existing == null || !Number.isFinite(existing)) {
              propHits.set(k, {
                hitProbability: v.hitProbability,
                nullReason: v.nullReason ?? null,
              });
            }
          } else if (!propHits.has(k)) {
            propHits.set(k, {
              hitProbability: null,
              nullReason: v.nullReason ?? null,
            });
          }
        }
        softClipPropsOnlyHits(batch, propHits, opts.pool);
      } catch {
        /* keep local grades */
      }
    }
  }

  const propSimEvaluated = candidates.length;
  const pending = candidates.filter((p) => propsOnlyPickHasGrade(p, propHits, opts.pool));
  const propScored: BoardScoredLeg[] = [];
  const seenFp = new Set<string>();

  if (pending.length) {
    for (let i = 0; i < pending.length; i += FOOTBALL_PROPS_ONLY_BATCH) {
      if (opts.signal?.aborted) break;
      const batch = pending.slice(i, i + FOOTBALL_PROPS_ONLY_BATCH);
      const scoredPicks = attachPickScores(batch, {
        realOdds: opts.realOdds,
        propPool: opts.pool,
        playerHistory: seededHistory,
        propSimulations: propHits,
      });
      for (const pick of scoredPicks) {
        const fp = pickLegFingerprint(pick);
        if (seenFp.has(fp)) continue;
        const leg = legFromScoredPick(pick);
        if (!leg) continue;
        seenFp.add(fp);
        propScored.push(leg);
      }
      if (propScored.length > 0) {
        const collapsed = collapseScoredLegsByMarketLadder(propScored);
        const { picks: partial } = buildStagedTicketFromScan(collapsed, opts.target);
        if (partial.length) opts.onPartialPicks?.(partial);
        opts.onStatus?.(
          `Scoring props… ${partial.length} of ${opts.target} cleared (${propScored.length} graded)`,
        );
        if (partial.length >= opts.target) break;
      }
    }
  }

  const collapsed = collapseScoredLegsByMarketLadder(propScored);
  collapsed.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  const { picks } = buildStagedTicketFromScan(collapsed, opts.target);
  const propLegsScored = propScored.length;

  let note = "";
  if (picks.length === 0) {
    note =
      propLegsScored > 0
        ? `Graded ${propLegsScored} props but none cleared the ticket quality bar. No ungraded filler was added.`
        : `You asked for **${opts.target}** legs — no AI-backed player props cleared the quality bar. No ungraded filler was added.`;
  } else if (picks.length < opts.target) {
    note = `You asked for **${opts.target}** legs — only **${picks.length}** player props cleared the AI quality bar. No ungraded filler was added.`;
  }

  return {
    picks,
    note,
    propPoolSize,
    propSimEvaluated,
    propLegsScored,
    scanComplete: true,
  };
}
