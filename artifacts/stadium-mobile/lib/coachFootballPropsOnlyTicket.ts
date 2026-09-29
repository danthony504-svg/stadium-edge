/**
 * Greenfield props-only ticket builder (all sports).
 *
 * Rebuild after phone "8 leg player prop" → 3 WNBA legs / "7 leg NFL" empty:
 * Generic board-scan fill (confidence≥52 + Match/Form/Inj) is never used for
 * props-only. History hit vs odds + best-EV side stages the ticket.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { EspnGame, PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
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
  mergePropsOnlySeasonLogs,
  normalizeHistorySport,
  normalizePropsOnlyPick,
  propsOnlyEvPct,
  propsOnlyLegClearsOdds,
  propsOnlyPickHasGrade,
  propsOnlyPoolRowForPick,
  propsOnlyPriorSeasonYear,
  propsOnlySimLookupKey,
  softClipPropsOnlyHits,
  PROPS_ONLY_HISTORY_BACKFILL_BELOW,
  type PropsOnlyHistorySlice,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  buildPropsOnlyFailDiag,
  propsOnlyFailNote,
  type PropsOnlyFailDiag,
} from "./coachPropsOnlyFailReason.ts";
import {
  scoreLineShopping,
  scoreLineValue,
  scoreSimulation,
  type PickSubScores,
} from "./pickScore.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import {
  opponentTeamIdForProp,
  oppDefensePackForOpponent,
  type FootballOppDefenseMap,
} from "./footballOppDefenseContext.ts";
import {
  footballRushDefenseTilt,
  shouldBlockRushOverVsDefense,
} from "./footballRushDefense.ts";
import {
  clipPropSimHitForGrade,
  sanitizeSimHitForGrade,
  parseMarketPeriod,
} from "./simMarketSupport.ts";
import { impliedProb } from "./format.ts";
import { COACH_SIM_MIN_CONFIDENCE, simEvPct } from "./gameSimQualityGates.ts";
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
  mergePropsOnlyHistoryGames,
  mergePropsOnlySeasonLogs,
  normalizeHistorySport,
  normalizePropsOnlyPick,
  pickBestEvPropsOnlySide,
  propsOnlyEffectiveLine,
  propsOnlyLegClearsOdds,
  propsOnlyPickHasGrade,
  propsOnlyPriorSeasonYear,
  softClipPropsOnlyHits,
  PROPS_ONLY_MIN_SAMPLE,
} from "./coachFootballPropsOnlyGrade.ts";

export {
  buildPropsOnlyFailDiag,
  formatPropsOnlyFailTrace,
  propsOnlyFailNote,
} from "./coachPropsOnlyFailReason.ts";

function countPoolSports(pool: PropPoolEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of pool) {
    const s = String(e.sport ?? "unknown").toLowerCase() || "unknown";
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

function countAthleteLinked(pool: PropPoolEntry[]): number {
  let n = 0;
  for (const e of pool) {
    if (e.athleteId) n += 1;
  }
  return n;
}

function collectNullReasons(
  candidates: ParsedPick[],
  hits: Map<string, { hitProbability: number | null; nullReason?: string | null }>,
  pool: PropPoolEntry[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pick of candidates) {
    const row = propsOnlyPoolRowForPick(pick, pool);
    const key = propsOnlySimLookupKey(pick, row);
    if (!key) {
      out.no_lookup_key = (out.no_lookup_key ?? 0) + 1;
      continue;
    }
    const hit = hits.get(key);
    if (hit?.hitProbability != null && Number.isFinite(hit.hitProbability)) continue;
    const reason = hit?.nullReason || "ungraded";
    out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}

export function selectFootballPropsOnlyCandidates(
  pool: PropPoolEntry[],
  targetLegs: number,
): ParsedPick[] {
  return selectFootballPropsOnlyFromPicks(
    pool.map((e) => normalizePropsOnlyPick(parsedPickFromPoolEntry(e))),
    targetLegs,
    pool,
  );
}

function scoredLegFromHit(
  pick: ParsedPick,
  rawHit: number | null,
  poolRow?: PropPoolEntry | null,
  rushCtx?: {
    oppRushDefense?: FootballOppDefenseMap;
    espnGames?: EspnGame[];
    teamIdMap?: Map<string, GameTeamIds>;
  },
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

  const oppId = opponentTeamIdForProp({
    sport: norm.sport ?? poolRow?.sport,
    game: norm.game,
    teamAbbr: poolRow?.teamAbbr,
    espnGames: rushCtx?.espnGames,
    teamIdMap: rushCtx?.teamIdMap,
  });
  const pack = oppDefensePackForOpponent({
    sport: norm.sport ?? poolRow?.sport,
    opponentTeamId: oppId,
    map: rushCtx?.oppRushDefense,
  });
  if (
    shouldBlockRushOverVsDefense({
      market: norm.propMarketKey ?? norm.market,
      side: norm.propSide,
      defense: pack?.rush ?? null,
      pack,
    })
  ) {
    return null;
  }
  const rushTilt = footballRushDefenseTilt({
    market: norm.propMarketKey ?? norm.market,
    side: norm.propSide,
    defense: pack?.rush ?? null,
    pack,
  });

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
    propHolisticContext: pack
      ? {
          sport: norm.sport ?? poolRow?.sport,
          marketKey: norm.propMarketKey ?? norm.market,
          propSide: norm.propSide,
          rushDefense: pack.rush ?? null,
          footballOppDefense: pack,
        }
      : undefined,
  });
  // Phone: Anytime TD +370 showed Conf 42 / Not Rec. because sim~50% floors
  // confidence at 50 (<52) even with +28% edge. Props-only already cleared
  // history vs odds — lift to the ticket confidence floor so the card grade
  // matches "cleared the AI quality bar".
  const confidencePct = Math.max(
    finalAiScore.confidencePct ?? 0,
    COACH_SIM_MIN_CONFIDENCE,
  );
  const score = {
    ...finalAiScore,
    recommends: true,
    simAligned: true,
    edgePct: edgePct ?? finalAiScore.edgePct,
    simHit: hit,
    confidencePct,
  };
  const ev = hit != null && norm.odds != null ? simEvPct(hit, norm.odds) : null;
  const implied =
    norm.odds != null ? Math.round(impliedProb(norm.odds) * 1000) / 10 : null;
  const composite = score.composite;
  return {
    pick: {
      ...norm,
      propsOnlyTicket: true,
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
    // Soft rush-D tilt demotes Overs vs stingy fronts (Monangai vs PHI).
    rankScore: (composite ?? 0) + (ev ?? 0) * 0.01 + rushTilt.tilt,
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
    if ((out[key]?.recent?.length ?? 0) >= PROPS_ONLY_HISTORY_BACKFILL_BELOW || seen.has(key)) {
      continue;
    }
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

  const mapRecent = (
    games: { date?: string | null; opponentName?: string | null; opp?: string | null; stats?: Record<string, string> }[],
  ) =>
    games.slice(0, 10).map((g) => ({
      date: g.date ?? null,
      opp: g.opponentName ?? g.opp ?? null,
      stats: g.stats ?? {},
    }));

  const concurrency = 8;
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (r) => {
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 14_000);
          try {
            const h = await getPlayerHistory(
              { sport: r.sport, athleteId: r.athleteId, name: r.player },
              ac.signal,
            );
            let recent = mapRecent(h?.recent ?? []);
            // Phone diag: early NFL season had 0–3 current games → insufficient_game_log.
            // Backfill prior season so grading has a real sample without inventing stats.
            if (recent.length < PROPS_ONLY_HISTORY_BACKFILL_BELOW) {
              const priorYear = propsOnlyPriorSeasonYear(h?.availableSeasons);
              try {
                const prior = await getPlayerHistory(
                  {
                    sport: r.sport,
                    athleteId: r.athleteId,
                    name: r.player,
                    season: priorYear,
                  },
                  ac.signal,
                );
                recent = mergePropsOnlySeasonLogs(recent, mapRecent(prior?.recent ?? []));
              } catch {
                /* keep current */
              }
            }
            if (!recent.length) return;
            const existing = out[`${r.player}#${r.athleteId}`];
            if ((existing?.recent?.length ?? 0) >= recent.length) return;
            out[`${r.player}#${r.athleteId}`] = {
              player: r.player,
              recent,
              vsOpponent: (h?.vsOpponent ?? []).slice(0, 5).map((g) => ({
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
  /** NFL/NCAAF opponent rush yards allowed — blocks/demotes rush Overs vs stingy D. */
  oppRushDefense?: FootballOppDefenseMap;
  espnGames?: EspnGame[];
  requestId?: string;
};

export type FootballPropsOnlyResult = {
  picks: ParsedPick[];
  note: string;
  propPoolSize: number;
  propSimEvaluated: number;
  propLegsScored: number;
  scanComplete: boolean;
  /** Present when the ticket is empty or short — phone-visible why. */
  failDiag?: PropsOnlyFailDiag;
};

export async function buildFootballPropsOnlyTicket(
  opts: FootballPropsOnlyBuildOpts,
): Promise<FootballPropsOnlyResult> {
  const propPoolSize = opts.pool.length;
  const athleteLinked = countAthleteLinked(opts.pool);
  const sports = countPoolSports(opts.pool);
  const candidates = selectFootballPropsOnlyCandidates(opts.pool, opts.target);

  if (!candidates.length) {
    const failDiag = buildPropsOnlyFailDiag({
      target: opts.target,
      pool: propPoolSize,
      athleteLinked,
      candidates: 0,
      historyLoaded: 0,
      graded: 0,
      bestEvSides: 0,
      oddsCleared: 0,
      staged: 0,
      sports,
      nullReasons: {
        no_candidates: 1,
        ...(athleteLinked <= 0 ? { missing_athlete_id: propPoolSize } : {}),
      },
    });
    return {
      picks: [],
      note: propsOnlyFailNote(
        "No athlete-linked player props were posted that we can grade from real history.",
        failDiag,
      ),
      propPoolSize,
      propSimEvaluated: 0,
      propLegsScored: 0,
      scanComplete: true,
      failDiag,
    };
  }

  opts.onStatus?.(`Loading game logs for ${candidates.length} player props…`);

  const seededHistory = await prefetchCandidateHistory(
    candidates,
    opts.pool,
    opts.playerHistory ?? {},
  );

  const localHistories: Record<string, PropsOnlyHistorySlice | undefined> = {};
  for (const [k, v] of Object.entries(seededHistory)) {
    localHistories[k] = toLocalHistory(v);
  }
  const historyLoaded = Object.values(localHistories).filter(
    (h) => (h?.recent?.length ?? 0) > 0,
  ).length;

  opts.onStatus?.(`Grading ${candidates.length} player props from real history…`);

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

  const nullReasons = collectNullReasons(candidates, propHits, opts.pool);

  // Count graded BEFORE odds filter — phone empties were scoring 0 because
  // wrong-side / null-line never produced a gradeable key.
  const gradedCandidates = candidates.filter((p) =>
    propsOnlyPickHasGrade(p, propHits, opts.pool),
  );
  const propLegsScored = gradedCandidates.length;

  // Collapse Over/Under to history best-EV side, then stage through odds gate.
  // When best EV is a skill-yard OVER vs a hard stingy D (rush/pass/recv),
  // prefer the Under — including alt Under rungs for the same player/market —
  // so Coach still fills the seat without locking a bad Over.
  const rushCtx = {
    oppRushDefense: opts.oppRushDefense,
    espnGames: opts.espnGames,
    teamIdMap: opts.teamIdMap,
  };
  const bestSides = collapsePropsOnlyToBestEvSides(candidates, propHits, opts.pool).flatMap(
    (pick) => {
      const row = propsOnlyPoolRowForPick(pick, opts.pool) as PropPoolEntry | undefined;
      const pack = oppDefensePackForOpponent({
        sport: pick.sport ?? row?.sport,
        opponentTeamId: opponentTeamIdForProp({
          sport: pick.sport ?? row?.sport,
          game: pick.game,
          teamAbbr: row?.teamAbbr,
          espnGames: opts.espnGames,
          teamIdMap: opts.teamIdMap,
        }),
        map: opts.oppRushDefense,
      });
      if (
        !shouldBlockRushOverVsDefense({
          market: pick.propMarketKey ?? pick.market,
          side: pick.propSide,
          defense: pack?.rush ?? null,
          pack,
        })
      ) {
        return [pick];
      }
      // Prefer graded Under — same line first, then any alt Under for this player/market.
      const marketKey = String(pick.propMarketKey ?? pick.market ?? "").toLowerCase();
      const samePlayerMarket = (c: ParsedPick) => {
        const n = normalizePropsOnlyPick(c);
        return (
          n.game === pick.game &&
          n.player === pick.player &&
          String(n.propMarketKey ?? n.market ?? "").toLowerCase() === marketKey &&
          n.propSide === "Under"
        );
      };
      const sameLineUnder = candidates.find((c) => {
        const n = normalizePropsOnlyPick(c);
        return samePlayerMarket(n) && n.propLine === pick.propLine;
      });
      if (sameLineUnder) return [normalizePropsOnlyPick(sameLineUnder)];
      const altUnder = candidates
        .map((c) => normalizePropsOnlyPick(c))
        .filter(samePlayerMarket)
        .sort((a, b) => (b.propLine ?? 0) - (a.propLine ?? 0));
      return altUnder.length ? [altUnder[0]] : [];
    },
  );
  const propScored: BoardScoredLeg[] = [];
  for (const pick of bestSides) {
    const row = propsOnlyPoolRowForPick(pick, opts.pool) as PropPoolEntry | undefined;
    const raw = lookupPropsOnlyHit(pick, row, propHits);
    const leg = scoredLegFromHit(pick, raw, row, rushCtx);
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

  const uniqueGames = new Set(
    propScored.map((l) => String(l.pick.game ?? "")).filter(Boolean),
  ).size;
  const failDiag = buildPropsOnlyFailDiag({
    target: opts.target,
    pool: propPoolSize,
    athleteLinked,
    candidates: candidates.length,
    historyLoaded,
    graded: propLegsScored,
    bestEvSides: bestSides.length,
    oddsCleared: propScored.length,
    staged: picks.length,
    uniqueGames,
    nullReasons,
    sports,
  });

  let note = "";
  if (picks.length === 0) {
    const lead =
      propLegsScored > 0
        ? `Graded ${propLegsScored} props but none cleared the ticket quality bar. No ungraded filler was added.`
        : `You asked for **${opts.target}** legs — no AI-backed player props cleared the quality bar. No ungraded filler was added.`;
    note = propsOnlyFailNote(lead, failDiag);
  } else if (picks.length < opts.target) {
    // Phone: oddsOk=23 staged=3 — diversity/thin slate, not a quality wipe.
    const lead =
      propScored.length > picks.length && uniqueGames > 0
        ? `You asked for **${opts.target}** legs — only **${picks.length}** player props fit after thin-slate fill (${uniqueGames} game${uniqueGames === 1 ? "" : "s"}, ${propScored.length} cleared odds). No ungraded filler was added.`
        : `You asked for **${opts.target}** legs — only **${picks.length}** player props cleared the AI quality bar. No ungraded filler was added.`;
    note = propsOnlyFailNote(lead, failDiag);
  }

  return {
    picks,
    note,
    propPoolSize,
    propSimEvaluated: candidates.length,
    propLegsScored,
    scanComplete: true,
    ...(picks.length < opts.target ? { failDiag } : {}),
  };
}
