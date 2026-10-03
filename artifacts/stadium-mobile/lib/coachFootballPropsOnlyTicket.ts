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
  playerTrendMomentum,
  scoreLineShopping,
  scoreLineValue,
  scoreSimulation,
  scoreTrend,
  type PickSubScores,
} from "./pickScore.ts";
import { buildFinalAiScore } from "./finalAiScore.ts";
import {
  opponentTeamIdForProp,
  ownTeamIdForProp,
  oppDefensePackForOpponent,
  ownTeamPackForProp,
  type FootballOppDefenseMap,
} from "./footballOppDefenseContext.ts";
import { propTeamAbbrBelongsToGame } from "./footballOppTeamId.ts";
import {
  adjustSimHitForOppDefenseTilt,
  keepOrSwapDefenseAwareSide,
  nhlScoringMissingOppContext,
  propOppDefenseTilt,
  shouldBlockRushOverVsDefense,
  shouldDropPropMissingOppDefense,
  shouldPreferDefenseAltPick,
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
import { computeAmbiguous, gameValueForMarket } from "./propStats.ts";

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
  propsOnlyCollapseLadderKey,
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

function mlbPlatoonLookup(
  player: string | undefined,
  athleteId: string | null | undefined,
  map?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!map) return null;
  if (athleteId && player) {
    const hit = map[`${player}#${athleteId}`];
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  }
  if (athleteId) {
    const hit = Object.entries(map).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  }
  if (player) {
    const hit = Object.entries(map).find(([k]) => k.startsWith(`${player}#`))?.[1];
    if (hit && typeof hit === "object") return hit as Record<string, unknown>;
  }
  return null;
}

function lookupPropsOnlyPlayerHistory(
  player: string | undefined,
  athleteId: string | null | undefined,
  map?: Record<string, PlayerHistorySlice>,
): PlayerHistorySlice | undefined {
  if (!map) return undefined;
  if (athleteId) {
    const hit =
      map[`${player}#${athleteId}`] ??
      Object.entries(map).find(([k]) => k.endsWith(`#${athleteId}`))?.[1];
    if (hit) return hit;
  }
  if (player) {
    const hit = Object.entries(map).find(([k]) => k.startsWith(`${player}#`))?.[1];
    if (hit) return hit;
  }
  return undefined;
}

/** Recent-form trend from real game logs — same rubric input board scan uses. */
function propsOnlyTrendFromHistory(
  ph: PlayerHistorySlice | undefined,
  marketKey: string,
  line: number | null | undefined,
  side: string | null | undefined,
): number | null {
  if (!ph?.recent?.length || line == null) return null;
  const ambiguous = computeAmbiguous(ph.labels);
  const vals = ph.recent
    .map((g) =>
      gameValueForMarket(
        marketKey,
        (g.stats ?? {}) as Record<string, string>,
        ambiguous,
      ),
    )
    .filter((v): v is number => v != null);
  return scoreTrend(playerTrendMomentum(vals, line, side));
}

