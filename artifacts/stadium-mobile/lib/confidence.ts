// Single source of truth for the Coach's 0–10 Confidence score and the
// "N confidence"/"9 to 10 confidence" request bound. Confidence is the leg's
// de-vigged fair WIN CHANCE (the price's implied probability plus its real edge),
// expressed on the 0–10 scale — so 9–10 confidence ≈ a ~90%+ win chance. It is
// DECOUPLED from Grade (which rates VALUE): a strong-value coin flip reads a high
// grade but a ~5/10 confidence. So a "9–10 confidence" ask is a request for legs
// that genuinely project a high win chance (heavy chalk / deep cushions), NOT
// merely high edge. The number is never invented — no real price+edge to de-vig
// means a null score, and we NEVER inflate to manufacture a higher one.
//
// PickCard.tsx renders the badge from deriveConfidenceScore(); coach.tsx filters
// resolved legs with the SAME function so every card it shows truly meets the
// requested band. Keep that single source of truth — do not re-derive the score
// anywhere else.

import { winChancePct } from "./pickScore.ts";

export type Variance = "High" | "Medium" | "Low";

// Variance is how much the OUTCOME swings, independent of edge: player props and
// longshot prices are boom-or-bust (High); heavy favorites on game lines are
// steady (Low). Derived from the leg's own market type + price — no invented
// number, just a risk descriptor for the bet's shape.
export function deriveVariance(odds?: number, isProp?: boolean): Variance {
  if (isProp) return "High";
  if (typeof odds === "number") {
    if (odds >= 120) return "High";
    if (odds <= -250) return "Low";
  }
  return "Medium";
}

// Confidence is the leg's de-vigged fair WIN CHANCE on a 0–10 scale (so 58% ->
// 5.8). The honest win chance comes from the picked side's no-vig fair win
// probability (`fairProb`, present on both sides of a two-sided main market) when
// available, else the price's implied probability plus the leg's real edge gap.
// Without either basis we cannot ground a win chance and return null (the leg
// reads "Market price", and a null score can never satisfy a confidence floor).
// Never inflated: a coin-flip price with a thin edge honestly reads ~5/10.
export function deriveConfidenceScore(
  gap: number | null,
  oddsAmerican: number | null | undefined,
  fairProb?: number | null,
): number | null {
  const wc = winChancePct(oddsAmerican, gap, fairProb);
  if (wc === null) return null;
  return Math.round((wc / 10) * 10) / 10;
}

export type ConfidenceThreshold = { min: number; max: number };

const fmtScore = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

// Human-readable description of the requested band, e.g. "9–10/10",
// "8/10 or higher", "6/10 or lower" — used in the honest short-ticket note.
export function describeConfidenceThreshold(t: ConfidenceThreshold): string {
  if (t.min <= 1) return `${fmtScore(t.max)}/10 or lower`;
  if (t.max >= 10) return `${fmtScore(t.min)}/10 or higher`;
  return `${fmtScore(t.min)}–${fmtScore(t.max)}/10`;
}

// Detect a confidence-score bound in free text. The word "confidence" (or
// "conf"/"conviction") MUST be adjacent to the number(s) so a plain leg count
// ("5 leg") can never trip it. Supports a range ("9 to 10", "9-10"), a min
// ("9+", "9 or higher", "at least 9", bare "9"), and a max ("under 8",
// "8 or lower"). Numbers are the 1–10 score scale; "/10" and "out of 10" scale
// suffixes are tolerated. Returns the operative bound or null.
export function parseConfidenceThreshold(
  text: string | null | undefined,
): ConfidenceThreshold | null {
  let t = String(text || "").toLowerCase().replace(/[\u2212\u2013\u2014]/g, "-");
  if (!/\bconf(?:idence)?|\bconviction\b/.test(t)) return null;
  // Collapse scale suffixes so "9/10 confidence" / "9 out of 10 confidence"
  // reduce to "9 confidence". Never touches a range's upper bound ("9 to 10").
  t = t.replace(/\s*(?:out\s+of|\/)\s*10\b/g, "");

  const N = "(\\d{1,2}(?:\\.\\d)?)";
  const CONF = "(?:conf(?:idence)?|conviction)";
  const SEP = "\\s*(?:to|through|thru|and|-)\\s*";
  const MORE = "(?:\\+|or\\s+(?:higher|more|better|up|above|greater))";
  const LESS = "(?:or\\s+(?:less|lower|fewer|below|under))";

  const valid = (n: number) => n >= 1 && n <= 10;
  const clamp = (n: number) => Math.max(1, Math.min(10, n));

  // 1) RANGE — most specific, wins outright. Both number-first
  //    ("9 to 10 confidence") and confidence-first ("confidence 9 to 10").
  const rangePatterns = [
    new RegExp(`${N}${SEP}${N}\\s*(?:${MORE})?\\s*${CONF}`, "i"),
    new RegExp(
      `${CONF}\\s*(?:of|score|level|rating|range|between|in\\s+the)?\\s*(?:range\\s+)?${N}${SEP}${N}`,
      "i",
    ),
  ];
  for (const re of rangePatterns) {
    const m = t.match(re);
    if (m) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      if (valid(a) && valid(b)) {
        return { min: clamp(Math.min(a, b)), max: clamp(Math.max(a, b)) };
      }
    }
  }

  // 2) MAX bound — "under 8 confidence", "confidence below 8", "8 or lower
  //    confidence". {min: 1, max: N}.
  const maxPatterns = [
    new RegExp(
      `${CONF}\\s*(?:of\\s+)?(?:below|under|at\\s+most|max(?:imum)?|no\\s+more\\s+than|<=?)\\s*${N}`,
      "i",
    ),
    new RegExp(`(?:below|under|at\\s+most|no\\s+more\\s+than)\\s*${N}\\s*${CONF}`, "i"),
    new RegExp(`${N}\\s*${LESS}\\s*${CONF}`, "i"),
  ];
  for (const re of maxPatterns) {
    const m = t.match(re);
    if (m) {
      const n = parseFloat(m[1]);
      if (valid(n)) return { min: 1, max: clamp(n) };
    }
  }

  // 3) MIN bound — "9+ confidence", "9 or higher confidence", "confidence of 9
  //    or better", "at least 9 confidence", and finally a bare "9 confidence".
  //    {min: N, max: 10}.
  const minPatterns = [
    new RegExp(`${N}\\s*${MORE}\\s*${CONF}`, "i"),
    new RegExp(
      `${CONF}\\s*(?:of|score|level|rating|at\\s+least|min(?:imum)?|>=?)?\\s*${N}\\s*(?:${MORE})?`,
      "i",
    ),
    new RegExp(`(?:at\\s+least|min(?:imum)?)\\s*${N}\\s*${CONF}`, "i"),
    new RegExp(`${N}\\s*${CONF}`, "i"),
  ];
  for (const re of minPatterns) {
    const m = t.match(re);
    if (m) {
      const n = parseFloat(m[1]);
      if (valid(n)) return { min: clamp(n), max: 10 };
    }
  }

  return null;
}

// Does a single leg's derived confidence satisfy the requested band? A null
// score (the leg has NO stated edge — a pure market-price play) CANNOT meet a
// confidence floor, so it is excluded under any threshold.
export function confidenceSatisfiesThreshold(
  score: number | null,
  thr: ConfidenceThreshold | null,
): boolean {
  if (!thr) return true;
  if (score == null || !Number.isFinite(score)) return false;
  return score >= thr.min && score <= thr.max;
}
