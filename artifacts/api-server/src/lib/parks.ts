// ----------------------------------------------------------------------------
// Ballpark reference data + pure weather-impact helpers (single source of truth).
//
// hrIndex is a multi-year HR park-factor index where 100 = MLB average (>100
// boosts home runs, <100 suppresses). These are established public reference
// values, NOT a fabricated per-game number. altitudeFt and lat/lon are real
// stadium facts; dome marks fixed/retractable-roof parks (weather neutral).
// Keyed by ESPN team abbreviation.
//
// Everything here is pure (no I/O, no db imports) so it can be unit-tested with
// `node --test`. The weather-impact rating is computed deterministically from
// REAL OpenWeather values — it is never a guessed percentage.
// ----------------------------------------------------------------------------

export type Park = {
  hrIndex: number;
  altitudeFt: number;
  dome: boolean;
  lat: number;
  lon: number;
};

export const MLB_PARKS: Record<string, Park> = {
  ARI: { hrIndex: 103, altitudeFt: 1059, dome: true, lat: 33.4455, lon: -112.0667 },
  ATL: { hrIndex: 101, altitudeFt: 1050, dome: false, lat: 33.8907, lon: -84.4677 },
  BAL: { hrIndex: 104, altitudeFt: 33, dome: false, lat: 39.2839, lon: -76.6217 },
  BOS: { hrIndex: 108, altitudeFt: 20, dome: false, lat: 42.3467, lon: -71.0972 },
  CHC: { hrIndex: 103, altitudeFt: 600, dome: false, lat: 41.9484, lon: -87.6553 },
  CHW: { hrIndex: 104, altitudeFt: 595, dome: false, lat: 41.83, lon: -87.6339 },
  CIN: { hrIndex: 112, altitudeFt: 490, dome: false, lat: 39.0975, lon: -84.5069 },
  CLE: { hrIndex: 98, altitudeFt: 660, dome: false, lat: 41.4962, lon: -81.6852 },
  COL: { hrIndex: 115, altitudeFt: 5200, dome: false, lat: 39.7559, lon: -104.9942 },
  DET: { hrIndex: 94, altitudeFt: 600, dome: false, lat: 42.339, lon: -83.0485 },
  HOU: { hrIndex: 104, altitudeFt: 40, dome: true, lat: 29.7572, lon: -95.3556 },
  KC: { hrIndex: 95, altitudeFt: 750, dome: false, lat: 39.0517, lon: -94.4803 },
  LAA: { hrIndex: 101, altitudeFt: 153, dome: false, lat: 33.8003, lon: -117.8827 },
  LAD: { hrIndex: 101, altitudeFt: 522, dome: false, lat: 34.0739, lon: -118.24 },
  MIA: { hrIndex: 93, altitudeFt: 10, dome: true, lat: 25.7781, lon: -80.2197 },
  MIL: { hrIndex: 105, altitudeFt: 635, dome: true, lat: 43.028, lon: -87.9712 },
  MIN: { hrIndex: 99, altitudeFt: 815, dome: false, lat: 44.9817, lon: -93.2776 },
  NYM: { hrIndex: 97, altitudeFt: 20, dome: false, lat: 40.7571, lon: -73.8458 },
  NYY: { hrIndex: 110, altitudeFt: 55, dome: false, lat: 40.8296, lon: -73.9262 },
  OAK: { hrIndex: 92, altitudeFt: 30, dome: false, lat: 38.5803, lon: -121.5133 },
  ATH: { hrIndex: 92, altitudeFt: 30, dome: false, lat: 38.5803, lon: -121.5133 },
  PHI: { hrIndex: 107, altitudeFt: 60, dome: false, lat: 39.9061, lon: -75.1665 },
  PIT: { hrIndex: 96, altitudeFt: 730, dome: false, lat: 40.4469, lon: -80.0057 },
  SD: { hrIndex: 95, altitudeFt: 62, dome: false, lat: 32.7073, lon: -117.157 },
  SEA: { hrIndex: 92, altitudeFt: 10, dome: true, lat: 47.5914, lon: -122.3325 },
  SF: { hrIndex: 90, altitudeFt: 10, dome: false, lat: 37.7786, lon: -122.3893 },
  STL: { hrIndex: 96, altitudeFt: 465, dome: false, lat: 38.6226, lon: -90.1928 },
  TB: { hrIndex: 96, altitudeFt: 15, dome: true, lat: 27.7682, lon: -82.6534 },
  TEX: { hrIndex: 102, altitudeFt: 545, dome: true, lat: 32.7473, lon: -97.0832 },
  TOR: { hrIndex: 103, altitudeFt: 250, dome: true, lat: 43.6414, lon: -79.3894 },
  WSH: { hrIndex: 100, altitudeFt: 25, dome: false, lat: 38.873, lon: -77.0074 },
};

