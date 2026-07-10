import type { ParkWeatherCurrent, ParkWeatherReport } from "./api";

/** HR park-factor index (100 = MLB avg). Mirrors api-server parks.ts. */
const PARK_HR_INDEX: Record<string, number> = {
  ARI: 103, ATL: 101, BAL: 104, BOS: 108, CHC: 103, CHW: 104, CIN: 112, CLE: 98,
  COL: 115, DET: 94, HOU: 104, KC: 95, LAA: 101, LAD: 101, MIA: 93, MIL: 105,
  MIN: 99, NYM: 97, NYY: 110, OAK: 92, ATH: 92, PHI: 107, PIT: 96, SD: 95,
  SEA: 92, SF: 90, STL: 96, TB: 96, TEX: 102, TOR: 103, WSH: 100,
};

export type ImpactLevel = "positive" | "negative" | "neutral";

export function impactLevelLabel(rating: string): string {
  if (rating.includes("Very Favorable") || rating.includes("Very Unfavorable")) return "HIGH IMPACT";
  if (rating.includes("Favorable") || rating.includes("Unfavorable")) return "MODERATE IMPACT";
  return "LOW IMPACT";
}

export function impactLevelTone(rating: string): ImpactLevel {
  if (rating.includes("Favorable")) return "positive";
  if (rating.includes("Unfavorable")) return "negative";
  return "neutral";
}

export function impactBannerCopy(rating: string, climateControlled: boolean): string {
  if (climateControlled) {
    return "Roof closed — weather is a neutral factor for hitting and pitching today.";
  }
  if (rating.includes("Very Favorable")) {
    return "Warm, dry air and light wind favor extra carry — offense gets a real boost.";
  }
  if (rating.includes("Favorable")) {
    return "Conditions lean hitter-friendly with modest help on fly balls and totals.";
  }
  if (rating.includes("Very Unfavorable")) {
    return "Cold air, rain risk, or tough conditions suppress carry and can disrupt play.";
  }
  if (rating.includes("Unfavorable")) {
    return "Weather is working against offense — expect slightly suppressed run environment.";
  }
  return "No strong weather tilt — park and pitching matchups matter more than conditions.";
}

export function windDisplay(c: ParkWeatherCurrent): string {
  if (c.windMph == null) return "Not reported";
  const w = Math.round(c.windMph);
  if (c.windDir && c.windDeg != null) return `${w} mph ${c.windDir}`;
  if (c.windDir) return `${w} mph ${c.windDir}`;
  return `${w} mph`;
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
};

function hrParkTilt(abbr: string): number {
  const idx = PARK_HR_INDEX[abbr] ?? 100;
  return Math.round((idx - 100) / 2);
}

/** Deterministic game-environment tilts from real impact rating + park HR index. */
export function gameWeatherEffects(report: ParkWeatherReport): GameEffectCard[] {
  if (report.climateControlled) {
    return [
      { label: "Home Runs", trend: "NEUTRAL", detail: "Climate controlled" },
      { label: "Total Runs", trend: "NEUTRAL", detail: "Climate controlled" },
      { label: "Strikeouts", trend: "NEUTRAL", detail: "No weather effect" },
      { label: "Pitching", trend: "NEUTRAL", detail: "No weather effect" },
    ];
  }

  const rating = report.impact.rating;
  const fav = rating.includes("Favorable");
  const unfav = rating.includes("Unfavorable");
  const parkTilt = hrParkTilt(report.homeAbbr);
  const temp = report.current.tempF;
  const precip = report.current.precipChancePct;

  const hrTrend: GameEffectTrend =
    fav && parkTilt > 0 ? "INCREASED" : unfav || parkTilt < -2 ? "DECREASED" : "NEUTRAL";
  const runsTrend: GameEffectTrend = fav ? "INCREASED" : unfav ? "DECREASED" : "NEUTRAL";
  const kTrend: GameEffectTrend = unfav || (precip != null && precip >= 50) ? "INCREASED" : fav ? "DECREASED" : "NEUTRAL";
  const pitchTrend: GameEffectTrend =
    unfav || (precip != null && precip >= 50) ? "INCREASED" : "NEUTRAL";

  const parkNote =
    parkTilt > 2 ? "Hitter-friendly park" : parkTilt < -2 ? "Pitcher-friendly park" : "Neutral park";
  const tempNote =
    temp != null && temp >= 75 ? "Warm air" : temp != null && temp <= 55 ? "Cold air" : "Temperature";
  const rainNote = precip != null && precip >= 50 ? "Rain risk" : "Conditions";

  return [
    {
      label: "Home Runs",
      trend: hrTrend,
      detail: hrTrend === "NEUTRAL" ? parkNote : fav ? `${tempNote} + ${parkNote.toLowerCase()}` : rainNote,
    },
    {
      label: "Total Runs",
      trend: runsTrend,
      detail: runsTrend === "NEUTRAL" ? "Balanced environment" : fav ? `${tempNote} helps carry` : rainNote,
    },
    {
      label: "Strikeouts",
      trend: kTrend,
      detail: kTrend === "INCREASED" ? "Disrupted conditions" : kTrend === "DECREASED" ? "Hitter-friendly air" : "No significant tilt",
    },
    {
      label: "Pitching",
      trend: pitchTrend,
      detail: pitchTrend === "INCREASED" ? "Pitchers gain an edge" : "Neutral for arms",
    },
  ];
}

export function conditionIconName(condition: string | null): "sun" | "cloud" | "cloud-rain" | "cloud-drizzle" {
  const c = (condition ?? "").toLowerCase();
  if (c.includes("rain") || c.includes("drizzle") || c.includes("storm")) return "cloud-rain";
  if (c.includes("cloud")) return "cloud";
  if (c.includes("clear") || c.includes("sun")) return "sun";
  return "cloud-drizzle";
}

export function shortImpactBadge(rating: string): string {
  if (rating.includes("Very Favorable") || rating.includes("Favorable")) return "FAVORABLE";
  if (rating.includes("Very Unfavorable") || rating.includes("Unfavorable")) return "UNFAVORABLE";
  return "NEUTRAL";
}
