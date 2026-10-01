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
  passesDefended?: number | null;
  stuffs?: number | null;
  /** Basketball feed fields (honest, not positional allows). */
  steals?: number | null;
  blocks?: number | null;
  defRebounds?: number | null;
  /** Opp offensive profile (creates rebound/assist opportunities). */
  oppTurnovers?: number | null;
  oppFgPct?: number | null;
  oppThreePct?: number | null;
  /** NHL goaltending / shot suppression feed fields. */
  goalsAgainstAvg?: number | null;
  savePct?: number | null;
  shotsAgainst?: number | null;
  blockedShots?: number | null;
  takeaways?: number | null;
  /** Soccer feed fields. */
  goalsConceded?: number | null;
  cleanSheets?: number | null;
  tackles?: number | null;
  /** MLB team pitching allowlist (coarse — prefer pitcher tendency when present). */
  era?: number | null;
  whip?: number | null;
  battingAverageAgainst?: number | null;
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
    // Soft pressure nudge from season sacks / passes defended when present.
    if (pack?.sacks != null && pack.sacks >= 20 && isOver) tilt -= 0.1;
    if (pack?.interceptions != null && pack.interceptions >= 10 && isOver) tilt -= 0.08;
    if (pack?.passesDefended != null && pack.passesDefended >= 50 && isOver) tilt -= 0.08;
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
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  pack?: FootballOppDefenseSlice | null;
}): boolean {
  // Unified across sports — NFL rush/pass + NHL goaltending + etc.
  return propOppDefenseTilt(opts).blockOver;
}

/** NHL Goals / Points markets (not SOG / saves). */
export function isNhlScoringMarket(market?: string | null): boolean {
  const key = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (/shot|sog|save/.test(key)) return false;
  return (
    /player\s*goals|\bgoals?\b|goal\s*scorer|scorer/.test(key) ||
    /player\s*points|\bpoints?\b|\bpts\b/.test(key)
  );
}

/**
 * Rare NHL Goals/Points Overs (≥1.5) must have real opponent goaltending
 * context — same fail-closed posture as NFL rush Overs needing opp rush D.
 * Without a pack, EV-only longshots (e.g. Over 1.5 +9000) would stage blind.
 */
