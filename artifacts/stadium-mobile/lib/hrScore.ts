// ----------------------------------------------------------------------------
// Weighted 7-factor HOME-RUN TARGET SCORE — REAL DATA ONLY, honest renormalize.
//
// The user asked for an HR model that blends, with these weights:
//   HR/9 Allowed 25 | Barrel% Allowed 20 | Hard-Hit% Allowed 15 |
//   Fly-Ball Rate 15 | Park Factor 10 | Platoon Split 10 | Weather 5
//
// Every input is a REAL recorded number sourced upstream (ESPN season line,
// Baseball Savant Statcast, static park factor, live weather, season platoon
// split). NOTHING is estimated. The honesty contract:
//   - Each factor maps to a 0..1 "HR favorability" sub-score from its real value.
//   - A missing factor (null, or a Statcast sample too small to trust) is
//     EXCLUDED, never guessed, and its weight is dropped.
//   - The final score renormalizes over ONLY the factors actually present, so a
//     game with no weather (dome) or no Statcast still produces an honest blend
//     of what we DO know — and the excluded list is reported so the UI can say
//     exactly which inputs were unavailable.
//   - With zero present factors the score is null (show "not enough data").
// This is a deterministic, side-effect-free function so it is unit-testable.
// ----------------------------------------------------------------------------

export type HrFactorKey =
  | "hr9"
  | "barrel"
  | "hardhit"
  | "flyball"
  | "park"
  | "platoon"
  | "weather";

export type HrScoreInput = {
  hrPer9?: number | null; // opposing starter HR allowed per 9 IP
  barrelPctAllowed?: number | null; // Statcast barrel% allowed (e.g. 8.4)
  hardHitPctAllowed?: number | null; // Statcast hard-hit% allowed (e.g. 41.2)
  battedBallEvents?: number | null; // Statcast sample size (gates barrel/hard-hit)
  flyBallPct?: number | null; // pitcher FB / (GB + FB), 0..1
  hrIndex?: number | null; // HR park factor (100 = MLB avg)
  tempF?: number | null; // live ballpark temperature (outdoor)
  dome?: boolean | null; // climate-controlled park => weather neutral
  platoonOps?: number | null; // batter OPS vs the starter's hand
};

export type HrFactor = {
  key: HrFactorKey;
  label: string;
  weight: number; // base weight in points (sums to 100 across all 7)
  sub: number | null; // 0..1 HR favorability, null when excluded
  display: string | null; // the REAL value, formatted (null when excluded)
  weightShare: number | null; // renormalized weight % among present factors
  contribution: number | null; // sub * weightShare (points toward the 0..100 score)
};

export type HrScore = {
  score: number | null; // 0..100, null when no factor is present
  factors: HrFactor[]; // all 7, fixed order, present + excluded
  presentCount: number;
  excluded: HrFactorKey[];
};

const BASE_WEIGHTS: Record<HrFactorKey, number> = {
  hr9: 25,
  barrel: 20,
  hardhit: 15,
  flyball: 15,
  park: 10,
  platoon: 10,
  weather: 5,
};

const LABELS: Record<HrFactorKey, string> = {
  hr9: "HR/9 Allowed",
  barrel: "Barrel% Allowed",
  hardhit: "Hard-Hit% Allowed",
  flyball: "Fly-Ball Rate",
  park: "Park Factor",
  platoon: "Platoon Split",
  weather: "Weather",
};

// Minimum Statcast batted-ball sample before barrel% / hard-hit% are trustworthy.
// Below this the rate is too noisy to count — we exclude it rather than mislead.
const MIN_BBE = 40;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// Linear map of a real value onto 0..1 between a "low" (HR-suppressing) and a
// "high" (HR-favoring) anchor, clamped. Anchors are league-context reference
// points, NOT fabricated data — they only scale a real measured number.
const lin = (x: number, lo: number, hi: number): number => clamp01((x - lo) / (hi - lo));

// Format an OPS-style rate as ".812" (drop the leading zero, 3 decimals).
const fmtOps = (n: number): string => {
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
};

