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
  /** Basketball feed fields (honest, not positional allows). */
  steals?: number | null;
  blocks?: number | null;
  defRebounds?: number | null;
  /** NHL goaltending feed fields. */
  goalsAgainstAvg?: number | null;
  savePct?: number | null;
  /** Soccer feed fields. */
  goalsConceded?: number | null;
  cleanSheets?: number | null;
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

  // Anytime / rush / pass TD — soft points-allowed tilt only (no invented TD rates).
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (/td|touchdown/.test(m) && pack?.pointsAgainst != null) {
    const pa = pack.pointsAgainst;
    let tilt = 0;
    if (pa <= 16) tilt = isOver ? -0.45 : 0.3;
    else if (pa <= 18) tilt = isOver ? -0.3 : 0.2;
    else if (pa >= 27) tilt = isOver ? 0.3 : -0.2;
    else return empty;
    return {
      tilt,
      blockOver: false,
      display: `${who ? `${who} ` : ""}allows ${pa} pts/g`,
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

/** Soft tilt from honest feed fields for non-football sports (never invents). */
export function multiSportOppDefenseTilt(opts: {
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  pack?: FootballOppDefenseSlice | null;
}): RushDefenseTilt {
  const empty: RushDefenseTilt = { tilt: 0, blockOver: false, display: null };
  const sport = String(opts.sport ?? "").toLowerCase();
  const key = String(opts.market ?? "").toLowerCase();
  const side = String(opts.side ?? "").toLowerCase();
  const isOver = side === "over";
  const isUnder = side === "under";
  if (!isOver && !isUnder) return empty;
  const pack = opts.pack;
  if (!pack) return empty;
  const who = pack.teamName ? `${pack.teamName} ` : "";

  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    const pa = pack.pointsAgainst;
    if (pa == null) return empty;
    // Soft bands only — ESPN pointsAgainst is team-wide, not positional.
    const stingy = sport === "ncaab" ? pa <= 65 : pa <= 108;
    const leaky = sport === "ncaab" ? pa >= 78 : pa >= 118;
    let tilt = 0;
    if (stingy) tilt = isOver ? -0.35 : 0.25;
    else if (leaky) tilt = isOver ? 0.3 : -0.2;
    else return empty;
    const bits = [`${pa} pts allowed/g`];
    if (pack.blocks != null && /point|pts|three|3/.test(key)) {
      bits.push(`${pack.blocks} blk/g`);
    }
    return {
      tilt: Math.max(-0.8, Math.min(0.8, tilt)),
      blockOver: false,
      display: `${who}${bits.join(", ")}`,
    };
  }

  if (sport === "nhl") {
    const gaa = pack.goalsAgainstAvg;
    const sv = pack.savePct != null ? (pack.savePct > 1 ? pack.savePct / 100 : pack.savePct) : null;
    if (gaa == null && sv == null) return empty;
    let tilt = 0;
    const bits: string[] = [];
    if (sv != null) {
      bits.push(`${(sv * 100).toFixed(1)} SV%`);
      if (sv >= 0.915) tilt += isOver ? -0.3 : 0.2;
      else if (sv <= 0.895) tilt += isOver ? 0.25 : -0.15;
    }
    if (gaa != null) {
      bits.push(`${gaa.toFixed(2)} GAA`);
      if (gaa <= 2.6) tilt += isOver ? -0.2 : 0.15;
      else if (gaa >= 3.4) tilt += isOver ? 0.2 : -0.12;
    }
    if (tilt === 0) return empty;
    return {
      tilt: Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100)),
      blockOver: false,
      display: `${who}${bits.join(", ")}`,
    };
  }

  if (sport === "soccer") {
    const gc = pack.goalsConceded;
    const cs = pack.cleanSheets;
    if (gc == null && cs == null && pack.pointsAgainst == null) return empty;
    let tilt = 0;
    const bits: string[] = [];
    if (gc != null) {
      bits.push(`${gc} goals conceded`);
      // Season totals — soft descriptive nudge only when extreme.
      if (gc <= 8) tilt += isOver ? -0.25 : 0.2;
      else if (gc >= 20) tilt += isOver ? 0.2 : -0.12;
    }
    if (cs != null && cs >= 6) {
      bits.push(`${cs} clean sheets`);
      tilt += isOver ? -0.15 : 0.1;
    }
    if (tilt === 0) return empty;
    return {
      tilt: Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100)),
      blockOver: false,
      display: `${who}${bits.join(", ")}`,
    };
  }

  return empty;
}

