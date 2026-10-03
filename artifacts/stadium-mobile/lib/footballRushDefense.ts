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
  /** Own / team points scored per game — coarse game-script proxy. */
  pointsFor?: number | null;
  /** Season defensive sacks forced (normalize with gamesPlayed). */
  sacks?: number | null;
  /** Season defensive interceptions (normalize with gamesPlayed). */
  interceptions?: number | null;
  passesDefended?: number | null;
  stuffs?: number | null;
  /** Season games played — from ESPN teamGamesPlayed / gamesPlayed. */
  gamesPlayed?: number | null;
  /** Season takeaways (INT+fumble recoveries) when ESPN exposes them. */
  totalTakeaways?: number | null;
  /**
   * Offensive-line / QB pressure allowed: ESPN passing.sacks on THIS team
   * (sacks taken), not defensive sacks. Normalize with gamesPlayed.
   */
  sacksAllowed?: number | null;
  sackYardsLost?: number | null;
  /** Own QB/team interception rate (% of attempts) from ESPN interceptionPct. */
  interceptionPct?: number | null;
  /** Own season interceptions thrown (passing.interceptions). */
  intsThrown?: number | null;
  /** Own season pass attempts — for INT rate when pct missing. */
  passingAttempts?: number | null;
  /** Own offensive yards/rush — coarse run-blocking proxy (not YBC). */
  ownRushYpc?: number | null;
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

/**
 * League-context per-game bands (ESPN season totals ÷ gamesPlayed).
 * Early-season (gp≥2) still works; fail closed when gp missing.
 * Not arbitrary season-total cutoffs (≥20 sacks / ≥10 INT).
 */
const SACKS_PG_ELITE = 3.0;
const SACKS_PG_STRONG = 2.5;
const SACKS_PG_WEAK = 1.7;
const INT_PG_ELITE = 1.0;
const INT_PG_STRONG = 0.75;
const INT_PG_WEAK = 0.4;
const PD_PG_STRONG = 4.0;
const TAKEAWAY_PG_STRONG = 1.5;
const SACKS_ALLOWED_PG_POROUS = 3.0;
const SACKS_ALLOWED_PG_STOUT = 1.6;
const INT_PCT_HIGH = 3.0;
const INT_PCT_LOW = 1.5;
const OWN_RUSH_YPC_STRONG = 4.6;
const OWN_RUSH_YPC_WEAK = 3.7;

/** Bounded hit-prob shift from matchup tilt (±0.8 → ±~4.8pp). Sync, no I/O. */
const HIT_TILT_SCALE = 0.06;

export function isFootballRushYardsMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (!/rush/.test(m)) return false;
  if (/td|touchdown|attempt|longest|reception/.test(m) && !/yard|yd/.test(m)) return false;
  return /yard|yd|\brush yds\b|\brushing yds\b/.test(m) || /player rush yds/.test(m);
}

/** Rush attempts / longest rush (volume + explosive run). */
export function isFootballRushVolumeMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m || !/rush/.test(m)) return false;
  if (/yard|yd|td|touchdown|reception/.test(m) && !/attempt|longest|long rush/.test(m)) {
    return false;
  }
  return /attempt|longest|long rush/.test(m);
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

/** Pass attempts / longest completion (volume + explosive pass). */
export function isFootballPassVolumeMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (/rush|recv|reception|receiving|int|intercept|sack|td|touchdown/.test(m)) return false;
  if (!/pass|qb/.test(m)) return false;
  return /attempt|longest|long (pass|completion)/.test(m);
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

/** Longest reception. */
export function isFootballRecvLongMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  return /recv|reception|receiving/.test(m) && /longest|long recv|long reception/.test(m);
}

/** Dedicated sack props (pass rusher). */
export function isFootballSackMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (/yard|yd|allowed/.test(m)) return false;
  return /\bsacks?\b|player_sacks/.test(m);
}

/** QB interceptions thrown (not defensive INTs). */
export function isFootballQbIntMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (!m) return false;
  if (/defensive/.test(m)) return false;
  return /pass.?int|interceptions? thrown|player_pass_interceptions|\bints?\b/.test(m) ||
    (/intercept/.test(m) && /pass|qb|thrown/.test(m));
}

