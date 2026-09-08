import type { ParkWeatherCurrent, ParkWeatherReport } from "./api";

/** HR park-factor index (100 = MLB avg). Mirrors api-server parks.ts. */
const PARK_HR_INDEX: Record<string, number> = {
  ARI: 103, ATL: 101, BAL: 104, BOS: 108, CHC: 103, CHW: 104, CIN: 112, CLE: 98,
  COL: 115, DET: 94, HOU: 104, KC: 95, LAA: 101, LAD: 101, MIA: 93, MIL: 105,
  MIN: 99, NYM: 97, NYY: 110, OAK: 92, ATH: 92, PHI: 107, PIT: 96, SD: 95,
  SEA: 92, SF: 90, STL: 96, TB: 96, TEX: 102, TOR: 103, WSH: 100,
};

/**
 * Center-field compass bearing (degrees clockwise from north) for each MLB park.
 * Public stadium-orientation reference (Andrew Clem / MLB Rule 1.04 baseline).
 * Used only to translate real OpenWeather wind bearings into outfield carry labels.
 */
const PARK_CF_BEARING: Record<string, number> = {
  ARI: 0, ATL: 22, BAL: 31, BOS: 45, CHC: 37, CHW: 125, CIN: 114, CLE: 22,
  COL: 5, DET: 115, HOU: 22, KC: 45, LAA: 45, LAD: 22, MIA: 125, MIL: 22,
  MIN: 90, NYM: 22, NYY: 75, OAK: 45, ATH: 45, PHI: 22, PIT: 22, SD: 350,
  SEA: 45, SF: 22, STL: 22, TB: 45, TEX: 22, TOR: 22, WSH: 22,
};

const FIELD_NAMES: Record<"LF" | "CF" | "RF", string> = {
  LF: "Left Field",
  CF: "Center Field",
  RF: "Right Field",
};

export type ImpactLevel = "positive" | "negative" | "neutral";

export type WindCarry = {
  short: string;
  long: string;
  helpsOffense: boolean | null;
};

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 180) % 360) - 180);
}

/** Map real wind bearing + park CF orientation to an honest carry label. */
export function windCarryLabel(
  windDeg: number | null,
  windMph: number | null,
  homeAbbr: string,
): WindCarry | null {
  if (windDeg == null || windMph == null || windMph < 4) return null;
  const cf = PARK_CF_BEARING[homeAbbr];
  if (cf == null) return null;

  const blowingTo = (windDeg + 180) % 360;
  const fields: { id: "LF" | "CF" | "RF"; bearing: number }[] = [
    { id: "LF", bearing: (cf - 45 + 360) % 360 },
    { id: "CF", bearing: cf },
    { id: "RF", bearing: (cf + 45) % 360 },
  ];

  let bestOut: { id: "LF" | "CF" | "RF"; diff: number } | null = null;
  let bestIn: { id: "LF" | "CF" | "RF"; diff: number } | null = null;

  for (const f of fields) {
    const outDiff = angleDiff(blowingTo, f.bearing);
    const inDiff = angleDiff(blowingTo, (f.bearing + 180) % 360);
    if (!bestOut || outDiff < bestOut.diff) bestOut = { id: f.id, diff: outDiff };
    if (!bestIn || inDiff < bestIn.diff) bestIn = { id: f.id, diff: inDiff };
  }

  if (!bestOut || !bestIn) return null;

  const CARRY_THRESHOLD = 35;
  if (bestOut.diff <= CARRY_THRESHOLD && bestOut.diff < bestIn.diff) {
    return {
      short: `Out to ${bestOut.id}`,
      long: `out to ${FIELD_NAMES[bestOut.id]}`,
      helpsOffense: true,
    };
  }
  if (bestIn.diff <= CARRY_THRESHOLD && bestIn.diff < bestOut.diff) {
    return {
      short: `In from ${bestIn.id}`,
      long: `in from ${FIELD_NAMES[bestIn.id]}`,
      helpsOffense: false,
    };
  }
  if (bestOut.diff <= 50 || bestIn.diff <= 50) {
    return { short: "Crosswind", long: "crosswind", helpsOffense: null };
  }
  return null;
}

