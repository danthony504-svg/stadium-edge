/**
 * Soft/hard tilt for football skill props vs opponent run/pass defense.
 * Uses real yards-allowed averages from recent box scores only.
 * Covers rush yards, pass yards, receiving yards/receptions — applied before
 * staging (including alt rungs) so Coach doesn't lock a main Over vs a stout D.
 */

export type RushDefenseSlice = {
  rushingYardsAllowedPerGame: number | null;
  yardsPerRushAllowed: number | null;
  sampleSize: number;
  stuffs?: number | null;
  teamName?: string | null;
};

export type PassDefenseSlice = {
  passingYardsAllowedPerGame: number | null;
  yardsPerPassAllowed: number | null;
  sampleSize: number;
  teamName?: string | null;
};

export type FootballOppDefenseSlice = {
  rush?: RushDefenseSlice | null;
  pass?: PassDefenseSlice | null;
  teamName?: string | null;
  /** Coarse points-allowed rate when available (season / feed). */
  pointsAgainst?: number | null;
  sacks?: number | null;
  interceptions?: number | null;
};

export type RushDefenseTilt = {
  /** Additive composite tilt, capped ±0.8. */
  tilt: number;
  /** When true, OVER should not stage on props-only / board tickets. */
  blockOver: boolean;
  display: string | null;
};

const MIN_SAMPLE = 2;
/** NFL/NCAAF stingy run-D band (team rush yards allowed / game). */
const RUSH_STINGY_HARD = 95;
const RUSH_STINGY_SOFT = 105;
const RUSH_LEAKY_SOFT = 130;
/** Pass yards allowed / game bands. */
const PASS_STINGY_HARD = 180;
const PASS_STINGY_SOFT = 200;
const PASS_LEAKY_SOFT = 245;

export function isFootballRushYardsMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (!/rush/.test(m)) return false;
  if (/td|touchdown|attempt|longest|reception/.test(m) && !/yard|yd/.test(m)) return false;
  return /yard|yd|\brush yds\b|\brushing yds\b/.test(m) || /player rush yds/.test(m);
}

/** Pass yards / completions markets (QB). */
export function isFootballPassYardsMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (/rush|recv|reception|receiving/.test(m)) return false;
  if (!/pass|qb/.test(m)) return false;
  if (/td|touchdown|int|intercept|attempt|longest/.test(m) && !/yard|yd|complet/.test(m)) {
    return false;
  }
  return /yard|yd|complet/.test(m);
}

/** Receiving yards / receptions (WR/TE/RB catch). */
export function isFootballRecvMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (/rush|pass(?!.*recv)/.test(m) && !/recv|reception|receiving/.test(m)) return false;
  return (
    /recv|reception|receiving/.test(m) &&
    (/yard|yd|reception/.test(m) || /player receptions/.test(m))
  );
}

export function isFootballSkillYardsMarket(market: string | null | undefined): boolean {
  return (
    isFootballRushYardsMarket(market) ||
    isFootballPassYardsMarket(market) ||
    isFootballRecvMarket(market)
  );
}

function tiltFromBands(opts: {
  allowed: number;
  stingyHard: number;
  stingySoft: number;
  leakySoft: number;
  isOver: boolean;
  isUnder: boolean;
}): { tilt: number; blockOver: boolean } {
  const { allowed, stingyHard, stingySoft, leakySoft, isOver, isUnder } = opts;
  if (allowed <= stingyHard) {
    return { tilt: isOver ? -0.8 : isUnder ? 0.55 : 0, blockOver: isOver };
  }
  if (allowed <= stingySoft) {
    return { tilt: isOver ? -0.45 : isUnder ? 0.3 : 0, blockOver: false };
  }
  if (allowed >= leakySoft) {
    return { tilt: isOver ? 0.35 : isUnder ? -0.25 : 0, blockOver: false };
  }
  return { tilt: 0, blockOver: false };
}

