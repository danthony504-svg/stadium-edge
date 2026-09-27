/**
 * Greenfield NFL / NCAAF props-only ticket builder.
 *
 * After #540 phone still emptied (propLegsScored=0). Rebuild:
 * 1. Prefetch candidate game logs with normalized ESPN sport keys (no coach abort)
 * 2. Grade sync from history + parallel server MC boost
 * 3. Soft-clip TD 0/1
 * 4. Build scored legs directly (no attachPickScores / thin-context wipe)
 * 5. Stage via props-only odds gate (hit > implied) — not the multi-signal conf bar
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchPropSimulations, getPlayerHistory } from "./api.ts";
import type { GameTeamIds } from "./coachGameMonteCarlo.ts";
import {
  FOOTBALL_PROPS_ONLY_BATCH,
  selectFootballPropsOnlyFromPicks,
} from "./coachFootballPropsOnly.ts";
import {
  gradeFootballPropsOnlyFromHistory,
  lookupPropsOnlyHit,
  normalizeHistorySport,
  propsOnlyLegClearsOdds,
  propsOnlyPoolRowForPick,
  softClipPropsOnlyHits,
  type PropsOnlyHistorySlice,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  scoreLineShopping,
  scoreLineValue,
  scoreSimulation,
  type PickSubScores,
} from "./pickScore.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import {
  clipPropSimHitForGrade,
  sanitizeSimHitForGrade,
  parseMarketPeriod,
} from "./simMarketSupport.ts";
import { impliedProb } from "./format.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { parsedPickFromPoolEntry } from "./propSelection.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";

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
  normalizeHistorySport,
  propsOnlyLegClearsOdds,
  propsOnlyPickHasGrade,
  softClipPropsOnlyHits,
} from "./coachFootballPropsOnlyGrade.ts";

export function selectFootballPropsOnlyCandidates(
  pool: PropPoolEntry[],
  targetLegs: number,
): ParsedPick[] {
  return selectFootballPropsOnlyFromPicks(pool.map(parsedPickFromPoolEntry), targetLegs);
}

function scoredLegFromHit(
  pick: ParsedPick,
  rawHit: number | null,
  poolRow?: PropPoolEntry | null,
): BoardScoredLeg | null {
  const clipped = clipPropSimHitForGrade(pick, rawHit);
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
  if (!propsOnlyLegClearsOdds(pick, hit)) return null;

  const edgePct =
    hit != null && pick.odds != null
      ? Math.round((hit - impliedProb(pick.odds)) * 1000) / 10
      : poolRow?.edge ?? null;
  const rubricScores: PickSubScores = {
    matchup: null,
    trend: null,
    lineValue: scoreLineValue(edgePct),
    injury: null,
    lineShopping: scoreLineShopping(poolRow?.bookSpread ?? null),
    simulation: scoreSimulation(hit),
  };
  const finalAiScore = buildFinalAiScore({
    pick,
    rubricScores,
    edgePct,
    odds: pick.odds,
    propSimHit: hit,
  });
  const score = {
    ...finalAiScore,
    recommends: true,
    simAligned: true,
    edgePct: edgePct ?? finalAiScore.edgePct,
    simHit: hit,
  };
  const ev = hit != null && pick.odds != null ? simEvPct(hit, pick.odds) : null;
  const implied =
    pick.odds != null ? Math.round(impliedProb(pick.odds) * 1000) / 10 : null;
  const composite = score.composite;
  return {
    pick: {
      ...pick,
      finalAiScore: score,
      ticketRole: pick.propIsAlt ? "alt" : "main",
    },
    evPct: ev,
    edgePct: score.edgePct,
    confidencePct: score.confidencePct,
    impliedProbPct: implied,
    lineShoppingScore: rubricScores.lineShopping,
    grade: score.grade,
    simHit: hit,
    composite,
    rankScore: (composite ?? 0) + (ev ?? 0) * 0.01,
  };
}

export function stageFootballPropsOnlyLegs(
  scored: BoardScoredLeg[],
  target: number,
): ParsedPick[] {
  const picks: ParsedPick[] = [];
  const usedPlayerMarket = new Set<string>();
  const usedGames = new Map<string, number>();
  for (const leg of scored) {
    if (picks.length >= target) break;
    const p = leg.pick;
    if (!propsOnlyLegClearsOdds(p, leg.simHit)) continue;
    const pm = `${p.player}|${p.propMarketKey ?? p.market}`.toLowerCase();
    if (usedPlayerMarket.has(pm)) continue;
    const gameCount = usedGames.get(p.game) ?? 0;
    if (gameCount >= 3) continue;
    usedPlayerMarket.add(pm);
    usedGames.set(p.game, gameCount + 1);
    picks.push({
      ...p,
      ticketRole: p.propIsAlt ? "alt" : "main",
      finalAiScore: p.finalAiScore,
    });
  }
  return picks;
}

async function prefetchCandidateHistory(
  candidates: ParsedPick[],
  pool: PropPoolEntry[],
  seeded: Record<string, PlayerHistorySlice>,
): Promise<Record<string, PlayerHistorySlice>> {
  const out = { ...seeded };
  const rows: { player: string; athleteId: string; sport: string }[] = [];
  const seen = new Set<string>();
  for (const p of candidates) {
    const id = p.athleteId ? String(p.athleteId) : "";
    if (!id || !p.player) continue;
    const key = `${p.player}#${id}`;
    if (out[key]?.recent?.length || seen.has(key)) continue;
    seen.add(key);
    const fromPool = pool.find(
      (e) => e.player === p.player && String(e.athleteId ?? "") === id,
    );
    const sport =
      normalizeHistorySport(fromPool?.sport) ||
      normalizeHistorySport(p.sport) ||
      "nfl";
    rows.push({ player: p.player, athleteId: id, sport });
    if (rows.length >= 48) break;
  }

  const concurrency = 8;
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (r) => {
        try {
          // Dedicated timeout — do not share Coach abort (that was zeroing history mid-flight).
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 12_000);
          try {
            const h = await getPlayerHistory(
              { sport: r.sport, athleteId: r.athleteId, name: r.player },
              ac.signal,
            );
            if (!h?.recent?.length) return;
            out[`${r.player}#${r.athleteId}`] = {
              player: r.player,
              recent: h.recent.slice(0, 10).map((g) => ({
                date: g.date,
                opp: g.opponentName,
                stats: g.stats,
              })),
              vsOpponent: (h.vsOpponent ?? []).slice(0, 5).map((g) => ({
                date: g.date,
                stats: g.stats,
              })),
            };
          } finally {
            clearTimeout(t);
          }
        } catch {
          /* honest skip */
        }
      }),
    );
  }
  return out;
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

  opts.onStatus?.(`Loading game logs for ${candidates.length} NFL skill props…`);

  const seededHistory = await prefetchCandidateHistory(
    candidates,
    opts.pool,
    opts.playerHistory ?? {},
  );

  const localHistories: Record<string, PropsOnlyHistorySlice | undefined> = {};
  for (const [k, v] of Object.entries(seededHistory)) {
    localHistories[k] = toLocalHistory(v);
  }

  opts.onStatus?.(`Grading ${candidates.length} NFL skill props from real history…`);

  const propHits = gradeFootballPropsOnlyFromHistory(
    candidates,
    localHistories,
    opts.pool,
  );
  softClipPropsOnlyHits(candidates, propHits, opts.pool);

  // Server MC in parallel batches for still-null — never overwrite local grades.
  const stillNull = candidates.filter((p) => {
    const row = propsOnlyPoolRowForPick(p, opts.pool);
    const h = lookupPropsOnlyHit(p, row, propHits);
    return h == null || !Number.isFinite(h);
  });
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
        /* keep local */
      }
    }
  }

  const propScored: BoardScoredLeg[] = [];
  for (const pick of candidates) {
    const row = propsOnlyPoolRowForPick(pick, opts.pool) as PropPoolEntry | undefined;
    const raw = lookupPropsOnlyHit(pick, row, propHits);
    const leg = scoredLegFromHit(pick, raw, row);
    if (leg) propScored.push(leg);
  }
  propScored.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));

  const picks = stageFootballPropsOnlyLegs(propScored, opts.target);
  if (picks.length) opts.onPartialPicks?.(picks);
  if (picks.length) {
    opts.onStatus?.(`Scoring props… ${picks.length} of ${opts.target} cleared`);
  }

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
    propSimEvaluated: candidates.length,
    propLegsScored,
    scanComplete: true,
  };
}