function scoredLegFromHit(
  pick: ParsedPick,
  rawHit: number | null,
  poolRow?: PropPoolEntry | null,
  rushCtx?: {
    oppRushDefense?: FootballOppDefenseMap;
    espnGames?: EspnGame[];
    teamIdMap?: Map<string, GameTeamIds>;
    mlbPlatoon?: Record<string, unknown>;
    mlbGameEnv?: Record<string, unknown>;
    playerHistory?: Record<string, PlayerHistorySlice>;
  },
): BoardScoredLeg | null {
  const norm = normalizePropsOnlyPick(pick);
  const clipped = clipPropSimHitForGrade(norm, rawHit);
  let hit = sanitizeSimHitForGrade(clipped, {
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

  const sport = norm.sport ?? poolRow?.sport;
  const marketKey = norm.propMarketKey ?? norm.market;
  const teamAbbr = poolRow?.teamAbbr ?? norm.teamAbbr;
  // Fail closed: player must belong to one side of the labeled game.
  if (
    teamAbbr &&
    rushCtx?.espnGames?.length &&
    !propTeamAbbrBelongsToGame({
      sport,
      game: norm.game,
      teamAbbr,
      espnGames: rushCtx.espnGames,
      teamIdMap: rushCtx.teamIdMap,
    })
  ) {
    return null;
  }
  const oppId = opponentTeamIdForProp({
    sport,
    game: norm.game,
    teamAbbr,
    espnGames: rushCtx?.espnGames,
    teamIdMap: rushCtx?.teamIdMap,
  });
  const ownId = ownTeamIdForProp({
    sport,
    game: norm.game,
    teamAbbr,
    espnGames: rushCtx?.espnGames,
    teamIdMap: rushCtx?.teamIdMap,
  });
  const pack = oppDefensePackForOpponent({
    sport,
    opponentTeamId: oppId,
    map: rushCtx?.oppRushDefense,
  });
  const ownPack = ownTeamPackForProp({
    sport,
    ownTeamId: ownId,
    map: rushCtx?.oppRushDefense,
  });
  const ph = lookupPropsOnlyPlayerHistory(
    norm.player,
    poolRow?.athleteId ?? norm.athleteId,
    rushCtx?.playerHistory,
  );
  const vsOpponentGames = ph?.vsOpponent?.length ?? 0;
  // Fail closed: NHL Goals/Points need opp goaltending or vs-opponent history —
  // no EV-only Unders/Overs with Match greyed out.
  if (
    shouldDropPropMissingOppDefense({
      sport,
      market: marketKey,
      side: norm.propSide,
      line: norm.propLine,
      pack,
      vsOpponentGames,
    })
  ) {
    return null;
  }
  if (
    shouldBlockRushOverVsDefense({
      sport,
      market: marketKey,
      side: norm.propSide,
      defense: pack?.rush ?? null,
      pack,
      ownPack,
    })
  ) {
    return null;
  }
  const defTilt = propOppDefenseTilt({
    sport,
    market: marketKey,
    side: norm.propSide,
    defense: pack?.rush ?? null,
    pack,
    ownPack,
  });
  // Matchup must move projection/grade — adjust sim hit (bounded), not display-only.
  hit = adjustSimHitForOppDefenseTilt(hit, defTilt.tilt);

  const trend = propsOnlyTrendFromHistory(
    ph,
    String(marketKey ?? ""),
    norm.propLine,
    norm.propSide,
  );

  const edgePct =
    hit != null && norm.odds != null
      ? Math.round((hit - impliedProb(norm.odds)) * 1000) / 10
      : poolRow?.edge ?? null;
  const rubricScores: PickSubScores = {
    // Matchup lean comes from holistic opponentTendency (opp D + vsOpponent).
    matchup: null,
    trend,
    lineValue: scoreLineValue(edgePct),
    injury: null,
    lineShopping: scoreLineShopping(poolRow?.bookSpread ?? null),
    simulation: scoreSimulation(hit),
  };
  const mlbPlatoon = mlbPlatoonLookup(
    norm.player,
    poolRow?.athleteId ?? norm.athleteId,
    rushCtx?.mlbPlatoon,
  );
  const mlbGameEnv =
    rushCtx?.mlbGameEnv && norm.game
      ? ((rushCtx.mlbGameEnv[norm.game] as Record<string, unknown> | undefined) ?? null)
      : null;
  const finalAiScore = buildFinalAiScore({
    pick: norm,
    rubricScores,
    edgePct,
    odds: norm.odds,
    propSimHit: hit,
    propHolisticContext: {
      sport,
      marketKey,
      propSide: norm.propSide,
      minutesTrend: ph?.minutesTrend ?? null,
      vsOpponentGames,
      rushDefense: pack?.rush ?? null,
      footballOppDefense: pack,
      footballOwnPack: ownPack,
      mlbPlatoon: mlbPlatoon as import("./propHolisticRecommendation.ts").MlbPlatoonSlice | null,
      mlbGameEnv: mlbGameEnv as import("./propHolisticRecommendation.ts").MlbGameEnvSlice | null,
    },
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
    // Opp-D tilt + Match-grounded boost; demote NHL scoring without opp context
    // so EV-only Unders don't beat legs that compared the netminder.
    rankScore:
      (composite ?? 0) +
      (ev ?? 0) * 0.01 +
      defTilt.tilt +
      (defTilt.display ? 0.45 : 0) +
      (vsOpponentGames > 0 ? 0.2 : 0) -
      (nhlScoringMissingOppContext({
        sport,
        market: marketKey,
        pack,
        vsOpponentGames,
      })
        ? 1.25
        : 0),
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
  /** Opponent defense packs — blocks/demotes Overs vs stingy D across sports. */
  oppRushDefense?: FootballOppDefenseMap;
  espnGames?: EspnGame[];
  /** MLB pitcher/platoon + park/weather for props-only holistic scoring. */
  mlbPlatoon?: Record<string, unknown>;
  mlbGameEnv?: Record<string, unknown>;
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
  // BEFORE picking: if that side is defense-hostile (hard block OR soft stingy),
  // swap to Under / softer alt Over so Coach still fills the seat without
  // locking a bad main Over (Monangai Over 40 → Under or Over 24.5).
  const rushCtx = {
    oppRushDefense: opts.oppRushDefense,
    espnGames: opts.espnGames,
    teamIdMap: opts.teamIdMap,
    mlbPlatoon: opts.mlbPlatoon,
    mlbGameEnv: opts.mlbGameEnv,
    playerHistory: seededHistory,
  };
  const normalizedCandidates = candidates.map((c) => normalizePropsOnlyPick(c));
  const bestSides = collapsePropsOnlyToBestEvSides(candidates, propHits, opts.pool).flatMap(
    (pick) => {
      const row = propsOnlyPoolRowForPick(pick, opts.pool) as PropPoolEntry | undefined;
      const sport = pick.sport ?? row?.sport;
      const resolvePack = (p: ParsedPick) => {
        const r = propsOnlyPoolRowForPick(p, opts.pool) as PropPoolEntry | undefined;
        const sp = p.sport ?? r?.sport ?? sport;
        const abbr = r?.teamAbbr ?? p.teamAbbr;
        return {
          row: r,
          pack: oppDefensePackForOpponent({
            sport: sp,
            opponentTeamId: opponentTeamIdForProp({
              sport: sp,
              game: p.game,
              teamAbbr: abbr,
              espnGames: opts.espnGames,
              teamIdMap: opts.teamIdMap,
            }),
            map: opts.oppRushDefense,
          }),
          ownPack: ownTeamPackForProp({
            sport: sp,
            ownTeamId: ownTeamIdForProp({
              sport: sp,
              game: p.game,
              teamAbbr: abbr,
              espnGames: opts.espnGames,
              teamIdMap: opts.teamIdMap,
            }),
            map: opts.oppRushDefense,
          }),
          vsOpponentGames:
            lookupPropsOnlyPlayerHistory(
              p.player,
              r?.athleteId ?? p.athleteId,
              seededHistory,
            )?.vsOpponent?.length ?? 0,
        };
      };
      const { pack, ownPack, vsOpponentGames } = resolvePack(pick);
      if (
        shouldDropPropMissingOppDefense({
          sport,
          market: pick.propMarketKey ?? pick.market,
          side: pick.propSide,
          line: pick.propLine,
          pack,
          vsOpponentGames,
        })
      ) {
        // Rare Over ≥1.5 missing Match — try Under/softer alt; keep Over if none.
        if (String(pick.propSide ?? "").toLowerCase() === "over") {
          const alt = keepOrSwapDefenseAwareSide(pick, normalizedCandidates);
          const altCtx = resolvePack(alt);
          if (
            shouldDropPropMissingOppDefense({
              sport: alt.sport ?? altCtx.row?.sport ?? sport,
              market: alt.propMarketKey ?? alt.market,
              side: alt.propSide,
              line: alt.propLine,
              pack: altCtx.pack,
              vsOpponentGames: altCtx.vsOpponentGames,
            })
          ) {
            // Still missing Match after swap (or same Over) — demote via rank later.
            return alt === pick ? [] : [alt];
          }
          return [alt];
        }
        return [];
      }
      if (
        !shouldPreferDefenseAltPick({
          sport,
          market: pick.propMarketKey ?? pick.market,
          side: pick.propSide,
          defense: pack?.rush ?? null,
          pack,
          ownPack,
        })
      ) {
        return [pick];
      }
      // Prefer Under/softer Over when posted. If none (Anytime TD Yes-only),
      // KEEP the graded Over — wiping here graded 40 TDs → 0 staged on phone.
      const swapped = keepOrSwapDefenseAwareSide(pick, normalizedCandidates);
      const altCtx = resolvePack(swapped);
      if (
        swapped !== pick &&
        (shouldDropPropMissingOppDefense({
          sport: swapped.sport ?? altCtx.row?.sport ?? sport,
          market: swapped.propMarketKey ?? swapped.market,
          side: swapped.propSide,
          line: swapped.propLine,
          pack: altCtx.pack,
          vsOpponentGames: altCtx.vsOpponentGames,
        }) ||
          shouldBlockRushOverVsDefense({
            sport: swapped.sport ?? altCtx.row?.sport ?? sport,
            market: swapped.propMarketKey ?? swapped.market,
            side: swapped.propSide,
            defense: altCtx.pack?.rush ?? null,
            pack: altCtx.pack,
            ownPack: altCtx.ownPack,
          }))
      ) {
        // Swapped side is still hostile — keep original Over (odds gate + tilt).
        return [pick];
      }
      return [swapped];
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
