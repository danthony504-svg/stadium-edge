import type { SimV2ScenarioTensor } from "../schemas/scenarioTensor.js";

export type ConsistencyIssue = {
  code: string;
  detail: string;
  drawIndex?: number;
};

export type ConsistencyReport = {
  ok: boolean;
  issues: ConsistencyIssue[];
};

const EPS = 1e-6;

function lenOk(arr: Float64Array | Uint8Array | undefined, n: number): boolean {
  return !!arr && arr.length === n;
}

/**
 * Hard joint-outcome invariants. Fail closed — do not settle from a broken tensor.
 */
export function validateScenarioConsistency(
  tensor: SimV2ScenarioTensor,
  opts?: { periodSumGroup?: string[] },
): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  const n = tensor.meta.nDraws;

  if (!lenOk(tensor.team.homeFg, n) || !lenOk(tensor.team.awayFg, n)) {
    issues.push({ code: "fg_length_mismatch", detail: `home/away FG length must equal nDraws=${n}` });
    return { ok: false, issues };
  }

  for (const [period, arr] of Object.entries(tensor.team.homeByPeriod)) {
    if (arr && !lenOk(arr, n)) {
      issues.push({ code: "period_length_mismatch", detail: `home period ${period} length` });
    }
  }
  for (const [period, arr] of Object.entries(tensor.team.awayByPeriod)) {
    if (arr && !lenOk(arr, n)) {
      issues.push({ code: "period_length_mismatch", detail: `away period ${period} length` });
    }
  }

  const group = opts?.periodSumGroup ?? [];
  if (group.length > 0) {
    const homeSlices = group.map((p) => tensor.team.homeByPeriod[p]);
    const awaySlices = group.map((p) => tensor.team.awayByPeriod[p]);
    if (homeSlices.every(Boolean) && awaySlices.every(Boolean)) {
      for (let i = 0; i < n; i++) {
        let hSum = 0;
        let aSum = 0;
        for (const s of homeSlices) hSum += s![i];
        for (const s of awaySlices) aSum += s![i];
        if (Math.abs(hSum - tensor.team.homeFg[i]) > EPS) {
          issues.push({
            code: "period_sum_ne_fg",
            detail: `home periods sum ${hSum} != FG ${tensor.team.homeFg[i]}`,
            drawIndex: i,
          });
          break;
        }
        if (Math.abs(aSum - tensor.team.awayFg[i]) > EPS) {
          issues.push({
            code: "period_sum_ne_fg",
            detail: `away periods sum ${aSum} != FG ${tensor.team.awayFg[i]}`,
            drawIndex: i,
          });
          break;
        }
      }
    } else if (group.some((p) => tensor.team.homeByPeriod[p] || tensor.team.awayByPeriod[p])) {
      issues.push({
        code: "period_group_incomplete",
        detail: `partial period group ${group.join(",")}`,
      });
    }
  }

  for (const [playerId, block] of Object.entries(tensor.players)) {
    if (!lenOk(block.participated, n)) {
      issues.push({ code: "player_participation_length", detail: playerId });
    }
    for (const [stat, arr] of Object.entries(block.stats)) {
      if (!lenOk(arr, n)) {
        issues.push({ code: "player_stat_length", detail: `${playerId}.${stat}` });
      }
    }
  }

  if (!Number.isFinite(n) || n <= 0) {
    issues.push({ code: "invalid_n_draws", detail: String(n) });
  }

  return { ok: issues.length === 0, issues };
}
