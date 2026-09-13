/** Trim alternate prop rungs before responding — keeps UI/chat lean by default. */

export type PropAltRow = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  alt: boolean;
};

export function canonicalPropMarket(market: string): string {
  let k = String(market ?? "").trim().toLowerCase();
  if (k.endsWith("_alternate")) k = k.slice(0, -"_alternate".length);
  k = k.replace(/_(q1|q2|q3|q4|h1|h2|1h|2h|f5)$/i, "");
  return k;
}

const YARDS_FAMILY = new Set([
  "player_rush_yds",
  "player_pass_yds",
  "player_reception_yds",
]);

const FULL_BOARD_NUMERIC_FAMILY = new Set([
  ...YARDS_FAMILY,
  "player_pass_attempts",
  "player_pass_completions",
  "player_rush_attempts",
]);

export function isYardsFamilyMarket(market: string): boolean {
  return YARDS_FAMILY.has(canonicalPropMarket(market));
}

export function isFullBoardNumericFamily(market: string): boolean {
  return FULL_BOARD_NUMERIC_FAMILY.has(canonicalPropMarket(market));
}

function inPriceBand(overPrice: number | null, underPrice: number | null): boolean {
  const inBand = (p: number | null) => p != null && p >= -600 && p <= 600;
  return inBand(overPrice) || inBand(underPrice);
}

/** Common milestone alt numbers books post (99.5, 124.5, 149.5, 174.5, …). */
export function isMilestonePropLine(line: number, market: string): boolean {
  if (!Number.isFinite(line)) return false;
  const canon = canonicalPropMarket(market);
  const whole = Math.round(line);
  const onQuarter = Math.abs(line - whole) <= 0.6 && whole % 25 <= 1;
  if (!onQuarter) return false;
  if (canon === "player_reception_yds") return whole >= 50;
  if (YARDS_FAMILY.has(canon)) return whole >= 75;
  if (canon === "player_pass_attempts" || canon === "player_pass_completions") return whole >= 20;
  if (canon === "player_rush_attempts") return whole >= 10;
  return false;
}

const ALT_CAP_DEFAULT = 12;
const ALT_CAP_FULL_BOARD_NEAREST = 12;
const ALT_CAP_FULL_BOARD_HIGH = 10;

function sortAltsByMainDistance<T extends PropAltRow>(list: T[], mainLine: number | undefined): T[] {
  return [...list].sort((a, b) => {
    const da = a.line != null ? Math.abs(a.line - (mainLine ?? 0)) : Infinity;
    const db = b.line != null ? Math.abs(b.line - (mainLine ?? 0)) : Infinity;
    return da - db;
  });
}

/**
 * Per (player, market) keep bettable alt rungs near the main line.
 * fullBoard mode (Coach scan only) also keeps milestone yard/attempt numbers
 * that are too far from main for the default 12-nearest cap (150 / 175 / …).
 */
export function trimAlternatePropRungs<T extends PropAltRow>(
  allRows: T[],
  opts?: { fullBoard?: boolean },
): T[] {
  const fullBoard = !!opts?.fullBoard;
  const mainLineByPM = new Map<string, number>();
  for (const r of allRows) {
    if (!r.alt && r.line != null) {
      const pm = `${r.player}|${r.market}`;
      if (!mainLineByPM.has(pm)) mainLineByPM.set(pm, r.line);
    }
  }

  const altByPM = new Map<string, T[]>();
  for (const r of allRows) {
    if (!r.alt) continue;
    if (!inPriceBand(r.overPrice, r.underPrice)) continue;
    const pm = `${r.player}|${r.market}`;
    const list = altByPM.get(pm) ?? [];
    list.push(r);
    altByPM.set(pm, list);
  }

  const trimmedAlts: T[] = [];
  for (const [pm, list] of altByPM) {
    const mainLine = mainLineByPM.get(pm);
    const market = pm.slice(pm.indexOf("|") + 1);
    const sorted = sortAltsByMainDistance(list, mainLine);

    if (!fullBoard || !isFullBoardNumericFamily(market)) {
      trimmedAlts.push(...sorted.slice(0, ALT_CAP_DEFAULT));
      continue;
    }

    const picked = new Map<number, T>();
    for (const r of sorted.slice(0, ALT_CAP_FULL_BOARD_NEAREST)) {
      if (r.line != null) picked.set(r.line, r);
    }
    for (const r of sorted) {
      if (r.line != null && isMilestonePropLine(r.line, market)) {
        picked.set(r.line, r);
      }
    }
    const high = sorted
      .filter((r) => r.line != null && r.line >= (mainLine ?? 0) + 35)
      .sort((a, b) => (b.line ?? 0) - (a.line ?? 0))
      .slice(0, ALT_CAP_FULL_BOARD_HIGH);
    for (const r of high) {
      if (r.line != null) picked.set(r.line, r);
    }
    trimmedAlts.push(...picked.values());
  }
  return trimmedAlts;
}

/** Mains first, then trimmed alts — same order the props route has always used. */
export function aggregatePropRowsWithAltTrim<T extends PropAltRow>(
  allRows: T[],
  opts?: { fullBoard?: boolean },
): T[] {
  const mains = allRows.filter((r) => !r.alt);
  const trimmedAlts = trimAlternatePropRungs(allRows, opts);
  return [...mains, ...trimmedAlts];
}