/** QB rushing yards — pressure/scramble relevant. */
export function isFootballQbRushMarket(market: string | null | undefined): boolean {
  const m = String(market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  return /qb/.test(m) && /rush/.test(m) && /yard|yd/.test(m);
}

export function isFootballSkillYardsMarket(market: string | null | undefined): boolean {
  return (
    isFootballRushYardsMarket(market) ||
    isFootballPassYardsMarket(market) ||
    isFootballRecvMarket(market) ||
    isFootballRushVolumeMarket(market) ||
    isFootballPassVolumeMarket(market) ||
    isFootballSackMarket(market) ||
    isFootballQbIntMarket(market)
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

/** Season total ÷ games — null when either missing or gp < 2. */
export function perGameRate(
  total: number | null | undefined,
  gamesPlayed: number | null | undefined,
): number | null {
  if (total == null || !Number.isFinite(total)) return null;
  if (gamesPlayed == null || !Number.isFinite(gamesPlayed) || gamesPlayed < 2) return null;
  return Math.round((total / gamesPlayed) * 100) / 100;
}

function clampTilt(tilt: number): number {
  return Math.max(-0.8, Math.min(0.8, Math.round(tilt * 100) / 100));
}

/**
 * Coarse pressure index from opp sack rate + own sacks-allowed rate.
 * Returns signed lean for the *offense* facing pressure: +1 = heavy pressure.
 */
export function footballPressureIndex(opts: {
  opp?: FootballOppDefenseSlice | null;
  own?: FootballOppDefenseSlice | null;
}): { pressure: number; bits: string[] } {
  const bits: string[] = [];
  let pressure = 0;
  const oppSackPg = perGameRate(opts.opp?.sacks, opts.opp?.gamesPlayed);
  const ownAllowedPg = perGameRate(opts.own?.sacksAllowed, opts.own?.gamesPlayed);
  if (oppSackPg != null) {
    bits.push(`${oppSackPg}/g opp sacks`);
    if (oppSackPg >= SACKS_PG_ELITE) pressure += 0.55;
    else if (oppSackPg >= SACKS_PG_STRONG) pressure += 0.35;
    else if (oppSackPg <= SACKS_PG_WEAK) pressure -= 0.3;
  }
  if (ownAllowedPg != null) {
    bits.push(`${ownAllowedPg}/g sacks allowed`);
    if (ownAllowedPg >= SACKS_ALLOWED_PG_POROUS) pressure += 0.4;
    else if (ownAllowedPg <= SACKS_ALLOWED_PG_STOUT) pressure -= 0.35;
  }
  return { pressure: Math.max(-1, Math.min(1, pressure)), bits };
}

/**
 * Takeaway / INT threat from opp INT rate + PD + takeaways, vs own INT%.
 * Positive = more INT risk for the QB.
 */
export function footballIntThreatIndex(opts: {
  opp?: FootballOppDefenseSlice | null;
  own?: FootballOppDefenseSlice | null;
}): { threat: number; bits: string[] } {
  const bits: string[] = [];
  let threat = 0;
  const intPg = perGameRate(opts.opp?.interceptions, opts.opp?.gamesPlayed);
  const pdPg = perGameRate(opts.opp?.passesDefended, opts.opp?.gamesPlayed);
  const takePg = perGameRate(opts.opp?.totalTakeaways, opts.opp?.gamesPlayed);
  const ownIntPct = opts.own?.interceptionPct;
  if (intPg != null) {
    bits.push(`${intPg}/g opp INT`);
    if (intPg >= INT_PG_ELITE) threat += 0.45;
    else if (intPg >= INT_PG_STRONG) threat += 0.3;
    else if (intPg <= INT_PG_WEAK) threat -= 0.25;
  }
  if (pdPg != null && pdPg >= PD_PG_STRONG) {
    bits.push(`${pdPg}/g PD`);
    threat += 0.15;
  }
  if (takePg != null && takePg >= TAKEAWAY_PG_STRONG) {
    bits.push(`${takePg}/g takeaways`);
    threat += 0.12;
  }
  if (ownIntPct != null && Number.isFinite(ownIntPct)) {
    bits.push(`${ownIntPct}% INT`);
    if (ownIntPct >= INT_PCT_HIGH) threat += 0.35;
    else if (ownIntPct <= INT_PCT_LOW) threat -= 0.25;
  } else {
    const thrownPg = perGameRate(opts.own?.intsThrown, opts.own?.gamesPlayed);
    if (thrownPg != null) {
      bits.push(`${thrownPg}/g INT thrown`);
      if (thrownPg >= 1.0) threat += 0.3;
      else if (thrownPg <= 0.4) threat -= 0.2;
    }
  }
  return { threat: Math.max(-1, Math.min(1, threat)), bits };
}

/**
 * Apply matchup tilt to a sim hit probability. Bounded, sync — does not
 * change provider lines/odds. Positive tilt → higher hit for that side.
 */
export function adjustSimHitForOppDefenseTilt(
  hit: number | null | undefined,
  tilt: number,
): number | null {
  if (hit == null || !Number.isFinite(hit)) return hit ?? null;
  if (!Number.isFinite(tilt) || tilt === 0) return hit;
  const adj = Math.max(-0.05, Math.min(0.05, tilt * HIT_TILT_SCALE));
  return Math.round(Math.max(0.02, Math.min(0.98, hit + adj)) * 1000) / 1000;
}

function sideTilt(magnitude: number, isOver: boolean, isUnder: boolean): number {
  if (magnitude === 0) return 0;
  // magnitude > 0 favors Over; < 0 favors Under
  if (isOver) return magnitude;
  if (isUnder) return -magnitude;
  return 0;
}

/**
 * Tilt for a football skill prop against a known opponent defense pack.
 * Fail closed (tilt 0) when sample is thin or allowed yards missing.
 * Optional ownPack adds O-line / QB tendency (already loaded — no extra fetch).
 */
export function footballRushDefenseTilt(opts: {
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  /** Full pack — preferred when present (covers pass/recv too). */
  pack?: FootballOppDefenseSlice | null;
  /** Player's own team pack (O-line sacks allowed, INT%, rush YPC). */
  ownPack?: FootballOppDefenseSlice | null;
}): RushDefenseTilt {
  const empty: RushDefenseTilt = { tilt: 0, blockOver: false, display: null };
  const market = opts.market;
  const side = String(opts.side ?? "").toLowerCase();
  const isOver = side === "over";
  const isUnder = side === "under";
  if (!isOver && !isUnder) return empty;

  const pack = opts.pack;
  const own = opts.ownPack ?? null;
  const rush = pack?.rush ?? opts.defense ?? null;
  const pass = pack?.pass ?? null;
  const who = pack?.teamName ?? rush?.teamName ?? pass?.teamName ?? "";

  // --- Dedicated sack props: pass rusher vs opposing O-line ---
  if (isFootballSackMarket(market)) {
    // pack = offense being rushed (opponent of the defender) → sacksAllowed
    // ownPack = rusher's defense → sacks forced. Never cross-fallback: a missing
    // field must not borrow the other team's OL or pass-rush rate.
    const olineAllowedPg = perGameRate(pack?.sacksAllowed, pack?.gamesPlayed);
    const rusherSackPg = perGameRate(own?.sacks, own?.gamesPlayed);
    if (olineAllowedPg == null && rusherSackPg == null) return empty;
    let favorOver = 0;
    const bits: string[] = [];
    if (olineAllowedPg != null) {
      bits.push(`${olineAllowedPg}/g OL sacks allowed`);
      if (olineAllowedPg >= SACKS_ALLOWED_PG_POROUS) favorOver += 0.4;
      else if (olineAllowedPg <= SACKS_ALLOWED_PG_STOUT) favorOver -= 0.35;
    }
    if (rusherSackPg != null) {
      bits.push(`${rusherSackPg}/g pass-rush`);
      if (rusherSackPg >= SACKS_PG_ELITE) favorOver += 0.35;
      else if (rusherSackPg >= SACKS_PG_STRONG) favorOver += 0.2;
      else if (rusherSackPg <= SACKS_PG_WEAK) favorOver -= 0.25;
    }
    if (favorOver === 0 && !bits.length) return empty;
    const tilt = clampTilt(sideTilt(favorOver, isOver, isUnder));
    return {
      tilt,
      blockOver: false,
      display: `${who ? `${who} ` : ""}${bits.join(", ")} (sack)`,
    };
  }

  // --- Dedicated QB interception props ---
  if (isFootballQbIntMarket(market)) {
    const { threat, bits } = footballIntThreatIndex({ opp: pack, own });
    if (!bits.length) return empty;
    // High INT threat favors INT Over (QB throws picks).
    const tilt = clampTilt(sideTilt(threat * 0.7, isOver, isUnder));
    return {
      tilt,
      blockOver: false,
      display: `${who ? `${who} ` : ""}${bits.join(", ")} (INT)`,
    };
  }

  // --- QB scramble rush: pressure favors Over (before generic rush yards) ---
  if (isFootballQbRushMarket(market)) {
    const { pressure, bits: pressBits } = footballPressureIndex({ opp: pack, own });
    if (!pressBits.length && (!rush || rush.sampleSize < MIN_SAMPLE)) return empty;
    let tilt = 0;
    const bits: string[] = [...pressBits];
    if (pressBits.length) {
      tilt += sideTilt(pressure * 0.45, isOver, isUnder);
    }
    // Soft leaky/stingy run-D still matters for QB designed runs.
    if (rush && rush.sampleSize >= MIN_SAMPLE && rush.rushingYardsAllowedPerGame != null) {
      bits.push(`allows ${rush.rushingYardsAllowedPerGame} rush yds/g`);
      if (rush.rushingYardsAllowedPerGame <= RUSH_STINGY_SOFT) {
        tilt += isOver ? -0.15 : 0.1;
      } else if (rush.rushingYardsAllowedPerGame >= RUSH_LEAKY_SOFT) {
        tilt += isOver ? 0.12 : -0.08;
      }
    }
    tilt = clampTilt(tilt);
    if (!bits.length) return empty;
    return {
      tilt,
      blockOver: false,
      display: `${who ? `${who} ` : ""}${bits.join(", ")} (qb-rush)`,
    };
  }

  if (isFootballRushYardsMarket(market) || isFootballRushVolumeMarket(market)) {
    if (!rush || rush.sampleSize < MIN_SAMPLE || rush.rushingYardsAllowedPerGame == null) {
      // Still allow own YPC / stuffs soft tilt when box sample thin.
      if (own?.ownRushYpc == null && pack?.stuffs == null) return empty;
    }
    let tilt = 0;
    let blockOver = false;
    const bits: string[] = [];
    if (rush && rush.sampleSize >= MIN_SAMPLE && rush.rushingYardsAllowedPerGame != null) {
      const allowed = rush.rushingYardsAllowedPerGame;
      const ypc = rush.yardsPerRushAllowed;
      const band = tiltFromBands({
        allowed,
        stingyHard: RUSH_STINGY_HARD,
        stingySoft: RUSH_STINGY_SOFT,
        leakySoft: RUSH_LEAKY_SOFT,
        isOver,
        isUnder,
      });
      tilt = band.tilt;
      blockOver = band.blockOver;
      bits.push(`allows ${allowed} rush yds/g`);
      if (ypc != null) {
        bits.push(`${ypc} YPC allowed`);
        if (ypc <= 3.7) tilt += isOver ? -0.15 : 0.1;
        else if (ypc >= 4.8) tilt += isOver ? 0.1 : -0.08;
      }
      bits.push(`n=${rush.sampleSize}`);
    }
    // Run-blocking proxy: own offensive YPC (not yards-before-contact — unavailable).
    if (own?.ownRushYpc != null) {
      bits.push(`own ${own.ownRushYpc} YPC`);
      if (own.ownRushYpc >= OWN_RUSH_YPC_STRONG) tilt += isOver ? 0.12 : -0.08;
      else if (own.ownRushYpc <= OWN_RUSH_YPC_WEAK) tilt += isOver ? -0.12 : 0.08;
    }
    const stuffPg = perGameRate(pack?.stuffs, pack?.gamesPlayed);
    if (stuffPg != null && stuffPg >= 2.5) {
      bits.push(`${stuffPg}/g stuffs`);
      tilt += isOver ? -0.1 : 0.07;
    }
    // Game script: trailing teams pass more → rush volume Unders; leading → rush Overs.
    // Compare own scoring rate to opponent's scoring rate (pointsFor), not pointsAgainst.
    if (
      pack?.pointsFor != null &&
      own?.pointsFor != null &&
      isFootballRushVolumeMarket(market)
    ) {
      const script = own.pointsFor - pack.pointsFor;
      if (script >= 7) tilt += isOver ? 0.08 : -0.05;
      else if (script <= -7) tilt += isOver ? -0.08 : 0.05;
    }
    tilt = clampTilt(tilt);
    if (!bits.length) return empty;
    return {
      tilt,
      blockOver,
      display: `${who ? `${who} ` : ""}${bits.join(", ")}`,
    };
  }

  if (
    isFootballPassYardsMarket(market) ||
    isFootballRecvMarket(market) ||
    isFootballPassVolumeMarket(market) ||
    isFootballRecvLongMarket(market)
  ) {
    const isRecv = isFootballRecvMarket(market) || isFootballRecvLongMarket(market);
    const isPassVol = isFootballPassVolumeMarket(market);
    const { pressure, bits: pressBits } = footballPressureIndex({ opp: pack, own });
    const { threat: intThreat, bits: intBits } = footballIntThreatIndex({ opp: pack, own });

    let tilt = 0;
    let blockOver = false;
    const bits: string[] = [];

    if (
      pass &&
      pass.sampleSize >= MIN_SAMPLE &&
      pass.passingYardsAllowedPerGame != null
    ) {
      const allowed = pass.passingYardsAllowedPerGame;
      const ypa = pass.yardsPerPassAllowed;
      const band = tiltFromBands({
        allowed,
        stingyHard: PASS_STINGY_HARD,
        stingySoft: PASS_STINGY_SOFT,
        leakySoft: PASS_LEAKY_SOFT,
        isOver,
        isUnder,
      });
      tilt = band.tilt;
      blockOver = band.blockOver;
      bits.push(`allows ${allowed} pass yds/g`);
      if (ypa != null) {
        bits.push(`${ypa} YPA allowed`);
        if (ypa <= 5.8) tilt += isOver ? -0.12 : 0.08;
        else if (ypa >= 7.4) tilt += isOver ? 0.1 : -0.08;
      }
      bits.push(`n=${pass.sampleSize}`);
    }

    // Pressure effects — market-aware (not blanket Under):
    // pass yards/completions/longest: pressure suppresses efficiency → Under lean
    // pass attempts: pressure/trailing can raise volume → mild Over lean
    // receptions (count): checkdowns under pressure → mild Over
    // recv yards / longest reception: pressure caps downfield → mild Under
    if (pressBits.length) {
      bits.push(...pressBits);
      const mKey = String(market ?? "").toLowerCase();
      if (isPassVol && /attempt/.test(mKey)) {
        tilt += sideTilt(pressure * 0.2, isOver, isUnder);
      } else if (isFootballRecvLongMarket(market)) {
        // Longest reception is explosive — pressure leans Under (not checkdown Over).
        tilt += sideTilt(-pressure * 0.15, isOver, isUnder);
      } else if (
        isRecv &&
        /reception/.test(mKey) &&
        !/yard|yd|longest|long/.test(mKey)
      ) {
        // Receptions (checkdowns) tick up under pressure
        tilt += sideTilt(pressure * 0.22, isOver, isUnder);
      } else if (isRecv) {
        // Recv yards: pressure caps downfield → mild Under
        tilt += sideTilt(-pressure * 0.15, isOver, isUnder);
      } else {
        // Pass yards / completions / longest completion
        tilt += sideTilt(-pressure * 0.28, isOver, isUnder);
      }
    }

    // INT threat soft-caps explosive pass / longest completion Overs
    if (intBits.length && (isFootballPassYardsMarket(market) || isFootballPassVolumeMarket(market))) {
      if (/longest|complet/.test(String(market ?? "").toLowerCase())) {
        bits.push(...intBits.filter((b) => !bits.includes(b)));
        tilt += sideTilt(-intThreat * 0.15, isOver, isUnder);
      }
    }

    tilt = clampTilt(tilt);
    if (!bits.length) return empty;
    const kind = isRecv ? "recv" : isPassVol ? "pass-vol" : "pass";
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
    // Soft INT/pressure dampener on pass TD Overs only (not rush TD).
    if (/pass/.test(m) && isOver) {
      const { pressure } = footballPressureIndex({ opp: pack, own });
      if (pressure >= 0.5) tilt -= 0.1;
    }
    return {
      tilt: clampTilt(tilt),
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
  ownPack?: FootballOppDefenseSlice | null;
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
 * Hard-drop only rare NHL Goals/Points Overs (≥1.5) without opp goaltending
 * or vs-opponent history. Unders / Over 0.5 still stage (Match preferred via
 * rank) so phone "5 leg NHL" does not empty when packs are thin
 * (bestEv=5 oddsOk=0 after #562).
 */
export function shouldDropPropMissingOppDefense(opts: {
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  line?: number | null;
  pack?: FootballOppDefenseSlice | null;
  vsOpponentGames?: number | null;
}): boolean {
  const sport = String(opts.sport ?? "").toLowerCase();
  if (sport !== "nhl") return false;
  if (!isNhlScoringMarket(opts.market)) return false;
  if (String(opts.side ?? "").toLowerCase() !== "over") return false;
  const line = opts.line;
  if (line == null || !Number.isFinite(line) || line < 1.5) return false;
  const pack = opts.pack;
  const hasGoalie =
    !!pack && (pack.savePct != null || pack.goalsAgainstAvg != null);
  if (hasGoalie) return false;
  if ((opts.vsOpponentGames ?? 0) > 0) return false;
  return true;
}

/** Soft: NHL scoring prop lacks opp goalie / vs-opponent — demote, don't wipe. */
export function nhlScoringMissingOppContext(opts: {
  sport?: string | null;
  market?: string | null;
  pack?: FootballOppDefenseSlice | null;
  vsOpponentGames?: number | null;
}): boolean {
  const sport = String(opts.sport ?? "").toLowerCase();
  if (sport !== "nhl") return false;
  if (!isNhlScoringMarket(opts.market)) return false;
  const pack = opts.pack;
  const hasGoalie =
    !!pack && (pack.savePct != null || pack.goalsAgainstAvg != null);
  if (hasGoalie) return false;
  if ((opts.vsOpponentGames ?? 0) > 0) return false;
  return true;
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
    // Present Match even for mid-tier D (tilt 0) — bits prove we compared the opponent.
    if (!bits.length) return empty;
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
    // Mid-tier goalies still ground Match (SV%/GAA bits) even when tilt is 0 —
    // phone cards were grey Match because we discarded honest opp context.
    if (!bits.length) return empty;
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
    if (!bits.length) return empty;
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
    if (!bits.length) return empty;
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
  ownPack?: FootballOppDefenseSlice | null;
}): RushDefenseTilt {
  const sport = String(opts.sport ?? "").toLowerCase();
  const hasFootballPack = !!(opts.defense || opts.pack?.rush || opts.pack?.pass);
  const hasFootballMatchup = !!(
    opts.pack?.sacks != null ||
    opts.pack?.sacksAllowed != null ||
    opts.ownPack?.sacksAllowed != null ||
    opts.ownPack?.interceptionPct != null ||
    opts.pack?.interceptions != null
  );
  // Football when sport says so, OR when rush/pass yards are present and sport
  // was omitted (legacy callers / tests) — never invent football from NHL packs.
  if (
    sport === "nfl" ||
    sport === "ncaaf" ||
    ((hasFootballPack || hasFootballMatchup) && !sport)
  ) {
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
 *
 * Binary Anytime/First TD Yes markets have no Under / softer Over — soft tilt
 * already demotes them. Prefer-swap here emptied "5 leg touchdown" (40 graded → 0).
 */
export function shouldPreferDefenseAltPick(opts: {
  sport?: string | null;
  market?: string | null;
  side?: string | null;
  defense?: RushDefenseSlice | null;
  pack?: FootballOppDefenseSlice | null;
  ownPack?: FootballOppDefenseSlice | null;
}): boolean {
  const side = String(opts.side ?? "").toLowerCase();
  if (side !== "over") return false;
  const m = String(opts.market ?? "")
    .toLowerCase()
    .replace(/_/g, " ");
  if (
    /\banytime[_\s]?td\b/.test(m) ||
    /\bfirst[_\s]?td\b/.test(m) ||
    (/\btouchdowns?\b/.test(m) && !/yard|yd|rush|pass|rec|reception/.test(m))
  ) {
    return false;
  }
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
 * Returns null when no alternative exists.
 *
 * Callers MUST keep the original Over when this returns null — wiping emptied
 * "5 leg touchdown" (graded 40 Anytime TDs, no Under/softer alt posted).
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

/**
 * Prefer a defense-aware alt when one is posted; otherwise keep the Over.
 * Soft tilt / odds gate still demote — never empty a TD-only ticket because
 * Anytime TD has no Under rung.
 */
export function keepOrSwapDefenseAwareSide<T extends DefenseAwarePickCandidate>(
  hostileOver: T,
  candidates: readonly T[],
): T {
  return pickDefenseAwareAlt(hostileOver, candidates) ?? hostileOver;
}

/** Alias — blocks any skill-yard OVER vs hard stingy matching D. */
export const shouldBlockSkillOverVsDefense = shouldBlockRushOverVsDefense;
export const footballOppDefenseTilt = footballRushDefenseTilt;
