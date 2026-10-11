import { OPP_SHIFT_CAPS } from "./types.js";
import type { ChannelContribution } from "./types.js";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Channel groups that share overlapping workload — cannot fully stack.
 * Within a group, contributions are combined with diminishing returns.
 */
const OVERLAP_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["carries", "rz_carries", "gl_carries", "designed_runs"]),
  new Set(["targets", "routes"]),
  new Set(["minutes", "usage", "touch_share", "fga"]),
  new Set(["pa", "rbi_opps", "run_opps"]),
  new Set(["toi", "pp_toi", "line_role", "shot_share", "point_opps"]),
  new Set(["shot_opps", "sot_opps", "set_piece_share"]),
  new Set(["pass_attempts", "scramble_rate"]),
];

function overlapGroupId(channel: string): string {
  for (let i = 0; i < OVERLAP_GROUPS.length; i++) {
    if (OVERLAP_GROUPS[i]!.has(channel)) return `g${i}`;
  }
  return `solo:${channel}`;
}

/**
 * Bounded aggregation of channel contributions for one family.
 * Returns the combined channelShift used in:
 *   adjustedMean = baseline × (1 + channelShift × elasticity × confidenceWeight)
 * Here we fold elasticity/confidence per contribution, then aggregate deltas.
 */
export function aggregateFamilyMultiplier(
  contributions: readonly ChannelContribution[],
  opts?: {
    lowConfidence?: boolean;
    teamScalar?: boolean;
    vacancyCount?: number;
  },
): { multiplier: number; volumeDelta: number; elasticity: number; confidenceWeight: number } {
  if (!contributions.length) {
    return { multiplier: 1, volumeDelta: 0, elasticity: 0, confidenceWeight: 0 };
  }

  // Per-contribution effective mean delta (already × elasticity × confidence × pricedIn).
  const byGroup = new Map<string, number[]>();
  let volSum = 0;
  let elSum = 0;
  let confSum = 0;
  let wSum = 0;

  for (const c of contributions) {
    if (c.kind === "X") continue;
    const priced = clamp(1 - (c.pricedInFactor ?? 0), 0, 1);
    const eff =
      c.volumeDelta * c.elasticity * c.confidenceWeight * priced;
    const gid = overlapGroupId(c.channel);
    const arr = byGroup.get(gid) ?? [];
    arr.push(eff);
    byGroup.set(gid, arr);
    const w = Math.abs(c.volumeDelta) + 1e-9;
    volSum += c.volumeDelta;
    elSum += c.elasticity * w;
    confSum += c.confidenceWeight * w;
    wSum += w;
  }

  // Within each overlap group: sort by |delta| desc, apply diminishing weights 1, 0.45, 0.2…
  let combinedDelta = 0;
  for (const deltas of byGroup.values()) {
    deltas.sort((a, b) => Math.abs(b) - Math.abs(a));
    let group = 0;
    for (let i = 0; i < deltas.length; i++) {
      const damp = i === 0 ? 1 : i === 1 ? 0.45 : Math.max(0.12, 0.2 / i);
      group += deltas[i]! * damp;
    }
    combinedDelta += group;
  }

  let vacancyDamp = 1;
  if ((opts?.vacancyCount ?? 0) >= 2) {
    vacancyDamp = OPP_SHIFT_CAPS.multiVacancyDamp;
  }
  combinedDelta *= vacancyDamp;

  let multiplier = 1 + combinedDelta;

  if (opts?.lowConfidence) {
    const lo = 1 - OPP_SHIFT_CAPS.lowConfidenceMaxDelta;
    const hi = 1 + OPP_SHIFT_CAPS.lowConfidenceMaxDelta;
    multiplier = clamp(multiplier, lo, hi);
  } else if (opts?.teamScalar) {
    const lo = 1 - OPP_SHIFT_CAPS.teamScalarMaxDelta;
    const hi = 1 + OPP_SHIFT_CAPS.teamScalarMaxDelta;
    multiplier = clamp(multiplier, lo, hi);
  } else {
    multiplier = clamp(multiplier, OPP_SHIFT_CAPS.floor, OPP_SHIFT_CAPS.normalMax);
  }
  multiplier = clamp(multiplier, OPP_SHIFT_CAPS.floor, OPP_SHIFT_CAPS.absoluteMax);

  return {
    multiplier,
    volumeDelta: volSum,
    elasticity: wSum > 0 ? elSum / wSum : 0,
    confidenceWeight: wSum > 0 ? confSum / wSum : 0,
  };
}
