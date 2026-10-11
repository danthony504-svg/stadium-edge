import type { ChannelContribution, FamilyShiftRow, WorkloadChannel } from "./types.js";

const CHANNEL_LABEL: Partial<Record<WorkloadChannel, string>> = {
  carries: "rushing workload",
  rz_carries: "red-zone rushing workload",
  gl_carries: "goal-line rushing workload",
  designed_runs: "designed-run workload",
  scramble_rate: "scramble opportunity",
  targets: "target workload",
  routes: "route workload",
  pass_attempts: "pass-attempt volume",
  minutes: "minutes",
  usage: "usage",
  fga: "shot attempts",
  ast_opps: "assist opportunities",
  reb_opps: "rebound opportunities",
  pa: "plate-appearance opportunity",
  rbi_opps: "RBI opportunities",
  run_opps: "run opportunities",
  sb_opps: "stolen-base opportunities",
  bf: "batters-faced workload",
  ip: "innings workload",
  toi: "ice time",
  pp_toi: "power-play ice time",
  shot_share: "shot opportunity",
  point_opps: "point opportunity",
  shot_opps: "shot opportunities",
  sot_opps: "shots-on-target opportunities",
  set_piece_share: "set-piece share",
};

function dominantChannel(contributions: readonly ChannelContribution[]): WorkloadChannel | null {
  let best: ChannelContribution | null = null;
  for (const c of contributions) {
    if (c.kind === "X") continue;
    if (!best || Math.abs(c.volumeDelta * c.elasticity) > Math.abs(best.volumeDelta * best.elasticity)) {
      best = c;
    }
  }
  return best?.channel ?? null;
}

export function explainFamilyShift(opts: {
  absentPlayers: string[];
  beneficiaryName: string;
  family: string;
  multiplier: number;
  contributions: readonly ChannelContribution[];
}): string {
  const pct = Math.round((opts.multiplier - 1) * 100);
  const ch = dominantChannel(opts.contributions);
  const workloadLabel = (ch && CHANNEL_LABEL[ch]) || "workload";
  const sign = pct >= 0 ? `+${pct}` : `${pct}`;
  const absent = opts.absentPlayers.filter(Boolean);
  const who = absent.length ? absent.join(", ") : "Teammate";
  const statusWord = "OUT";

  const rushLike =
    opts.family.startsWith("rush") ||
    opts.family === "anytime_td" ||
    opts.family === "first_td" ||
    ch === "designed_runs" ||
    ch === "gl_carries" ||
    ch === "rz_carries" ||
    ch === "carries";

  let detail: string;
  if (rushLike && /qb|quarterback/i.test(opts.beneficiaryName) === false) {
    detail = `${who} ${statusWord} → projected ${opts.beneficiaryName} ${workloadLabel} increased.`;
  } else if (rushLike) {
    detail = `${who} ${statusWord} → projected ${opts.beneficiaryName} designed-run and goal-line opportunity increased; receiving/pass projections unchanged unless independently supported.`;
  } else {
    detail = `${who} ${statusWord} → ${opts.beneficiaryName} ${workloadLabel} adjusted for this market only.`;
  }

  return `Opportunity Shift: ${sign}% ${workloadLabel}\n${detail}`;
}

export function summarizeRow(row: FamilyShiftRow): string {
  return row.explanation;
}
