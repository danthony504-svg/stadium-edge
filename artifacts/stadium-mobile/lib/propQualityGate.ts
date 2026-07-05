// Multi-signal quality gate for player props on Coach-built parlays. A prop must
// have a successful Monte Carlo run and pass enough of the rubric checks (grade,
// confidence, edge, matchup, form) — never dropped on hit rate alone.

import type { ParsedPick } from "../components/PickCard";
import type { PropPoolEntry } from "./api";
import { fetchPropSimulations } from "./api";
import type { CombinedPickScore } from "./pickScore";
import { attachPickScores, type PropSimAttachOpts } from "./pickScoreContext";
import { propSimKey, rankPropPoolEntries } from "./propSelection";

/** B+ on the 1–10 composite scale. */
export const PROP_QUALITY_MIN_GRADE = 7.5;
export const PROP_QUALITY_MIN_CONFIDENCE = 55;
export const PROP_QUALITY_MIN_SUBSCORE = 6.0;
/** Among grade/confidence/edge/matchup/form, at most this many may fail. */
export const PROP_QUALITY_MAX_SOFT_FAILURES = 2;

export type PropQualityChecks = {
  simulation: boolean;
  gradeBPlus: boolean;
  minConfidence: boolean;
  positiveEdge: boolean;
  goodMatchup: boolean;
  recentForm: boolean;
};

export type PropQualityEvaluation = PropQualityChecks & {
  passes: boolean;
  failureCount: number;
  softFailureCount: number;
};

export function simKeyForPick(pick: ParsedPick): string | null {
  const market = pick.propMarketKey ?? pick.market;
  if (!pick.player || pick.propLine == null || !pick.propSide) return null;
  return propSimKey(pick.player, market, pick.propLine, pick.propSide);
}

export function simHitForPick(
  pick: ParsedPick,
  sims: Map<string, { hitProbability: number | null }>,
): number | null {
  const key = simKeyForPick(pick);
  if (!key) return null;
  const hit = sims.get(key)?.hitProbability;
  return hit != null && Number.isFinite(hit) ? hit : null;
}

export function evaluatePropQuality(
  scores: CombinedPickScore | null | undefined,
  simHit: number | null | undefined,
): PropQualityEvaluation {
  const checks: PropQualityChecks = {
    simulation: simHit != null && Number.isFinite(simHit),
    gradeBPlus: scores?.composite != null && scores.composite >= PROP_QUALITY_MIN_GRADE,
    minConfidence:
      scores?.confidencePct != null && scores.confidencePct >= PROP_QUALITY_MIN_CONFIDENCE,
    positiveEdge: scores?.edgePct != null && scores.edgePct > 0,
    goodMatchup:
      scores?.scores.matchup != null && scores.scores.matchup >= PROP_QUALITY_MIN_SUBSCORE,
    recentForm: scores?.scores.trend != null && scores.scores.trend >= PROP_QUALITY_MIN_SUBSCORE,
  };
  const softChecks = [
    checks.gradeBPlus,
    checks.minConfidence,
    checks.positiveEdge,
    checks.goodMatchup,
    checks.recentForm,
  ];
  const softFailureCount = softChecks.filter((c) => !c).length;
  const failureCount = (checks.simulation ? 0 : 1) + softFailureCount;
  const passes = checks.simulation && softFailureCount <= PROP_QUALITY_MAX_SOFT_FAILURES;
  return { ...checks, passes, failureCount, softFailureCount };
}

