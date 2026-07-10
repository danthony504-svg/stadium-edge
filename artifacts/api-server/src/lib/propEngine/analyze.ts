// Cross-sport prop engine orchestrator — analyze every line, 10k sim, grade, rank.

import { DEFAULT_SIMULATIONS } from "../monteCarlo.js";
import { gradeProp, rankPropRecommendation } from "./grade.js";
import { buildPropLearningMap } from "./learning.js";
import { getSportAdapter } from "./registry.js";
import type { AnalyzePropsInput, PropEngineResult, PropLine, PropRecommendation } from "./types.js";

export function propEngineEnabled(): boolean {
  return process.env.PROP_ENGINE_ENABLED === "1" || process.env.TENNIS_PROPS_ENABLED === "1";
}

function dedupeLines(lines: PropLine[]): PropLine[] {
  const best = new Map<string, PropLine>();
  for (const l of lines) {
    const k = `${l.subject}|${l.market}|${l.side}|${l.line ?? "_"}|${l.alt ? "a" : "m"}`;
    const prev = best.get(k);
    if (!prev || l.odds > prev.odds) best.set(k, l);
  }
  return [...best.values()];
}

export async function analyzeEventProps(input: AnalyzePropsInput): Promise<PropEngineResult> {
  const sport = input.sport.toLowerCase();
  const matchLabel = `${input.away} @ ${input.home}`;

  if (!propEngineEnabled()) {
    return {
      sport,
      matchLabel,
      analyzed: 0,
      recommended: [],
      skipped: [],
      vendorStatus: {
        propsAvailable: false,
        statsComplete: false,
        message: "Prop engine requires PROP_ENGINE_ENABLED=1 and configured vendors.",
      },
    };
  }

  const adapter = getSportAdapter(sport);
  if (!adapter) {
    return {
      sport,
      matchLabel,
      analyzed: 0,
      recommended: [],
      skipped: [],
      vendorStatus: {
        propsAvailable: false,
        statsComplete: false,
        message: `No prop engine adapter registered for sport: ${sport}`,
      },
    };
  }

  const ctx = await adapter.buildContext(input);
  const rawLines = await adapter.fetchLines(input);
  const lines = dedupeLines(rawLines);
  const learning = buildPropLearningMap(sport, input.learningHistory ?? []);
  const sims = input.simulations ?? DEFAULT_SIMULATIONS;
  const maxRec = input.maxRecommendations ?? 12;

  const recommended: PropRecommendation[] = [];
  const skipped: PropEngineResult["skipped"] = [];

  for (const line of lines) {
    const sim = await adapter.simulate(line, ctx, sims);
    const grade = gradeProp({
      line,
      sim,
      fairProb: line.fairProb,
      learningWeight: learning[line.market.toLowerCase()] ?? 1,
    });

    const rec: PropRecommendation = {
      line,
      sim,
      grade,
      adjustedComposite: grade.composite,
      rankScore: null,
    };
    rec.rankScore = rankPropRecommendation(rec);

    if (grade.recommends) recommended.push(rec);
    else skipped.push({ line, grade });
  }

  recommended.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));

  return {
    sport,
    matchLabel,
    analyzed: lines.length,
    recommended: recommended.slice(0, maxRec),
    skipped,
    vendorStatus: {
      propsAvailable: lines.length > 0,
      statsComplete: adapter.statsComplete(ctx),
      message:
        lines.length === 0
          ? `No player props posted for this ${sport} event on configured vendors.`
          : recommended.length === 0
            ? `Analyzed ${lines.length} props; none passed B+ / positive-edge / sim gate.`
            : null,
    },
  };
}

/** @deprecated Use analyzeEventProps */
export const analyzeTennisMatchProps = (input: Omit<AnalyzePropsInput, "sport"> & { away: string; home: string }) =>
  analyzeEventProps({ ...input, sport: "tennis" });
