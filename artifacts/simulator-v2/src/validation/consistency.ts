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

function checkPeriodGroupSums(
  tensor: SimV2ScenarioTensor,
  group: string[],
  issues: ConsistencyIssue[],
): void {
  const n = tensor.meta.nDraws;
  if (group.length === 0) return;
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
          detail: `home periods [${group.join("+")}] sum ${hSum} != FG ${tensor.team.homeFg[i]}`,
          drawIndex: i,
        });
        break;
      }
      if (Math.abs(aSum - tensor.team.awayFg[i]) > EPS) {
        issues.push({
          code: "period_sum_ne_fg",
          detail: `away periods [${group.join("+")}] sum ${aSum} != FG ${tensor.team.awayFg[i]}`,
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

/**
 * Hard joint-outcome invariants. Fail closed — do not settle from a broken tensor.
 */
export function validateScenarioConsistency(
  tensor: SimV2ScenarioTensor,
  opts?: { periodSumGroup?: string[]; checkDerivedHalves?: boolean },
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

  checkPeriodGroupSums(tensor, opts?.periodSumGroup ?? [], issues);

  // Football: also require H1+H2 = FG when halves are present.
  if (
    tensor.team.homeByPeriod.h1 &&
    tensor.team.homeByPeriod.h2 &&
    tensor.team.awayByPeriod.h1 &&
    tensor.team.awayByPeriod.h2
  ) {
    checkPeriodGroupSums(tensor, ["h1", "h2"], issues);
  }

  if (opts?.checkDerivedHalves) {
    const hq1 = tensor.team.homeByPeriod.q1;
    const hq2 = tensor.team.homeByPeriod.q2;
    const hq3 = tensor.team.homeByPeriod.q3;
    const hq4 = tensor.team.homeByPeriod.q4;
    const hh1 = tensor.team.homeByPeriod.h1;
    const hh2 = tensor.team.homeByPeriod.h2;
    const aq1 = tensor.team.awayByPeriod.q1;
    const aq2 = tensor.team.awayByPeriod.q2;
    const aq3 = tensor.team.awayByPeriod.q3;
    const aq4 = tensor.team.awayByPeriod.q4;
    const ah1 = tensor.team.awayByPeriod.h1;
    const ah2 = tensor.team.awayByPeriod.h2;
    if (hq1 && hq2 && hq3 && hq4 && hh1 && hh2 && aq1 && aq2 && aq3 && aq4 && ah1 && ah2) {
      for (let i = 0; i < n; i++) {
        if (
          Math.abs(hq1[i] + hq2[i] - hh1[i]) > EPS ||
          Math.abs(hq3[i] + hq4[i] - hh2[i]) > EPS ||
          Math.abs(aq1[i] + aq2[i] - ah1[i]) > EPS ||
          Math.abs(aq3[i] + aq4[i] - ah2[i]) > EPS
        ) {
          issues.push({
            code: "half_ne_quarter_sum",
            detail: `draw ${i}: H1/H2 must equal Q1+Q2 / Q3+Q4`,
            drawIndex: i,
          });
          break;
        }
      }
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
