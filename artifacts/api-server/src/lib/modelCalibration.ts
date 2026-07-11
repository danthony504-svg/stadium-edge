// Model calibration fetch layer — loads graded ledger and caches results.

import { getGradedHistory } from "./liveSteals.js";
import { cachedJson } from "./sports.js";
import {
  computeCalibrationFromGraded,
  type CalibrationBucket,
  calibrationDeltaForPick,
} from "./modelCalibrationCore.js";

export type { CalibrationBucket };
export { computeCalibrationFromGraded, calibrationDeltaForPick };

export async function fetchModelCalibration(): Promise<{
  updatedAt: string;
  buckets: CalibrationBucket[];
}> {
  return cachedJson("model-calibration:v1", 30 * 60 * 1000, async () => {
    const rows = await getGradedHistory(500);
    return {
      updatedAt: new Date().toISOString(),
      buckets: computeCalibrationFromGraded(
        rows.map((r) => ({
          sport: r.sport,
          market: r.market,
          player: r.player,
          status: r.status,
        })),
      ),
    };
  });
}
