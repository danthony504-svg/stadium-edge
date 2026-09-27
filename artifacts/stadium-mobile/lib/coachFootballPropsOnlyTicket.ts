/**
 * Greenfield NFL / NCAAF props-only ticket builder.
 *
 * Rebuild after #541 phone empties (8-leg NFL props → quality bar, propLegsScored=0):
 * 1. Normalize null-line anytime TD → 0.5 so candidacy + history keys work
 * 2. Prefetch candidate game logs with normalized ESPN sport keys
 * 3. Grade sync from history + parallel server MC boost
 * 4. Soft-clip TD 0/1; collapse Over/Under to history best-EV side
 * 5. Stage via props-only odds gate (hit ≥ implied) — no attachPickScores wipe
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchPropSimulations, getPlayerHistory } from "./api.ts";
import type { GameTeamIds } from "./coachGameMonteCarlo.ts";
import {
  FOOTBALL_PROPS_ONLY_BATCH,
  selectFootballPropsOnlyFromPicks,
  stageFootballPropsOnlyLegs,
} from "./coachFootballPropsOnly.ts";
import {
  collapsePropsOnlyToBestEvSides,
  gradeFootballPropsOnlyFromHistory,
  lookupPropsOnlyHit,
  normalizeHistorySport,
  normalizePropsOnlyPick,
  propsOnlyEvPct,
  propsOnlyLegClearsOdds,
  propsOnlyPickHasGrade,
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
  isFootballPropsOnlyCandidate,
  selectFootballPropsOnlyFromPicks,
  shouldBuildFootballPropsOnlyTicket,
  stageFootballPropsOnlyLegs,
} from "./coachFootballPropsOnly.ts";

export {
  collapsePropsOnlyToBestEvSides,
  gradeFootballPropFromHistory,
  gradeFootballPropsOnlyFromHistory,
  normalizeHistorySport,
  normalizePropsOnlyPick,
  pickBestEvPropsOnlySide,
  propsOnlyEffectiveLine,
  propsOnlyLegClearsOdds,
  propsOnlyPickHasGrade,
  softClipPropsOnlyHits,
} from "./coachFootballPropsOnlyGrade.ts";

export function selectFootballPropsOnlyCandidates(
  pool: PropPoolEntry[],
  targetLegs: number,
): ParsedPick[] {
  return selectFootballPropsOnlyFromPicks(
    pool.map((e) => normalizePropsOnlyPick(parsedPickFromPoolEntry(e))),
    targetLegs,
  );
}

function scoredLegFromHit(
  pick: ParsedPick,
  rawHit: number | null,
  poolRow?: PropPoolEntry | null,
): BoardScoredLeg | null {
  const norm = normalizePropsOnlyPick(pick);
  const clipped = clipPropSimHitForGrade(norm, rawHit);
  const hit = sanitizeSimHitForGrade(clipped, {
    market: norm.market,
    sport: norm.sport,
    isProp: true,
    period: parseMarketPeriod(norm.market ?? ""),
    line: norm.propLine ?? null,
    odds: norm.odds ?? null,
    simulationStatKey: "player_prop",
    expectedStatKey: "player_prop",
  });
  if (!propsOnlyLegClearsOdds(norm, hit)) return null;

  const edgePct =
    hit != null && norm.odds != null
      ? Math.round((hit - impliedProb(norm.odds)) * 1000) / 10
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
    pick: norm,
    rubricScores,
    edgePct,
    odds: norm.odds,
    propSimHit: hit,
  });
  const score = {
    ...finalAiScore,
    recommends: true,
    simAligned: true,
    edgePct: edgePct ?? finalAiScore.edgePct,
    simHit: hit,
  };
  const ev = hit != null && norm.odds != null ? simEvPct(hit, norm.odds) : null;
  const implied =
    norm.odds != null ? Math.round(impliedProb(norm.odds) * 1000) / 10 : null;
  const composite = score.composite;
  return {
    pick: {
      ...norm,
      finalAiScore: score,
      ticketRole: norm.propIsAlt ? "alt" : "main",
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

  // Count graded BEFORE odds filter — phone empties were scoring 0 because
  // wrong-side / null-line never produced a gradeable key.
  const gradedCandidates = candidates.filter((p) =>
    propsOnlyPickHasGrade(p, propHits, opts.pool),
  );
  const propLegsScored = gradedCandidates.length;

  // Collapse Over/Under to history best-EV side, then stage through odds gate.
  const bestSides = collapsePropsOnlyToBestEvSides(candidates, propHits, opts.pool);
  const propScored: BoardScoredLeg[] = [];
  for (const pick of bestSides) {
    const row = propsOnlyPoolRowForPick(pick, opts.pool) as PropPoolEntry | undefined;
    const raw = lookupPropsOnlyHit(pick, row, propHits);
    const leg = scoredLegFromHit(pick, raw, row);
    if (leg) propScored.push(leg);
  }
  propScored.sort((a, b) => {
    const evA = a.evPct ?? propsOnlyEvPct(a.pick, a.simHit) ?? -999;
    const evB = b.evPct ?? propsOnlyEvPct(b.pick, b.simHit) ?? -999;
    if (evB !== evA) return evB - evA;
    return (b.rankScore ?? 0) - (a.rankScore ?? 0);
  });

  const picks = stageFootballPropsOnlyLegs(propScored, opts.target);
  if (picks.length) opts.onPartialPicks?.(picks);
  if (picks.length) {
    opts.onStatus?.(`Scoring props… ${picks.length} of ${opts.target} cleared`);
  }

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
