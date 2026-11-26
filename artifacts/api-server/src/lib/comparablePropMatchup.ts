import type { PreparedExpectedCarries } from "./preparedExpectedCarries.js";
import { createHash } from "node:crypto";
import type { PositionThresholdRow } from "./positionThresholdHistory.js";

export const COMPARABLE_MATCHUP_VERSION = "comparable-workload-v1";

export type ComparablePropMatchup = {
  snapshotId?: string;
  recentCarries?: number;
  status: "applied" | "limited" | "missing" | "unsupported";
  games: number;
  appearances: number;
  multiplier: number;
  workload: "carries" | "minutes and field-goal attempts" | "minutes and three-point attempts" | null;
};

type PlayerGame = { date?: string | null; stats: Record<string, string>; periodTag?: string | null };

function nonnegative(value?: string): number | null {
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
}

export function comparablePropMatchup(input: {
  sport: string;
  market: string;
  position?: string | null;
  cutoff: number;
  recent: readonly PlayerGame[];
  thresholds?: readonly PositionThresholdRow[];
  snapshotCapturedAt?: string;
}): ComparablePropMatchup {
  const position = input.position?.trim().toUpperCase();
  const market = input.market.replace(/_alternate$/, "");
  const rushing = ["nfl", "ncaaf"].includes(input.sport) && market === "player_rush_yds" &&
    (position === "RB" || position === "HB");
  const threes = market === "player_threes";
  const scoring = ["nba", "wnba", "ncaab"].includes(input.sport) && (market === "player_points" || threes) &&
    position != null && ["PG", "SG", "SF", "PF", "C", "G", "F"].includes(position);
  const workload = rushing ? "carries"
    : !scoring ? null : threes ? "minutes and three-point attempts" : "minutes and field-goal attempts";
  const result: ComparablePropMatchup = { status: workload ? "missing" : "unsupported", games: 0, appearances: 0, multiplier: 1, workload };
  if (!workload || !Number.isFinite(input.cutoff)) return result;
  const row = input.thresholds?.find(r => r.position === (rushing ? "RB" : position) && r.market === market);
  if (!row) return result;
  // Hash the actual evidence, including changes that leave the capped factor unchanged.
  result.snapshotId = createHash("sha256").update(JSON.stringify([
    input.sport, input.snapshotCapturedAt ?? null, row,
  ])).digest("hex");

  const dates = new Set<string>();
  const player = input.recent.flatMap(({ date, stats, periodTag }) => {
    if (!date || !(Date.parse(date) < input.cutoff) || dates.has(date) || (periodTag && periodTag !== "full")) return [];
    dates.add(date);
    const time = stats.MIN?.match(/^(\d+(?:\.\d+)?)(?::([0-5]\d))?$/);
    const shots = (threes ? stats["3PT"] : stats.FG)?.match(/^(\d+)-(\d+)$/);
    const validShotSplit = shots && Number(shots[1]) <= Number(shots[2]) ? shots : undefined;
    const attempts = [
      ...(threes ? [stats.threePointFieldGoalsAttempted, stats["3PA"]] : [stats.fieldGoalsAttempted, stats.FGA]),
      validShotSplit?.[2],
    ]
      .map(nonnegative).filter((n): n is number => n != null);
    const volume = rushing ? nonnegative(stats.rushingAttempts) : new Set(attempts).size === 1 ? attempts[0] : null;
    const minutes = rushing ? 0 : time ? Number(time[1]) + Number(time[2] ?? 0) / 60 : null;
    const threePointMakes = [stats.threePointFieldGoalsMade, stats["3PM"], validShotSplit?.[1]]
      .map(nonnegative).filter((n): n is number => n != null);
    const raw = rushing ? stats.rushingYards : threes
      ? new Set(threePointMakes).size === 1 ? String(threePointMakes[0]) : undefined : stats.PTS;
    if (threes && volume != null && Number(raw) > volume) return [];
    if (volume == null || minutes == null || (rushing ? volume <= 0 : minutes <= 0) || !/^-?\d+$/.test(raw ?? "")) return [];
    return [{ volume, minutes, value: Number(raw) }];
  });
  if (player.length < 3) return { ...result, status: "limited" };

  const average = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
  const volume = average(player.map(p => p.volume));
  if (rushing) result.recentCarries = volume;
  const minutes = average(player.map(p => p.minutes));
  const seen = new Set<string>();
  const peerValues: number[] = [];
  for (const game of row.games) {
    if (!game.eventId || seen.has(game.eventId) || !(Date.parse(game.date) < input.cutoff)) continue;
    const volumes = rushing ? game.carries : threes ? game.threePointAttempts : game.fieldGoalAttempts;
    if (volumes?.length !== game.values.length || (!rushing && game.minutes?.length !== game.values.length)) continue;
    const values = game.values.filter((value, index) => {
      const peerVolume = volumes[index];
      const peerMinutes = game.minutes?.[index];
      return Number.isFinite(value) && peerVolume != null && Number.isInteger(peerVolume) &&
        peerVolume >= (rushing ? 1 : 0) && (!threes || (value >= 0 && value <= peerVolume)) && Math.abs(peerVolume - volume) <= Math.max(2, volume * 0.25) &&
        (rushing || (peerMinutes != null && Number.isFinite(peerMinutes) && peerMinutes > 0 &&
          Math.abs(peerMinutes - minutes) <= Math.max(4, minutes * 0.2)));
    });
    if (values.length) {
      seen.add(game.eventId);
      peerValues.push(...values);
    }
  }
  const sample = { ...result, games: seen.size, appearances: peerValues.length };
  const playerMean = average(player.map(p => p.value));
  if (seen.size < 3 || !(playerMean > 0)) return { ...sample, status: "limited" };
  // Blend a small, sample-shrunk cohort signal into the player projection.
  const ratioDelta = average(peerValues) / playerMean - 1;
  const multiplier = 1 + Math.max(-0.08, Math.min(0.08, ratioDelta * seen.size / (seen.size + 12)));
  return { ...sample, status: "applied", multiplier };
}

/** Version and evidence are part of the distribution identity shared by warm and live scoring. */
export function comparableDistributionFingerprint(base: string, matchup: ComparablePropMatchup, workload?: PreparedExpectedCarries | null): string {
  const evidence = createHash("sha256").update(JSON.stringify([matchup, workload ?? null])).digest("hex");
  return `${base}:${COMPARABLE_MATCHUP_VERSION}:${evidence}`;
}

/** Scenario inputs are explicit and currently supported only for full-game RB rushing yards. */
export function supportedProjectedCarries(sport: string, market: string, value: unknown): number | null {
  return (sport === "nfl" || sport === "ncaaf") && /^player_rush_yds(?:_alternate)?$/.test(market) &&
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 60
    ? value : null;
}
