// ----------------------------------------------------------------------------
// HR GREEN / RED FLAGS — a scannable checklist that mirrors the user's HR rubric,
// evaluated ONLY from REAL matchup data. Complementary to the weighted HR Target
// Score (hrScore.ts): the score blends signals into one number; the flags answer
// "which specific good/bad HR conditions are actually present right now?".
//
// Honesty contract (same as hrScore):
//   - A flag lights ONLY when its underlying REAL datum exists AND crosses the
//     rubric threshold. A value between the green and red thresholds is neutral —
//     it produces NO flag (not a fake "ok").
//   - A missing datum produces NO flag — never a guess.
//   - The rubric lists "wind blowing out" (green) and "wind blowing in" (red),
//     but our weather feed carries wind SPEED ONLY, no direction. Those two flags
//     are therefore UNKNOWABLE and are OMITTED; `windOmitted` lets the UI say so.
//   - Statcast rates (barrel% / hard-hit% allowed) only count on a confirmed,
//     meaningful batted-ball sample (>= MIN_BBE) — same gate as the score.
// Deterministic and side-effect-free so it is unit-testable.
//
// Rubric thresholds (user-provided):
//   GREEN: HR/9 >= 1.4 | opp OPS >= .750 | high fly-ball | low K-rate |
//          hard-hit allowed >= 40% | barrel allowed >= 8% | platoon advantage |
//          hitter-friendly park | wind blowing out (UNKNOWABLE — omitted)
//   RED:   HR/9 < 1.0 | opp OPS < .650 | ground-ball pitcher | 9+ K/9 |
//          cold weather | wind blowing in (UNKNOWABLE — omitted) | pitcher's park
// ----------------------------------------------------------------------------

export type HrFlagTone = "green" | "red";

export type HrFlag = {
  key: string;
  tone: HrFlagTone;
  label: string;
  value: string; // the REAL number/fact that lit this flag
};

export type HrFlagsInput = {
  hrPer9?: number | null;
  oppOPS?: number | null;
  flyBallPct?: number | null; // pitcher FB / (GB + FB), 0..1
  kPer9?: number | null;
  hardHitPctAllowed?: number | null; // Statcast, gated by battedBallEvents
  barrelPctAllowed?: number | null; // Statcast, gated by battedBallEvents
  battedBallEvents?: number | null; // Statcast sample size
  batterHand?: "L" | "R" | "S" | null; // batter's hand
  pitcherThrows?: "L" | "R" | null; // opposing starter's hand
  hrIndex?: number | null; // park HR factor, 100 = MLB avg
  venue?: string | null;
  tempF?: number | null; // live ballpark temperature (outdoor)
  dome?: boolean | null; // climate-controlled park => no weather flags
};

export type HrFlags = {
  green: HrFlag[];
  red: HrFlag[];
  // True when the game is outdoors (so wind COULD matter) but we have no wind
  // direction in the feed — drives the "wind flags omitted" transparency note.
  windOmitted: boolean;
};

// Statcast batted-ball sample floor — mirrors hrScore.MIN_BBE so the flags and the
// score agree on when a barrel%/hard-hit% rate is trustworthy.
const MIN_BBE = 40;

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

// Format an OPS-style rate as ".812" (drop the leading zero, 3 decimals).
const fmtOps = (n: number): string => {
  const s = n.toFixed(3);
  return s.startsWith("0") ? s.slice(1) : s;
};