export function shouldDropPropMissingOppDefense(opts: {
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  line?: number | null;
  pack?: FootballOppDefenseSlice | null;
}): boolean {
  const sport = String(opts.sport ?? "").toLowerCase();
  if (sport !== "nhl") return false;
  if (String(opts.side ?? "").toLowerCase() !== "over") return false;
  if (!isNhlScoringMarket(opts.market)) return false;
  const line = opts.line;
  if (line == null || !Number.isFinite(line) || line < 1.5) return false;
  const pack = opts.pack;
  if (!pack) return true;
  // Need at least one honest goaltending field — empty packs don't count.
  return pack.savePct == null && pack.goalsAgainstAvg == null;
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
  const key = String(opts.market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  const side = String(opts.side ?? "").toLowerCase();
  const isOver = side === "over";
  const isUnder = side === "under";
  if (!isOver && !isUnder) return empty;
  const pack = opts.pack;
  if (!pack) return empty;
  const who = pack.teamName ? `${pack.teamName} ` : "";

  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    const isPts = /point|pts|three|3.?pt|threes|field goal/.test(key);
    const isAst = /assist|\bast\b/.test(key);
    const isReb = /rebound|\breb\b/.test(key);
    let tilt = 0;
    const bits: string[] = [];
    const pa = pack.pointsAgainst;
    if (pa != null && (isPts || (!isAst && !isReb))) {
      const stingy = sport === "ncaab" ? pa <= 65 : pa <= 108;
      const leaky = sport === "ncaab" ? pa >= 78 : pa >= 118;
      bits.push(`${pa} pts allowed/g`);
      if (stingy) tilt += isOver ? -0.35 : 0.25;
      else if (leaky) tilt += isOver ? 0.3 : -0.2;
    }
    if (isAst && pack.steals != null) {
      bits.push(`${pack.steals.toFixed(1)} stl/g`);
      if (pack.steals >= 8.5) tilt += isOver ? -0.25 : 0.18;
      else if (pack.steals <= 6.5) tilt += isOver ? 0.2 : -0.12;
    }
    if (isReb && pack.defRebounds != null) {
      bits.push(`${pack.defRebounds.toFixed(1)} dreb/g`);
      if (pack.defRebounds >= 35) tilt += isOver ? -0.25 : 0.18;
      else if (pack.defRebounds <= 31) tilt += isOver ? 0.22 : -0.12;
    }
    if (isPts && pack.blocks != null && pack.blocks >= 5.5) {
      bits.push(`${pack.blocks.toFixed(1)} blk/g`);
      tilt += isOver ? -0.12 : 0.08;
    }
    if (isReb && pack.oppFgPct != null && pack.oppFgPct <= 0.44) {
      bits.push(`opp FG% ${(pack.oppFgPct * 100).toFixed(0)}`);
      tilt += isOver ? 0.15 : -0.1;
    }
    if (tilt === 0 || !bits.length) return empty;
    return {
      tilt: Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100)),
      blockOver: false,
      display: `${who}${bits.join(", ")}`,
    };
  }

  if (sport === "nhl") {
    const isShots = /shot|sog/.test(key);
    const isGoals =
      /player\s*goals|\bgoals?\b|goal\s*scorer|scorer/.test(key) && !/shot|sog|save/.test(key);
    const isPoints = /player\s*points|\bpoints?\b|\bpts\b/.test(key) && !isShots && !isGoals;
    const scoringProp = isGoals || isPoints || (!isShots && /goal|point|pts|scorer/.test(key));
    let tilt = 0;
    const bits: string[] = [];
    const gaa = pack.goalsAgainstAvg;
    const sv = pack.savePct != null ? (pack.savePct > 1 ? pack.savePct / 100 : pack.savePct) : null;
    // Elite goaltending hard-blocks Goals/Points Overs — same pattern as NFL
    // stingy rush/pass D blocking yardage Overs (don't stage on EV alone).
    let blockOver = false;
    if (sv != null && scoringProp) {
      bits.push(`${(sv * 100).toFixed(1)} SV%`);
      if (sv >= 0.915) {
        tilt += isOver ? -0.55 : 0.35;
        if (isOver) blockOver = true;
      } else if (sv >= 0.905) {
        tilt += isOver ? -0.3 : 0.2;
      } else if (sv <= 0.895) {
        tilt += isOver ? 0.25 : -0.15;
      }
    }
    if (gaa != null && scoringProp) {
      bits.push(`${gaa.toFixed(2)} GAA`);
      if (gaa <= 2.6) {
        tilt += isOver ? -0.35 : 0.25;
        if (isOver && gaa <= 2.45) blockOver = true;
      } else if (gaa >= 3.4) {
        tilt += isOver ? 0.2 : -0.12;
      }
    }
    if (isShots && pack.shotsAgainst != null) {
      bits.push(`${pack.shotsAgainst.toFixed(0)} SA`);
      // High shots against → more SOG opportunities for skaters.
      if (pack.shotsAgainst >= 32) tilt += isOver ? 0.25 : -0.15;
      else if (pack.shotsAgainst <= 26) tilt += isOver ? -0.22 : 0.15;
    }
    if (pack.blockedShots != null && pack.blockedShots >= 15 && isShots) {
      bits.push(`${pack.blockedShots} blk`);
      tilt += isOver ? -0.1 : 0.06;
    }
    if (tilt === 0 || !bits.length) return empty;
    return {
      tilt: Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100)),
      blockOver,
      display: `${who}${bits.join(", ")}`,
    };
  }

  if (sport === "soccer") {
    let tilt = 0;
    const bits: string[] = [];
    if (pack.goalsConceded != null) {
      bits.push(`${pack.goalsConceded} goals conceded`);
      if (pack.goalsConceded <= 8) tilt += isOver ? -0.25 : 0.2;
      else if (pack.goalsConceded >= 20) tilt += isOver ? 0.2 : -0.12;
    }
    if (pack.cleanSheets != null && pack.cleanSheets >= 6) {
      bits.push(`${pack.cleanSheets} clean sheets`);
      tilt += isOver ? -0.15 : 0.1;
    }
    if (pack.tackles != null && pack.tackles >= 18 && /shot|goal/.test(key)) {
      bits.push(`${pack.tackles} tackles`);
      tilt += isOver ? -0.08 : 0.05;
    }
    if (tilt === 0 || !bits.length) return empty;
    return {
      tilt: Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100)),
      blockOver: false,
      display: `${who}${bits.join(", ")}`,
    };
  }

  if (sport === "mlb") {
    // Coarse team pitching only — prefer opposingPitcherTendency when present in holistic.
    let tilt = 0;
    const bits: string[] = [];
    const isHit = /hit|total bas|\btb\b|home.?run|\bhr\b|rbi|run/.test(key);
    const isK = /strikeout|\bk\b/.test(key);
    if (isHit && pack.era != null) {
      bits.push(`${pack.era.toFixed(2)} ERA`);
      if (pack.era <= 3.4) tilt += isOver ? -0.3 : 0.2;
      else if (pack.era >= 4.6) tilt += isOver ? 0.28 : -0.18;
    }
    if (isHit && pack.whip != null) {
      bits.push(`${pack.whip.toFixed(2)} WHIP`);
      if (pack.whip <= 1.15) tilt += isOver ? -0.15 : 0.1;
      else if (pack.whip >= 1.4) tilt += isOver ? 0.15 : -0.1;
    }
    if (isK && pack.era != null && pack.era <= 3.2) {
      bits.push("stingy staff");
      tilt += isOver ? 0.2 : -0.12; // K overs lean up vs stingy staffs
    }
    if (tilt === 0 || !bits.length) return empty;
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
  const hasFootballPack = !!(opts.defense || opts.pack?.rush || opts.pack?.pass);
  // Football when sport says so, OR when rush/pass yards are present and sport
  // was omitted (legacy callers / tests) — never invent football from NHL packs.
  if (sport === "nfl" || sport === "ncaaf" || (hasFootballPack && !sport)) {
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
