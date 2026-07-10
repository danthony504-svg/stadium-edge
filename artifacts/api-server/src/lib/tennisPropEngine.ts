// Tennis prop engine — analyze every posted prop, 10k sim each, grade, rank,
// return only recommendations that pass the quality gate (skip weak picks).

import { DEFAULT_SIMULATIONS } from "./monteCarlo.js";
import { gradeTennisProp } from "./tennisPropGrade.js";
import { buildTennisPropLearningMap, type TennisPropLearningRow } from "./tennisPropLearning.js";
import { runTennisPropMonteCarlo } from "./tennisPropMonteCarlo.js";
import type {
  TennisPropEngineResult,
  TennisPropLine,
  TennisPropRecommendation,
} from "./tennisPropTypes.js";
import {
  createTennisPropVendor,
  createTennisStatsVendor,
  tennisPropsFeatureEnabled,
  type TennisPropVendor,
  type TennisStatsVendor,
} from "./tennisPropVendor.js";

export type AnalyzeTennisMatchPropsInput = {
  away: string;
  home: string;
  eventId?: string;
  simulations?: number;
  learningHistory?: TennisPropLearningRow[];
  maxRecommendations?: number;
  propVendor?: TennisPropVendor;
  statsVendor?: TennisStatsVendor;
};

function rankScore(rec: TennisPropRecommendation): number {
  const g = rec.grade;
  const ev = g.evPct ?? 0;
  const conf = g.confidencePct ?? 50;
  const sim = g.simHit ?? 0.5;
  const adj = rec.adjustedComposite ?? g.composite ?? 0;
  return adj * 10 + ev * 0.5 + conf * 0.05 + sim * 20;
}

/** Deduplicate alt rungs — keep best EV per (player, market, side). */
function dedupeLines(lines: TennisPropLine[]): TennisPropLine[] {
  const best = new Map<string, TennisPropLine>();
  for (const l of lines) {
    const k = `${l.player}|${l.market}|${l.side}|${l.line ?? "_"}`;
    const prev = best.get(k);
    if (!prev || l.odds > prev.odds) best.set(k, l);
  }
  return [...best.values()];
}

export async function analyzeTennisMatchProps(
  input: AnalyzeTennisMatchPropsInput,
): Promise<TennisPropEngineResult> {
  const matchLabel = `${input.away} @ ${input.home}`;
  const enabled = tennisPropsFeatureEnabled();

  if (!enabled) {
    return {
      matchLabel,
      analyzed: 0,
      recommended: [],
      skipped: [],
      vendorStatus: {
        propsAvailable: false,
        statsComplete: false,
        message:
          "Tennis props require TENNIS_PROPS_ENABLED=1 and a configured prop odds vendor.",
      },
    };
  }

  const statsVendor = input.statsVendor ?? createTennisStatsVendor();
  const propVendor =
    input.propVendor ??
    createTennisPropVendor(async () => input.eventId ?? null);

  const ctx = await statsVendor.enrichMatchContext(input.away, input.home);
  if (!ctx) {
    return {
      matchLabel,
      analyzed: 0,
      recommended: [],
      skipped: [],
      vendorStatus: {
        propsAvailable: false,
        statsComplete: false,
        message: "Could not resolve match stats context.",
      },
    };
  }

  const rawLines = await propVendor.fetchPropLines({
    away: input.away,
    home: input.home,
    eventId: input.eventId,
  });
  const lines = dedupeLines(rawLines);
  const learning = buildTennisPropLearningMap(input.learningHistory ?? []);
  const sims = input.simulations ?? DEFAULT_SIMULATIONS;
  const maxRec = input.maxRecommendations ?? 8;

  const recommended: TennisPropRecommendation[] = [];
  const skipped: TennisPropEngineResult["skipped"] = [];

  for (const line of lines) {
    const sim = await runTennisPropMonteCarlo(line, ctx, sims);
    const grade = gradeTennisProp({
      line,
      sim,
      fairProb: sim.hitProbability,
      learningWeight: learning[line.market.toLowerCase()] ?? 1,
    });

    const rec: TennisPropRecommendation = {
      line,
      sim,
      grade,
      adjustedComposite: grade.composite,
      rankScore: null,
    };
    rec.rankScore = rankScore(rec);

    if (grade.recommends) recommended.push(rec);
    else skipped.push({ line, grade });
  }

  recommended.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));

  const statsComplete =
    ctx.away.servePct != null ||
    ctx.home.servePct != null ||
    (ctx.away.recentFormWins + ctx.away.recentFormLosses >= 3 &&
      ctx.home.recentFormWins + ctx.home.recentFormLosses >= 3);

  return {
    matchLabel,
    analyzed: lines.length,
    recommended: recommended.slice(0, maxRec),
    skipped,
    vendorStatus: {
      propsAvailable: lines.length > 0,
      statsComplete,
      message:
        lines.length === 0
          ? "No tennis player props posted for this match on the configured vendor."
          : recommended.length === 0
            ? `Analyzed ${lines.length} props; none passed B+ / positive-edge / sim gate.`
            : null,
    },
  };
}