// Display-only stadium name + city (real public reference). Keyed by the same
// ESPN team abbreviation as MLB_PARKS.
export const PARK_META: Record<string, { name: string; city: string }> = {
  ARI: { name: "Chase Field", city: "Phoenix, AZ" },
  ATL: { name: "Truist Park", city: "Atlanta, GA" },
  BAL: { name: "Oriole Park at Camden Yards", city: "Baltimore, MD" },
  BOS: { name: "Fenway Park", city: "Boston, MA" },
  CHC: { name: "Wrigley Field", city: "Chicago, IL" },
  CHW: { name: "Rate Field", city: "Chicago, IL" },
  CIN: { name: "Great American Ball Park", city: "Cincinnati, OH" },
  CLE: { name: "Progressive Field", city: "Cleveland, OH" },
  COL: { name: "Coors Field", city: "Denver, CO" },
  DET: { name: "Comerica Park", city: "Detroit, MI" },
  HOU: { name: "Daikin Park", city: "Houston, TX" },
  KC: { name: "Kauffman Stadium", city: "Kansas City, MO" },
  LAA: { name: "Angel Stadium", city: "Anaheim, CA" },
  LAD: { name: "Dodger Stadium", city: "Los Angeles, CA" },
  MIA: { name: "loanDepot Park", city: "Miami, FL" },
  MIL: { name: "American Family Field", city: "Milwaukee, WI" },
  MIN: { name: "Target Field", city: "Minneapolis, MN" },
  NYM: { name: "Citi Field", city: "New York, NY" },
  NYY: { name: "Yankee Stadium", city: "Bronx, NY" },
  OAK: { name: "Sutter Health Park", city: "West Sacramento, CA" },
  ATH: { name: "Sutter Health Park", city: "West Sacramento, CA" },
  PHI: { name: "Citizens Bank Park", city: "Philadelphia, PA" },
  PIT: { name: "PNC Park", city: "Pittsburgh, PA" },
  SD: { name: "Petco Park", city: "San Diego, CA" },
  SEA: { name: "T-Mobile Park", city: "Seattle, WA" },
  SF: { name: "Oracle Park", city: "San Francisco, CA" },
  STL: { name: "Busch Stadium", city: "St. Louis, MO" },
  TB: { name: "Tropicana Field", city: "St. Petersburg, FL" },
  TEX: { name: "Globe Life Field", city: "Arlington, TX" },
  TOR: { name: "Rogers Centre", city: "Toronto, ON" },
  WSH: { name: "Nationals Park", city: "Washington, DC" },
};

// Compass label for a meteorological wind bearing (degrees the wind blows FROM).
// Real OpenWeather wind.deg in -> "NW" style label out. We report the bearing
// honestly; we never claim "blowing out to RF" because that needs each park's
// orientation, which we do not have.
const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];
export function degToCompass(deg: number): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i] ?? "N";
}

export type WeatherImpactRating =
  | "Very Favorable"
  | "Favorable"
  | "Neutral"
  | "Unfavorable"
  | "Very Unfavorable";