export function computeHrFlags(input: HrFlagsInput): HrFlags {
  const green: HrFlag[] = [];
  const red: HrFlag[] = [];

  // HR/9 allowed: green >= 1.4, red < 1.0 (neutral in between).
  if (fin(input.hrPer9)) {
    const v = input.hrPer9;
    if (v >= 1.4) green.push({ key: "hr9", tone: "green", label: "High HR/9 (1.4+)", value: `${v.toFixed(2)} HR/9` });
    else if (v < 1.0) red.push({ key: "hr9", tone: "red", label: "Low HR/9 (under 1.0)", value: `${v.toFixed(2)} HR/9` });
  }

  // Opponent OPS: green >= .750, red < .650.
  if (fin(input.oppOPS)) {
    const v = input.oppOPS;
    if (v >= 0.75) green.push({ key: "oppOPS", tone: "green", label: "High opponent OPS (.750+)", value: `${fmtOps(v)} opp OPS` });
    else if (v < 0.65) red.push({ key: "oppOPS", tone: "red", label: "Low opponent OPS (under .650)", value: `${fmtOps(v)} opp OPS` });
  }

  // Batted-ball lean (pitcher FB share). We have FB/(GB+FB), not a true GB% of
  // ALL batted balls (no line-drive split), so the red flag is an honest
  // "ground-ball lean" read, not a literal "GB 50%+" claim.
  if (fin(input.flyBallPct)) {
    const v = input.flyBallPct;
    const pct = Math.round(v * 100);
    if (v >= 0.45) green.push({ key: "flyball", tone: "green", label: "High fly-ball rate", value: `${pct}% fly balls` });
    else if (v <= 0.35) red.push({ key: "flyball", tone: "red", label: "Ground-ball lean", value: `${pct}% fly balls` });
  }

  // Strikeout rate: green (low contact-suppression) <= 7.0, red (whiff machine) >= 9.0.
  if (fin(input.kPer9)) {
    const v = input.kPer9;
    if (v <= 7.0) green.push({ key: "k9", tone: "green", label: "Low strikeout rate", value: `${v.toFixed(1)} K/9` });
    else if (v >= 9.0) red.push({ key: "k9", tone: "red", label: "Strikeout pitcher (9+ K/9)", value: `${v.toFixed(1)} K/9` });
  }

  // Statcast contact-quality ALLOWED (gated by sample). Green only — the rubric
  // lists no low-contact red counterpart.
  const bbeOk = fin(input.battedBallEvents) && input.battedBallEvents >= MIN_BBE;
  if (bbeOk && fin(input.hardHitPctAllowed) && input.hardHitPctAllowed >= 40) {
    green.push({ key: "hardhit", tone: "green", label: "Hard-hit allowed 40%+", value: `${input.hardHitPctAllowed.toFixed(1)}% hard-hit` });
  }
  if (bbeOk && fin(input.barrelPctAllowed) && input.barrelPctAllowed >= 8) {
    green.push({ key: "barrel", tone: "green", label: "Barrel allowed 8%+", value: `${input.barrelPctAllowed.toFixed(1)}% barrels` });
  }

  // Platoon advantage = opposite hands (classic edge), or a switch-hitter (always
  // bats from the favorable side). Green only — the rubric lists no disadvantage
  // red flag. Needs both hands to judge.
  if (input.batterHand && (input.batterHand === "S" || input.pitcherThrows)) {
    const adv = input.batterHand === "S" || input.batterHand !== input.pitcherThrows;
    if (adv) {
      const value =
        input.batterHand === "S"
          ? "Switch hitter"
          : `${input.batterHand}HB vs ${input.pitcherThrows}HP`;
      green.push({ key: "platoon", tone: "green", label: "Platoon advantage", value });
    }
  }

  // Park HR factor: green (hitter-friendly) >= 105, red (pitcher's park) <= 95.
  if (fin(input.hrIndex)) {
    const v = input.hrIndex;
    const venue = input.venue ? `${input.venue} · ` : "";
    if (v >= 105) green.push({ key: "park", tone: "green", label: "Hitter-friendly park", value: `${venue}${Math.round(v)} HR index` });
    else if (v <= 95) red.push({ key: "park", tone: "red", label: "Pitcher's park", value: `${venue}${Math.round(v)} HR index` });
  }

  // Weather: red "cold" only (outdoor). The green weather flag in the rubric is
  // "wind blowing out", which we cannot verify (no wind direction) — omitted.
  if (!input.dome && fin(input.tempF) && input.tempF <= 50) {
    red.push({ key: "cold", tone: "red", label: "Cold weather", value: `${Math.round(input.tempF)}\u00b0F` });
  }

  // Outdoor game (dome explicitly false) => wind could matter but we lack its
  // direction => tell the user the wind flags were intentionally omitted.
  const windOmitted = input.dome === false;

  return { green, red, windOmitted };
}
