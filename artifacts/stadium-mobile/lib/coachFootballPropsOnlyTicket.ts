/**
 * Greenfield NFL / NCAAF props-only ticket builder.
 *
 * Replaces the generic board-scan path for asks like "9 leg NFL player props".
 * That path deep-simmed finishable skill rows (72) then wiped every batch when
 * enrich timed out → PROP_ALL_NO_SIM_GRADE with 0 cards on phone.
 *
 * Contract:
 * 1. AthleteId-required skill set (yards / TD / volume quotas), finishable size
 * 2. Tiny batches — local history grades first, server MC optional boost
 * 3. Soft-clip binary TD 0/1 so sanitize can admit grades
 * 4. Stage every prop that clears sim grade + ticket gates — never invent odds
 * 5. Never wipe local hits when the server race times out
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, PropSimTeamIds, RealOddsEntry } from "./api.ts";
import { fetchPropSimulations } from "./api.ts";
import { enrichCoachPropSimHits } from "./coachPropSimFallback.ts";
import type { GameTeamIds } from "./coachGameMonteCarlo.ts";
import {
  FOOTBALL_PROPS_ONLY_BATCH,
  selectFootballPropsOnlyFromPicks,
} from "./coachFootballPropsOnly.ts";
import { impliedProb } from "./format.ts";
import { attachPickScores } from "./pickScoreContext.ts";
import type { PlayerHistorySlice } from "./pickScoreContext.ts";
import { parsedPickFromPoolEntry, propSimLookupKey } from "./propSelection.ts";
import {
  clipPropSimHitForGrade,
  pickHasSimGrade,
  sanitizeSimHitForGrade,
  parseMarketPeriod,
} from "./simMarketSupport.ts";
import { simEvPct } from "./gameSimQualityGates.ts";
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

export function selectFootballPropsOnlyCandidates(
  pool: PropPoolEntry[],
  targetLegs: number,
): ParsedPick[] {
  return selectFootballPropsOnlyFromPicks(pool.map(parsedPickFromPoolEntry), targetLegs);
}

type PropHit = { hitProbability: number | null; nullReason?: string | null };

function poolRowForPick(pick: ParsedPick, pool: PropPoolEntry[]): PropPoolEntry | undefined {
  const side = pick.propSide === "Under" ? "Under" : pick.propSide === "Over" ? "Over" : null;
  if (!side || pick.propLine == null) return undefined;
  return (
    pool.find(
      (e) =>
        e.player === pick.player &&
        e.side === side &&
        e.line === pick.propLine &&
        (pick.game ? e.game === pick.game : true),
    ) ?? pool.find((e) => e.player === pick.player && e.side === side)
  );
}

function aliasHits(batch: ParsedPick[], hits: Map<string, PropHit>): Map<string, PropHit> {
  const out = new Map(hits);
  for (const pick of batch) {
    const key = propSimLookupKey(pick, poolRowForPick(pick, []));
    if (!key || out.has(key)) continue;
    const side = pick.propSide === "Under" ? "Under" : "Over";
    if (pick.propLine == null || !pick.player) continue;
    const suffix = `|${pick.propLine}|${side}`;
    for (const [serverKey, row] of hits) {
      if (serverKey.startsWith(`${pick.player}|`) && serverKey.endsWith(suffix)) {
        out.set(key, row);
        break;
      }
    }
  }
  return out;
}

function applySoftClips(
  batch: ParsedPick[],
  pool: PropPoolEntry[],
  hits: Map<string, PropHit>,
): void {
  for (const pick of batch) {
    const key = propSimLookupKey(pick, poolRowForPick(pick, pool));
    if (!key) continue;
    const raw = hits.get(key)?.hitProbability;
    const clipped = clipPropSimHitForGrade(pick, raw);
    if (clipped != null && clipped !== raw) {
      hits.set(key, { hitProbability: clipped });
    }
  }
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

export type FootballPropsOnlyBuildOpts = {
  target: number;
  pool: PropPoolEntry[];
  realOdds: RealOddsEntry[];
  teamIdMap: Map<string, GameTeamIds>;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onPartialPicks?: (picks: ParsedPick[]) => void;
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
 * Local-first grading in tiny batches — does not share the generic board-scan
 * enrich race that zeroed phone props-only tickets.
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
    `Grading ${candidates.length} NFL skill props (local history first)…`,
  );

  const propHits = new Map<string, PropHit>();
  const playerHistory: Record<string, PlayerHistorySlice> = {};
  const propScored: BoardScoredLeg[] = [];
  const seenFp = new Set<string>();
  let propSimEvaluated = 0;

  for (let i = 0; i < candidates.length; i += FOOTBALL_PROPS_ONLY_BATCH) {
    if (opts.signal?.aborted) break;
    const batch = candidates.slice(i, i + FOOTBALL_PROPS_ONLY_BATCH);
    propSimEvaluated += batch.length;

    // Local-first: enrich with empty server hits so history grades run immediately.
    let hits = new Map<string, PropHit>();
    try {
      const local = await enrichCoachPropSimHits(batch, opts.pool, hits, opts.signal);
      hits = local.hits;
      Object.assign(playerHistory, local.playerHistory);
    } catch {
      /* keep empty — try server below */
    }

    // Optional server boost (short race) — never wipe local hits on timeout.
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
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      if (serverRows) {
        for (const [k, v] of serverRows) {
          if (v.hitProbability != null && Number.isFinite(v.hitProbability)) {
            hits.set(k, {
              hitProbability: v.hitProbability,
              nullReason: v.nullReason ?? null,
            });
          } else if (!hits.has(k)) {
            hits.set(k, {
              hitProbability: null,
              nullReason: v.nullReason ?? null,
            });
          }
        }
        // Re-enrich only rows still null after server.
        const stillNull = batch.filter((p) => {
          const key = propSimLookupKey(p, poolRowForPick(p, opts.pool));
          const h = key ? hits.get(key)?.hitProbability : null;
          return h == null || !Number.isFinite(h);
        });
        if (stillNull.length) {
          const again = await enrichCoachPropSimHits(
            stillNull,
            opts.pool,
            aliasHits(stillNull, hits),
            opts.signal,
          );
          for (const [k, v] of again.hits) hits.set(k, v);
          Object.assign(playerHistory, again.playerHistory);
        }
      }
    } catch {
      /* local hits already applied */
    }

    applySoftClips(batch, opts.pool, hits);
    for (const [k, v] of hits) propHits.set(k, v);

    const pending = batch.filter((p) => {
      const key = propSimLookupKey(p, poolRowForPick(p, opts.pool));
      const raw = key ? (propHits.get(key)?.hitProbability ?? null) : null;
      const clipped = clipPropSimHitForGrade(p, raw);
      return pickHasSimGrade(p, clipped) && !seenFp.has(pickLegFingerprint(p));
    });

    if (pending.length) {
      const scoredPicks = attachPickScores(pending, {
        realOdds: opts.realOdds,
        propPool: opts.pool,
        playerHistory,
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
    }

    if (propScored.length > 0) {
      const collapsed = collapseScoredLegsByMarketLadder(propScored);
      const { picks: partial } = buildStagedTicketFromScan(collapsed, opts.target);
      if (partial.length) opts.onPartialPicks?.(partial);
      opts.onStatus?.(
        `Scoring props… ${partial.length} of ${opts.target} cleared (${propScored.length} graded)`,
      );
      if (partial.length >= opts.target) break;
    } else {
      opts.onStatus?.(
        `Grading skill props… ${Math.min(i + batch.length, candidates.length)}/${candidates.length}`,
      );
    }
  }

  const collapsed = collapseScoredLegsByMarketLadder(propScored);
  collapsed.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  const { picks } = buildStagedTicketFromScan(collapsed, opts.target);
  const propLegsScored = propScored.length;

  // User-facing notes only — no raw PROP_ALL_NO_SIM_GRADE debug dumps.
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
