import { createDefaultSportRegistry } from "@workspace/coach-data/sports";
import { CoachSnapshotCache } from "@workspace/coach-cache";
import { CoachSimService } from "@workspace/coach-sim";
import { InMemorySimCacheStore } from "@workspace/coach-sim-cache";
import { passthroughGateContextResolver } from "@workspace/coach-scan";
import {
  CoachRuntime,
  type CoachSlateLoader,
} from "@workspace/coach-runtime";
import { PostgresCoachSnapshotStore } from "@workspace/coach-runtime/postgres";
import { InMemoryScanStatusStore } from "@workspace/coach-background";
import type { CoachSportContext } from "@workspace/coach-types";

import { coachSlateApiBase, slateLoopbackPost } from "./coachSlateLoopback.js";
import { loadCoachV2RawSlate } from "./coachV2SlateLoader.js";

let runtimeSingleton: CoachRuntime | null = null;

const defaultSportContext: CoachSportContext = {
  sport: "mlb",
  injuries: {},
  matchupHistory: {},
  playerHistory: {},
  lineMovement: {},
  trends: {},
};

function createSimService(): CoachSimService {
  return new CoachSimService({
    store: new InMemorySimCacheStore(),
    executePropSim: async ({ sport, props, tier, simulations }) => {
      const result = await slateLoopbackPost<{
        props: Array<{
          simulations: number;
          hitProbability: number | null;
          confidenceScore?: number | null;
        }>;
      }>(
        "/sports/simulate/props",
        { sport, props, tier, simulations },
        180_000,
      );
      if (!result?.props?.length) {
        throw new Error("simulate/props returned no rows");
      }
      return { props: result.props };
    },
  });
}

export function isCoachV2Enabled(): boolean {
  return process.env.COACH_V2_ENABLED === "1" || process.env.COACH_V2_ENABLED === "true";
}

export function getCoachV2Runtime(slateLoader: CoachSlateLoader = { load: loadCoachV2RawSlate }): CoachRuntime {
  if (!runtimeSingleton) {
    runtimeSingleton = new CoachRuntime({
      snapshotCache: new CoachSnapshotCache(new PostgresCoachSnapshotStore()),
      statusStore: new InMemoryScanStatusStore(),
      slateLoader,
      registry: createDefaultSportRegistry(),
      sim: createSimService(),
      sportContext: defaultSportContext,
      resolveGateContext: passthroughGateContextResolver,
      sports: ["mlb"],
    });
  }
  return runtimeSingleton;
}

export function coachV2ApiBase(): string {
  return coachSlateApiBase();
}

/** Test-only reset for singleton. */
export function resetCoachV2RuntimeForTests(): void {
  runtimeSingleton = null;
}
