/**
 * Soft/hard tilt for football rush props vs opponent run defense.
 * Uses real rushingYardsAllowedPerGame from recent box scores only.
 */

export type RushDefenseSlice = {
  rushingYardsAllowedPerGame: number | null;
  yardsPerRushAllowed: number | null;
  sampleSize: number;
  stuffs?: number | null;
  teamName?: string | null;
};

export type RushDefenseTilt = {
  /** Additive composite tilt, capped ±0.8. */
  tilt: number;
  /** When true, rush OVER should not stage on props-only tickets. */
  blockOver: boolean;
  display: string | null;
};

const MIN_SAMPLE = 2;
/** NFL/NCAAF stingy run-D band (team rush yards allowed / game). */
const STINGY_HARD = 95;
const STINGY_SOFT = 105;
const LEAKY_SOFT = 130;

export function isFootballRushYardsMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (!/rush/.test(m)) return false;
  if (/td|touchdown|attempt|longest|reception/.test(m) && !/yard|yd/.test(m)) return false;
  return /yard|yd|\brush yds\b|\brushing yds\b/.test(m) || /player rush yds/.test(m);
}

/**
 * Tilt for a rush-yards prop against a known opponent run defense.
 * Fail closed (tilt 0) when sample is thin or allowed yards missing.
 */
export function footballRushDefenseTilt(opts: {
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
}): RushDefenseTilt {
  const empty: RushDefenseTilt = { tilt: 0, blockOver: false, display: null };
  if (!isFootballRushYardsMarket(opts.market)) return empty;
  const d = opts.defense;
  if (!d || d.sampleSize < MIN_SAMPLE || d.rushingYardsAllowedPerGame == null) {
    return empty;
  }
  const allowed = d.rushingYardsAllowedPerGame;
  const ypc = d.yardsPerRushAllowed;
  const side = String(opts.side ?? "").toLowerCase();
  const isOver = side === "over";
  const isUnder = side === "under";
  if (!isOver && !isUnder) return empty;

  let tilt = 0;
  let blockOver = false;
  const bits: string[] = [`allows ${allowed} rush yds/g`];
  if (ypc != null) bits.push(`${ypc} YPC allowed`);
  if (d.sampleSize) bits.push(`n=${d.sampleSize}`);

  if (allowed <= STINGY_HARD) {
    blockOver = isOver;
    tilt = isOver ? -0.8 : 0.55;
  } else if (allowed <= STINGY_SOFT) {
    tilt = isOver ? -0.45 : 0.3;
  } else if (allowed >= LEAKY_SOFT) {
    tilt = isOver ? 0.35 : -0.25;
  }

  // Extra soft push from YPC when sample supports it.
  if (ypc != null && ypc <= 3.7) {
    tilt += isOver ? -0.15 : 0.1;
  } else if (ypc != null && ypc >= 4.8) {
    tilt += isOver ? 0.1 : -0.08;
  }

  tilt = Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100));
  const who = d.teamName ? `${d.teamName} ` : "";
  return {
    tilt,
    blockOver,
    display: `${who}${bits.join(", ")}`,
  };
}

/** Prefer Under / drop Over when facing a hard stingy run D. */
export function shouldBlockRushOverVsDefense(opts: {
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
}): boolean {
  return footballRushDefenseTilt(opts).blockOver;
}