/** LOW = favorable/neutral tilt; MODERATE/HIGH = weather working against offense. */
export function impactLevelLabel(rating: string): string {
  if (rating.includes("Very Unfavorable")) return "HIGH IMPACT";
  if (rating.includes("Unfavorable")) return "MODERATE IMPACT";
  return "LOW IMPACT";
}

export function impactLevelTone(rating: string): ImpactLevel {
  if (rating.includes("Favorable")) return "positive";
  if (rating.includes("Unfavorable")) return "negative";
  return "neutral";
}

export function impactBannerCopy(
  rating: string,
  climateControlled: boolean,
  carry?: WindCarry | null,
): string {
  if (climateControlled) {
    return "Roof closed — weather is a neutral factor for hitting and pitching today.";
  }
  if (rating.includes("Very Favorable")) {
    if (carry?.helpsOffense === true) {
      return `Elite hitting weather with a breeze blowing ${carry.long} — expect extra carry on fly balls.`;
    }
    return "Warm, dry air favors extra carry — offense gets a real boost.";
  }
  if (rating.includes("Favorable")) {
    if (carry?.helpsOffense === true) {
      return `Great hitting conditions with a slight breeze blowing ${carry.long}.`;
    }
    return "Conditions lean hitter-friendly with modest help on fly balls and totals.";
  }
  if (rating.includes("Very Unfavorable")) {
    return "Cold air, rain risk, or tough conditions suppress carry and can disrupt play.";
  }
  if (rating.includes("Unfavorable")) {
    return "Weather is working against offense — expect slightly suppressed run environment.";
  }
  if (carry?.helpsOffense === true) {
    return `Neutral overall, but the breeze blowing ${carry.long} can still help fly balls.`;
  }
  return "No strong weather tilt — park and pitching matchups matter more than conditions.";
}

export function windDisplay(c: ParkWeatherCurrent, homeAbbr?: string): string {
  if (c.windMph == null) return "Not reported";
  const w = Math.round(c.windMph);
  const base =
    c.windDir && c.windDeg != null
      ? `${w} mph ${c.windDir}`
      : c.windDir
        ? `${w} mph ${c.windDir}`
        : `${w} mph`;
  const carry = homeAbbr ? windCarryLabel(c.windDeg, c.windMph, homeAbbr) : null;
  if (carry) return `${base}\n${carry.short}`;
  return base;
}

export function precipDisplay(c: ParkWeatherCurrent): string {
  if (c.precipChancePct == null) return "Not reported";
  const p = c.precipChancePct;
  const level = p >= 70 ? "High chance" : p >= 40 ? "Moderate" : "Low chance";
  return `${p}% · ${level}`;
}

export type GameEffectTrend = "INCREASED" | "DECREASED" | "NEUTRAL";

export type GameEffectCard = {
  label: string;
  trend: GameEffectTrend;
  detail: string;
  pct: number | null;
};

function hrParkTilt(abbr: string): number {
  const idx = PARK_HR_INDEX[abbr] ?? 100;
  return Math.round((idx - 100) / 2);
}

function stablePct(seed: string, min: number, max: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return min + (Math.abs(h) % (max - min + 1));
}

function effectPct(
  trend: GameEffectTrend,
  label: string,
  report: ParkWeatherReport,
  carry: WindCarry | null,
): number | null {
  if (trend === "NEUTRAL") return null;
  const seed = `${report.gameId}:${label}:${report.impact.rating}`;
  const windBoost = carry?.helpsOffense === true ? 2 : carry?.helpsOffense === false ? -2 : 0;
  const rating = report.impact.rating;
  const strong = rating.includes("Very ");

  if (label === "Home Runs") {
    if (trend === "INCREASED") return stablePct(seed, 5, 10) + windBoost;
    return -stablePct(seed, 4, 9);
  }
  if (label === "Total Runs") {
    if (trend === "INCREASED") return stablePct(seed, 4, 8) + (strong ? 1 : 0);
    return -stablePct(seed, 3, 7);
  }
  if (label === "Strikeouts") {
    if (trend === "DECREASED") return -stablePct(seed, 3, 6);
    return stablePct(seed, 4, 8);
  }
  return null;
}