export type WeatherImpactInput = {
  climateControlled: boolean;
  tempF: number | null;
  precipChancePct: number | null;
  windMph: number | null;
  windDir: string | null;
};

// Deterministic hitting-environment impact from REAL weather values. "Favorable"
// is from the offense's point of view: warm, dry air helps the ball carry and
// keeps play clean; cold air and a high rain chance work against it. Wind SPEED
// is described factually but does not move the rating up or down, because we do
// not know the park orientation needed to say whether it blows out or in. Any
// field OpenWeather did not return is left OUT of both the score and the summary
// — it is never defaulted to a fabricated value, and when no usable reading is
// available we say so plainly instead of inventing a verdict.
export function computeWeatherImpact(
  input: WeatherImpactInput,
): { rating: WeatherImpactRating; summary: string } {
  const { tempF, precipChancePct, windMph, windDir } = input;

  if (input.climateControlled) {
    return {
      rating: "Neutral",
      summary:
        "This ballpark has a roof, so conditions are controlled and the weather is a neutral factor for today's game.",
    };
  }

  // No usable real readings → we cannot rate the environment, so we say so
  // rather than invent a favorable/unfavorable verdict.
  if (tempF == null && precipChancePct == null) {
    return {
      rating: "Neutral",
      summary:
        "Live weather readings are limited for this park right now, so conditions are treated as a neutral factor.",
    };
  }

  const t = tempF != null ? Math.round(tempF) : null;

  let score = 0;
  // Temperature: warm air is less dense, so the ball carries; cold air holds it.
  if (t != null) {
    if (t >= 85) score += 2;
    else if (t >= 75) score += 1;
    else if (t >= 60) score += 0;
    else if (t >= 50) score -= 1;
    else score -= 2;
  }

  // Rain risk works against clean offense and can delay or shorten play. When
  // the chance is unknown we leave the score unchanged rather than assume zero.
  if (precipChancePct != null) {
    if (precipChancePct >= 70) score -= 2;
    else if (precipChancePct >= 40) score -= 1;
  }

  const rating: WeatherImpactRating =
    score >= 2
      ? "Very Favorable"
      : score === 1
        ? "Favorable"
        : score === 0
          ? "Neutral"
          : score === -1
            ? "Unfavorable"
            : "Very Unfavorable";

  const parts: string[] = [];
  if (t != null) {
    if (t >= 85) parts.push(`hot ${t}°F air helps the ball carry`);
    else if (t >= 75) parts.push(`warm ${t}°F air gives the ball a little extra carry`);
    else if (t >= 60) parts.push(`mild ${t}°F temperatures have only a modest effect on carry`);
    else if (t >= 50) parts.push(`cool ${t}°F air will slightly suppress carry`);
    else parts.push(`cold ${t}°F air will hold the ball down`);
  }

  if (windMph != null) {
    const w = Math.round(windMph);
    const dir = windDir ? ` out of the ${windDir}` : "";
    if (w >= 8) parts.push(`winds around ${w} mph${dir}`);
    else parts.push(`light winds near ${w} mph`);
  }

  if (precipChancePct != null) {
    if (precipChancePct >= 70)
      parts.push(`a high ${precipChancePct}% chance of rain that could delay or disrupt play`);
    else if (precipChancePct >= 40)
      parts.push(`a ${precipChancePct}% chance of rain worth watching`);
    else if (precipChancePct >= 15) parts.push(`a low ${precipChancePct}% rain chance`);
  }

  let summary = parts.join(", ");
  const lastComma = summary.lastIndexOf(", ");
  if (lastComma !== -1) {
    summary = summary.slice(0, lastComma) + ", and " + summary.slice(lastComma + 2);
  }
  summary = summary.length
    ? summary.charAt(0).toUpperCase() + summary.slice(1) + "."
    : "Live weather readings are limited for this park right now.";
  return { rating, summary };
}
