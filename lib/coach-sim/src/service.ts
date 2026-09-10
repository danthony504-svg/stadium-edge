import type { CoachCandidateLeg, CoachSimResult, CoachSimTier } from "@workspace/coach-types";
import { CoachSimCache, type SimCacheStore } from "@workspace/coach-sim-cache";

import {
  buildPropSimRequest,
  isDeepSimComplete,
  normalizePropSimRow,
  type PropSimApiResponse,
} from "./normalize";

export type PropSimExecutor = (request: {
  sport: string;
  props: NonNullable<ReturnType<typeof buildPropSimRequest>>[];
  tier: CoachSimTier;
  simulations: number;
}) => Promise<PropSimApiResponse>;

export type CoachSimServiceOptions = {
  store: SimCacheStore;
  executePropSim: PropSimExecutor;
};

export type SimCandidateResult = {
  candidate: CoachCandidateLeg;
  sim: CoachSimResult | null;
  cacheHit: boolean;
  deepSimComplete: boolean;
};

/**
 * Server-side sim orchestrator — wraps the existing Monte Carlo API via an
 * injected executor and caches by odds-sensitive legFingerprint.
 */
export class CoachSimService {
  private readonly cache: CoachSimCache;
  private readonly opts: CoachSimServiceOptions;

  constructor(opts: CoachSimServiceOptions) {
    this.opts = opts;
    this.cache = new CoachSimCache(opts.store);
  }

  stats() {
    return this.cache.stats();
  }

  async simulateCandidate(
    candidate: CoachCandidateLeg,
    tier: CoachSimTier,
    contextFingerprint: string,
  ): Promise<SimCandidateResult> {
    const propReq = buildPropSimRequest(candidate);
    if (!propReq) {
      return {
        candidate,
        sim: null,
        cacheHit: false,
        deepSimComplete: false,
      };
    }

    const lookup = await this.cache.getOrSimulate({
      legFingerprint: candidate.legFingerprint,
      contextFingerprint,
      simulate: async () => {
        const api = await this.opts.executePropSim({
          sport: propReq.sport,
          props: [propReq],
          tier,
          simulations: tier === "deep" ? 10_000 : 1_000,
        });
        const row = api.props[0];
        if (!row) throw new Error("simulate/props returned no rows");
        const normalized = normalizePropSimRow(
          candidate.legFingerprint,
          tier,
          row,
          candidate.odds,
        );
        if (!normalized) throw new Error("simulate/props returned null hitProbability");
        return normalized;
      },
    });

    return {
      candidate,
      sim: lookup.result,
      cacheHit: lookup.cacheHit,
      deepSimComplete: isDeepSimComplete(lookup.result),
    };
  }

  /** Run deep tier sim — used before gate qualification. */
  async simulateCandidateDeep(
    candidate: CoachCandidateLeg,
    contextFingerprint: string,
  ): Promise<SimCandidateResult> {
    return this.simulateCandidate(candidate, "deep", contextFingerprint);
  }
}