/**
 * Unified opp-D tilt for ANY prop sport. Football yards/TDs first, then
 * multi-sport soft feed tilts. Fail closed when pack/sample missing.
 */
export function propOppDefenseTilt(opts: {
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  pack?: FootballOppDefenseSlice | null;
}): RushDefenseTilt {
  const sport = String(opts.sport ?? "").toLowerCase();
  if (sport === "nfl" || sport === "ncaaf") {
    const fb = footballRushDefenseTilt(opts);
    if (fb.tilt !== 0 || fb.blockOver || fb.display) return fb;
  }
  return multiSportOppDefenseTilt({
    sport: opts.sport,
    market: opts.market,
    side: opts.side,
    pack: opts.pack,
  });
}

/** Strong negative tilt — swap to Under / softer alt before staging. */
export const DEFENSE_ALT_TILT_THRESHOLD = -0.4;

/**
 * True when this Over should not stay as the staged side — hard block OR
 * soft stingy enough that we prefer an Under / alt instead.
 */
export function shouldPreferDefenseAltPick(opts: {
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  pack?: FootballOppDefenseSlice | null;
}): boolean {
  const side = String(opts.side ?? "").toLowerCase();
  if (side !== "over") return false;
  const tilt = propOppDefenseTilt(opts);
  return tilt.blockOver || tilt.tilt <= DEFENSE_ALT_TILT_THRESHOLD;
}

export type DefenseAwarePickCandidate = {
  game: string;
  player: string;
  market: string;
  propMarketKey?: string | null;
  propSide?: string | null;
  propLine?: number | null;
  propIsAlt?: boolean | null;
};

/**
 * When the best-EV Over is defense-hostile, pick a safer posted alternative:
 * 1) same-line Under
 * 2) any Under for the player/market (prefer higher Under line)
 * 3) a softer alt Over (lower line) for the same player/market
 * Returns null when no alternative exists (caller drops the Over).
 */
export function pickDefenseAwareAlt<T extends DefenseAwarePickCandidate>(
  hostileOver: T,
  candidates: readonly T[],
): T | null {
  const marketKey = String(
    hostileOver.propMarketKey ?? hostileOver.market ?? "",
  ).toLowerCase();
  const samePlayerMarket = (c: T) =>
    c.game === hostileOver.game &&
    c.player === hostileOver.player &&
    String(c.propMarketKey ?? c.market ?? "").toLowerCase() === marketKey;

  const unders = candidates
    .filter((c) => samePlayerMarket(c) && String(c.propSide ?? "").toLowerCase() === "under")
    .slice();
  const sameLineUnder = unders.find((c) => c.propLine === hostileOver.propLine);
  if (sameLineUnder) return sameLineUnder;
  unders.sort((a, b) => (b.propLine ?? 0) - (a.propLine ?? 0));
  if (unders.length) return unders[0];

  // Softer Over: lower line vs stingy D (Over 40 → Over 24.5).
  const mainLine = hostileOver.propLine;
  if (mainLine == null || !Number.isFinite(mainLine)) return null;
  const softerOvers = candidates
    .filter(
      (c) =>
        samePlayerMarket(c) &&
        String(c.propSide ?? "").toLowerCase() === "over" &&
        c.propLine != null &&
        Number.isFinite(c.propLine) &&
        (c.propLine as number) < mainLine,
    )
    .slice()
    .sort((a, b) => (b.propLine ?? 0) - (a.propLine ?? 0));
  return softerOvers[0] ?? null;
}

/** Alias — blocks any skill-yard OVER vs hard stingy matching D. */
export const shouldBlockSkillOverVsDefense = shouldBlockRushOverVsDefense;
export const footballOppDefenseTilt = footballRushDefenseTilt;