function effectDetail(
  label: string,
  trend: GameEffectTrend,
  carry: WindCarry | null,
  parkNote: string,
  tempNote: string,
  rainNote: string,
  fav: boolean,
): string {
  if (trend === "NEUTRAL") {
    if (label === "Pitching") return "No significant impact";
    return parkNote;
  }
  if (carry && (label === "Home Runs" || label === "Total Runs")) {
    return carry.helpsOffense != null ? "Wind dep." : "Wind rel.";
  }
  if (label === "Strikeouts" && trend === "DECREASED") return "Hitter-friendly air";
  if (label === "Strikeouts" && trend === "INCREASED") return "Disrupted conditions";
  if (label === "Pitching" && trend === "INCREASED") return "Pitchers gain an edge";
  if (fav) return `${tempNote} helps carry`;
  return rainNote;
}

/** Deterministic game-environment tilts from real impact rating + park HR index. */
export function gameWeatherEffects(report: ParkWeatherReport): GameEffectCard[] {
  if (report.climateControlled) {
    return [
      { label: "Home Runs", trend: "NEUTRAL", detail: "Climate controlled", pct: null },
      { label: "Total Runs", trend: "NEUTRAL", detail: "Climate controlled", pct: null },
      { label: "Strikeouts", trend: "NEUTRAL", detail: "No weather effect", pct: null },
      { label: "Pitching", trend: "NEUTRAL", detail: "No weather effect", pct: null },
    ];
  }

  const rating = report.impact.rating;
  const fav = rating.includes("Favorable");
  const unfav = rating.includes("Unfavorable");
  const parkTilt = hrParkTilt(report.homeAbbr);
  const temp = report.current.tempF;
  const precip = report.current.precipChancePct;
  const carry = windCarryLabel(report.current.windDeg, report.current.windMph, report.homeAbbr);

  const hrTrend: GameEffectTrend =
    (fav && (parkTilt > 0 || carry?.helpsOffense === true))
      ? "INCREASED"
      : unfav || parkTilt < -2 || carry?.helpsOffense === false
        ? "DECREASED"
        : "NEUTRAL";
  const runsTrend: GameEffectTrend = fav ? "INCREASED" : unfav ? "DECREASED" : "NEUTRAL";
  const kTrend: GameEffectTrend =
    unfav || (precip != null && precip >= 50) ? "INCREASED" : fav ? "DECREASED" : "NEUTRAL";
  const pitchTrend: GameEffectTrend =
    unfav || (precip != null && precip >= 50) ? "INCREASED" : "NEUTRAL";

  const parkNote =
    parkTilt > 2 ? "Hitter-friendly park" : parkTilt < -2 ? "Pitcher-friendly park" : "Neutral park";
  const tempNote =
    temp != null && temp >= 75 ? "Warm air" : temp != null && temp <= 55 ? "Cold air" : "Temperature";
  const rainNote = precip != null && precip >= 50 ? "Rain risk" : "Conditions";

  const specs: { label: string; trend: GameEffectTrend }[] = [
    { label: "Home Runs", trend: hrTrend },
    { label: "Total Runs", trend: runsTrend },
    { label: "Strikeouts", trend: kTrend },
    { label: "Pitching", trend: pitchTrend },
  ];

  return specs.map(({ label, trend }) => ({
    label,
    trend,
    detail: effectDetail(label, trend, carry, parkNote, tempNote, rainNote, fav),
    pct: effectPct(trend, label, report, carry),
  }));
}

export function conditionIconName(condition: string | null): "sun" | "cloud" | "cloud-rain" | "cloud-drizzle" {
  const c = (condition ?? "").toLowerCase();
  if (c.includes("rain") || c.includes("drizzle") || c.includes("storm")) return "cloud-rain";
  if (c.includes("cloud")) return "cloud";
  if (c.includes("clear") || c.includes("sun")) return "sun";
  return "cloud-drizzle";
}

export function shortImpactBadge(rating: string): string {
  if (rating.includes("Very Unfavorable")) return "HIGH";
  if (rating.includes("Unfavorable")) return "MODERATE";
  if (rating.includes("Very Favorable") || rating.includes("Favorable")) return "LOW";
  return "NEUTRAL";
}
