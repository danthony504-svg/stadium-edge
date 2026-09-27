import type {
  CoachQualifiedLeg,
  CoachQualifiedLegPool,
  CoachScanManifest,
  CoachScanPhase,
  CoachSportGradeHook,
  CoachSportIdOrCustom,
  CoachSportRegistry,
} from "@workspace/coach-types";

import type { CoachNormalizedSlate } from "@workspace/coach-data";
import { evaluateCoachGates, summarizeRejectionBreakdown } from "@workspace/coach-gates";
import type { CoachGateContextResolver } from "./context";
import { passthroughGateContextResolver } from "./context";
import { computeCoachGrade } from "@workspace/coach-grade";
import type { CoachSimService } from "@workspace/coach-sim";
import type { CoachSportContext } from "@workspace/coach-types";

import { enumerateAllCandidates, sportsInSlate } from "./enumerate";
import { createScanManifestBase } from "./manifest";

export type CoachScanProgress = {
  phase: CoachScanPhase;
  candidatesEvaluated: number;
  candidatesTotal: number;
};

export type CoachScanOptions = {
  slate: CoachNormalizedSlate;
  registry: CoachSportRegistry;
  sim: CoachSimService;
  sportContext: CoachSportContext | ((sport: CoachSportIdOrCustom) => CoachSportContext);
  resolveGateContext?: CoachGateContextResolver;
  sports?: CoachSportIdOrCustom[];
  gradeHook?: CoachSportGradeHook;
  nowMs?: number;
  onProgress?: (progress: CoachScanProgress) => void;
};

function resolveSportContext(
  sport: CoachSportIdOrCustom,
  source: CoachScanOptions["sportContext"],
): CoachSportContext {
  return typeof source === "function" ? source(sport) : source;
}

/**
 * Full coach scan — enumerates every candidate, deep-sims each, runs fail-closed
 * gates, and grades survivors. Never stops early when more candidates remain.
 */
export async function runCoachScan(opts: CoachScanOptions): Promise<CoachQualifiedLegPool> {
  const startedAt = new Date(opts.nowMs ?? Date.now()).toISOString();
  const resolveGateContext = opts.resolveGateContext ?? passthroughGateContextResolver;
  const sports = opts.sports?.map((s) => String(s).toLowerCase()) ?? sportsInSlate(opts.slate);

  const candidates = enumerateAllCandidates(opts.registry, opts.slate, sports);
  const manifest: CoachScanManifest = {
    ...createScanManifestBase(opts.slate, sports, startedAt),
    phase: "simulating",
  };

  const gateEvaluations: ReturnType<typeof evaluateCoachGates>[] = [];
  const qualifiedProps: CoachQualifiedLeg[] = [];
  const qualifiedGameLines: CoachQualifiedLeg[] = [];
  let deepSimsAttempted = 0;
  let deepSimsComplete = 0;

  opts.onProgress?.({
    phase: "simulating",
    candidatesEvaluated: 0,
    candidatesTotal: candidates.length,
  });

  for (const candidate of candidates) {
    manifest.candidatesEvaluated += 1;
    manifest.phase = "simulating";

    const adapter = opts.registry.get(candidate.sport);
    if (!adapter) {
      manifest.gatesRejected += 1;
      continue;
    }

    const simResult = await opts.sim.simulateCandidateDeep(
      candidate,
      opts.slate.contextFingerprint,
    );

    if (simResult.cacheHit) manifest.simCacheHits += 1;
    else manifest.simCacheMisses += 1;

    if (candidate.kind === "player_prop") {
      deepSimsAttempted += 1;
      if (simResult.deepSimComplete) deepSimsComplete += 1;
    }

    manifest.phase = "gating";
    const sportContext = resolveSportContext(candidate.sport, opts.sportContext);
    const gateContext = resolveGateContext(candidate, sportContext);
    const gateEvaluation = evaluateCoachGates({
      candidate,
      sim: simResult.sim,
      context: gateContext,
      adapter,
      sportContext,
    });
    gateEvaluations.push(gateEvaluation);

    if (!gateEvaluation.allPassed) {
      manifest.gatesRejected += 1;
      opts.onProgress?.({
        phase: "gating",
        candidatesEvaluated: manifest.candidatesEvaluated,
        candidatesTotal: candidates.length,
      });
      continue;
    }

    if (!simResult.sim) {
      manifest.gatesRejected += 1;
      continue;
    }

    manifest.phase = "ranking";
    const grade = computeCoachGrade({
      candidate,
      sim: simResult.sim,
      context: gateContext,
      gradeHook: opts.gradeHook,
      sportContext,
    });

    const qualified: CoachQualifiedLeg = {
      ...candidate,
      simHitPct: Math.round(simResult.sim.hitProbability * 1000) / 10,
      evPct: simResult.sim.evPct,
      edgePct: simResult.sim.edgePct,
      confidencePct: grade.confidencePct,
      compositeScore: grade.compositeScore,
      grade: grade.grade,
      gateEvaluation,
    };

    manifest.gatesPassed += 1;
    if (candidate.kind === "player_prop") qualifiedProps.push(qualified);
    else qualifiedGameLines.push(qualified);

    opts.onProgress?.({
      phase: "ranking",
      candidatesEvaluated: manifest.candidatesEvaluated,
      candidatesTotal: candidates.length,
    });
  }

  manifest.rejectionBreakdown = summarizeRejectionBreakdown(gateEvaluations);
  manifest.deepSimComplete =
    deepSimsAttempted === 0 || deepSimsComplete === deepSimsAttempted;
  manifest.scanCompletedAt = new Date(opts.nowMs ?? Date.now()).toISOString();
  manifest.phase = "complete";
  manifest.scanComplete = true;

  const inventory = createScanManifestBase(opts.slate, sports, startedAt);
  manifest.marketsSeen = inventory.marketsSeen;
  manifest.propsSeen = inventory.propsSeen;
  manifest.gameLinesSeen = inventory.gameLinesSeen;
  manifest.altLinesSeen = inventory.altLinesSeen;

  return {
    manifest,
    props: qualifiedProps,
    gameLines: qualifiedGameLines,
  };
}