export function computeHrScore(input: HrScoreInput): HrScore {
  // Build each factor's real sub-score + display, or null when unavailable.
  const subOf = (key: HrFactorKey): { sub: number | null; display: string | null } => {
    switch (key) {
      case "hr9": {
        const v = input.hrPer9;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        return { sub: lin(v, 0.6, 2.0), display: `${v.toFixed(2)} HR/9` };
      }
      case "barrel": {
        const v = input.barrelPctAllowed;
        const bbe = input.battedBallEvents;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        // Strict sample gate: only count a Statcast rate on a CONFIRMED, meaningful
        // sample. Unknown (null) or too-small a sample => exclude, never guess.
        if (bbe == null || bbe < MIN_BBE) return { sub: null, display: null };
        return { sub: lin(v, 4, 12), display: `${v.toFixed(1)}% barrels` };
      }
      case "hardhit": {
        const v = input.hardHitPctAllowed;
        const bbe = input.battedBallEvents;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        if (bbe == null || bbe < MIN_BBE) return { sub: null, display: null };
        return { sub: lin(v, 30, 48), display: `${v.toFixed(1)}% hard-hit` };
      }
      case "flyball": {
        const v = input.flyBallPct;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        return { sub: lin(v, 0.3, 0.5), display: `${Math.round(v * 100)}% fly balls` };
      }
      case "park": {
        const v = input.hrIndex;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        return { sub: lin(v, 90, 115), display: `${Math.round(v)} index` };
      }
      case "platoon": {
        const v = input.platoonOps;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        return { sub: lin(v, 0.65, 1.0), display: `${fmtOps(v)} OPS vs hand` };
      }
      case "weather": {
        // A climate-controlled park is a REAL fact => weather-neutral (0.5), and
        // it counts as present. Outdoors, temperature is the only reliable real
        // weather signal we have (no trustworthy wind direction). No temp => no
        // weather factor (excluded), never guessed.
        if (input.dome) return { sub: 0.5, display: "Dome (neutral)" };
        const v = input.tempF;
        if (v == null || !Number.isFinite(v)) return { sub: null, display: null };
        return { sub: lin(v, 50, 90), display: `${Math.round(v)}\u00b0F` };
      }
    }
  };

  const keys: HrFactorKey[] = ["hr9", "barrel", "hardhit", "flyball", "park", "platoon", "weather"];
  const raw = keys.map((key) => {
    const { sub, display } = subOf(key);
    return { key, weight: BASE_WEIGHTS[key], sub, display };
  });

  const presentWeight = raw.reduce((acc, f) => acc + (f.sub != null ? f.weight : 0), 0);
  const excluded = raw.filter((f) => f.sub == null).map((f) => f.key);

  const factors: HrFactor[] = raw.map((f) => {
    if (f.sub == null || presentWeight === 0) {
      return {
        key: f.key,
        label: LABELS[f.key],
        weight: f.weight,
        sub: null,
        display: f.display,
        weightShare: null,
        contribution: null,
      };
    }
    const weightShare = (f.weight / presentWeight) * 100;
    return {
      key: f.key,
      label: LABELS[f.key],
      weight: f.weight,
      sub: f.sub,
      display: f.display,
      weightShare,
      contribution: f.sub * weightShare,
    };
  });

  const presentCount = raw.length - excluded.length;
  const score =
    presentWeight === 0
      ? null
      : Math.round(
          factors.reduce((acc, f) => acc + (f.contribution ?? 0), 0),
        );

  return { score, factors, presentCount, excluded };
}

// A short plain-English verdict band for a 0..100 score (UI label only).
export function hrScoreBand(score: number): { label: string; tone: "hot" | "warm" | "neutral" | "cold" } {
  if (score >= 70) return { label: "Strong HR spot", tone: "hot" };
  if (score >= 55) return { label: "Favorable", tone: "warm" };
  if (score >= 40) return { label: "Neutral", tone: "neutral" };
  return { label: "Suppressed", tone: "cold" };
}