function poolEntryToPick(e: PropPoolEntry): ParsedPick {
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

function pickLegKey(p: ParsedPick): string {
  return `${p.game}|${p.player}|${p.market}|${p.propLine}|${p.propSide}`.toLowerCase();
}

/** Fetch quick then deep sim for any prop picks still missing hitProbability. */
export async function ensurePropSimulations(
  picks: ParsedPick[],
  propPool: PropPoolEntry[],
  existing: Map<string, { hitProbability: number | null }>,
  signal?: AbortSignal,
): Promise<Map<string, { hitProbability: number | null }>> {
  const merged = new Map(existing);
  const needsSim = (p: ParsedPick) => {
    if (!p.isProp) return false;
    const key = simKeyForPick(p);
    if (!key) return true;
    const hit = merged.get(key)?.hitProbability;
    return hit == null || !Number.isFinite(hit);
  };
  let pending = picks.filter(needsSim);
  if (!pending.length) return merged;

  for (const tier of ["quick", "deep"] as const) {
    if (!pending.length) break;
    try {
      const batch = await fetchPropSimulations(pending, propPool, { tier }, signal);
      for (const [, v] of batch) {
        if (v.hitProbability != null && Number.isFinite(v.hitProbability)) {
          merged.set(v.key, { hitProbability: v.hitProbability });
        }
      }
    } catch {
      /* best-effort — try deep after quick */
    }
    pending = picks.filter(needsSim);
  }
  return merged;
}

export type ApplyCoachParlayPropQualityOpts = {
  propPool: PropPoolEntry[];
  propSimulations: Map<string, { hitProbability: number | null }>;
  scoreOpts: PropSimAttachOpts;
  signal?: AbortSignal;
};

export type ApplyCoachParlayPropQualityResult = {
  picks: ParsedPick[];
  propSimulations: Map<string, { hitProbability: number | null }>;
  note: string;
  droppedPropCount: number;
  replacedPropCount: number;
};

/**
 * Filter coach parlay props through the multi-signal gate; rerun sim when missing;
 * swap dropped legs for higher-quality pool candidates with complete sim data.
 * Game-level legs pass through unchanged. Never pads count with filler.
 */
export async function applyCoachParlayPropQuality(
  picks: ParsedPick[],
  opts: ApplyCoachParlayPropQualityOpts,
): Promise<ApplyCoachParlayPropQualityResult> {
  const gameLegs = picks.filter((p) => !p.isProp);
  let propLegs = picks.filter((p) => p.isProp);
  if (!propLegs.length) {
    return {
      picks,
      propSimulations: opts.propSimulations,
      note: "",
      droppedPropCount: 0,
      replacedPropCount: 0,
    };
  }

  let sims = await ensurePropSimulations(
    propLegs,
    opts.propPool,
    opts.propSimulations,
    opts.signal,
  );

  const scoreOpts = { ...opts.scoreOpts, propPool: opts.propPool, propSimulations: sims };

  const scoreAndEval = (p: ParsedPick) => {
    const [scored] = attachPickScores([p], scoreOpts);
    const hit = simHitForPick(scored, sims);
    const evaluation = evaluatePropQuality(scored.scores ?? null, hit);
    return { scored, evaluation };
  };

  const kept: ParsedPick[] = [];
  const dropped: ParsedPick[] = [];
  for (const p of propLegs) {
    const { scored, evaluation } = scoreAndEval(p);
    if (evaluation.passes) kept.push(scored);
    else dropped.push(scored);
  }

  const usedPlayers = new Set(kept.map((p) => (p.player ?? "").toLowerCase()).filter(Boolean));
  const usedLegs = new Set(kept.map(pickLegKey));
  let replacedPropCount = 0;

  if (dropped.length > 0) {
    const ranked = rankPropPoolEntries(opts.propPool, {
      ...scoreOpts,
      propSimulations: sims,
    });
    for (let i = 0; i < dropped.length; i++) {
      for (const entry of ranked) {
        const playerKey = entry.player.toLowerCase();
        if (usedPlayers.has(playerKey)) continue;
        const candidate = poolEntryToPick(entry);
        const legKey = pickLegKey(candidate);
        if (usedLegs.has(legKey)) continue;

        const candidateSims = await ensurePropSimulations(
          [candidate],
          opts.propPool,
          sims,
          opts.signal,
        );
        sims = candidateSims;
        const candidateScoreOpts = { ...scoreOpts, propSimulations: sims };
        const [scored] = attachPickScores([candidate], candidateScoreOpts);
        const hit = simHitForPick(scored, sims);
        const evaluation = evaluatePropQuality(scored.scores ?? null, hit);
        if (!evaluation.passes) continue;

        kept.push(scored);
        usedPlayers.add(playerKey);
        usedLegs.add(legKey);
        replacedPropCount += 1;
        break;
      }
    }
  }

  propLegs = kept;
  const droppedPropCount = dropped.length - replacedPropCount;
  let note = "";
  if (droppedPropCount > 0 || replacedPropCount > 0) {
    const parts: string[] = [];
    if (droppedPropCount > 0) {
      parts.push(
        `dropped ${droppedPropCount} player-prop leg${droppedPropCount === 1 ? "" : "s"} that didn't clear simulation + grade/edge/matchup/form checks`,
      );
    }
    if (replacedPropCount > 0) {
      parts.push(
        `swapped in ${replacedPropCount} stronger prop${replacedPropCount === 1 ? "" : "s"} with complete sim data`,
      );
    }
    note = `_Quality filter: ${parts.join("; ")}. I won't pad the ticket with low-quality filler._`;
  }

  return {
    picks: [...gameLegs, ...propLegs],
    propSimulations: sims,
    note,
    droppedPropCount,
    replacedPropCount,
  };
}