/**
 * Tilt for a football skill prop against a known opponent defense pack.
 * Fail closed (tilt 0) when sample is thin or allowed yards missing.
 */
export function footballRushDefenseTilt(opts: {
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  /** Full pack — preferred when present (covers pass/recv too). */
  pack?: FootballOppDefenseSlice | null;
}): RushDefenseTilt {
  const empty: RushDefenseTilt = { tilt: 0, blockOver: false, display: null };
  const market = opts.market;
  const side = String(opts.side ?? "").toLowerCase();
  const isOver = side === "over";
  const isUnder = side === "under";
  if (!isOver && !isUnder) return empty;

  const pack = opts.pack;
  const rush = pack?.rush ?? opts.defense ?? null;
  const pass = pack?.pass ?? null;
  const who = pack?.teamName ?? rush?.teamName ?? pass?.teamName ?? "";

  if (isFootballRushYardsMarket(market)) {
    if (!rush || rush.sampleSize < MIN_SAMPLE || rush.rushingYardsAllowedPerGame == null) {
      return empty;
    }
    const allowed = rush.rushingYardsAllowedPerGame;
    const ypc = rush.yardsPerRushAllowed;
    let { tilt, blockOver } = tiltFromBands({
      allowed,
      stingyHard: RUSH_STINGY_HARD,
      stingySoft: RUSH_STINGY_SOFT,
      leakySoft: RUSH_LEAKY_SOFT,
      isOver,
      isUnder,
    });
    if (ypc != null && ypc <= 3.7) tilt += isOver ? -0.15 : 0.1;
    else if (ypc != null && ypc >= 4.8) tilt += isOver ? 0.1 : -0.08;
    tilt = Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100));
    const bits = [`allows ${allowed} rush yds/g`];
    if (ypc != null) bits.push(`${ypc} YPC allowed`);
    bits.push(`n=${rush.sampleSize}`);
    return {
      tilt,
      blockOver,
      display: `${who ? `${who} ` : ""}${bits.join(", ")}`,
    };
  }

  if (isFootballPassYardsMarket(market) || isFootballRecvMarket(market)) {
    if (!pass || pass.sampleSize < MIN_SAMPLE || pass.passingYardsAllowedPerGame == null) {
      return empty;
    }
    const allowed = pass.passingYardsAllowedPerGame;
    const ypa = pass.yardsPerPassAllowed;
    let { tilt, blockOver } = tiltFromBands({
      allowed,
      stingyHard: PASS_STINGY_HARD,
      stingySoft: PASS_STINGY_SOFT,
      leakySoft: PASS_LEAKY_SOFT,
      isOver,
      isUnder,
    });
    // Soft pressure nudge from season sacks when present (descriptive only).
    if (pack?.sacks != null && pack.sacks >= 20 && isOver) tilt -= 0.1;
    if (ypa != null && ypa <= 5.8) tilt += isOver ? -0.12 : 0.08;
    else if (ypa != null && ypa >= 7.4) tilt += isOver ? 0.1 : -0.08;
    tilt = Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100));
    const kind = isFootballRecvMarket(market) ? "recv" : "pass";
    const bits = [`allows ${allowed} pass yds/g`];
    if (ypa != null) bits.push(`${ypa} YPA allowed`);
    bits.push(`n=${pass.sampleSize}`);
    return {
      tilt,
      blockOver,
      display: `${who ? `${who} ` : ""}${bits.join(", ")} (${kind})`,
    };
  }

  return empty;
}

/** Prefer Under / drop Over when facing a hard stingy matching defense. */
export function shouldBlockRushOverVsDefense(opts: {
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  pack?: FootballOppDefenseSlice | null;
}): boolean {
  return footballRushDefenseTilt(opts).blockOver;
}

/** Alias — blocks any skill-yard OVER vs hard stingy matching D. */
export const shouldBlockSkillOverVsDefense = shouldBlockRushOverVsDefense;
export const footballOppDefenseTilt = footballRushDefenseTilt;
