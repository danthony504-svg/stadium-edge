import type { BetResult, LegResult } from "@/context/BetSlipContext";
import { sportLabel } from "@/lib/sports";

// Minimum graded legs in a category before we'll surface a win% for it. Below
// this we only show how many results we've collected — never a percentage off a
// tiny sample, which would be noise dressed up as a "model strength".
export const MIN_CATEGORY_SAMPLE = 5;
// A stronger bar for the head-to-head "what the model is best/worst at" callouts
// and for any signal fed into the Coach. Soft signals must be earned by a real
// sample, never inferred from a handful of legs.
export const MIN_INSIGHT_SAMPLE = 8;

export type Tally = { wins: number; losses: number; pushes: number };

export function emptyTally(): Tally {
  return { wins: 0, losses: 0, pushes: 0 };
}

export function addToTally(t: Tally, r: LegResult["result"]) {
  if (r === "win") t.wins += 1;
  else if (r === "loss") t.losses += 1;
  else if (r === "push") t.pushes += 1;
}

// Decided = wins + losses (pushes are no-action, excluded from win%).
export function decided(t: Tally): number {
  return t.wins + t.losses;
}

export function winPct(t: Tally): number | null {
  const d = decided(t);
  return d > 0 ? (t.wins / d) * 100 : null;
}

export function recordText(t: Tally): string {
  return t.pushes > 0
    ? `${t.wins}-${t.losses}-${t.pushes}`
    : `${t.wins}-${t.losses}`;
}

// Human labels for grader market families. Anything we don't recognise is shown
// title-cased so new prop markets degrade gracefully.
const FAMILY_LABELS: Record<string, string> = {
  total: "Game Totals",
  spread: "Spreads",
  moneyline: "Moneyline",
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  threes: "3-Pointers",
  strikeouts: "Strikeouts",
  hits: "Hits",
  "total bases": "Total Bases",
  "home runs": "Home Runs",
  rbis: "RBIs",
  goals: "Goals",
  saves: "Saves",
  "passing yards": "Passing Yards",
  "rushing yards": "Rushing Yards",
  "receiving yards": "Receiving Yards",
};

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function familyLabel(family: string): string {
  const key = family.toLowerCase();
  return FAMILY_LABELS[key] ?? titleCase(family);
}

export function sideLabel(side: string): string {
  const s = side.toLowerCase();
  if (s === "over") return "Overs";
  if (s === "under") return "Unders";
  return titleCase(side);
}

export type Breakdown = { key: string; label: string; tally: Tally };

function toSortedBreakdowns(
  map: Map<string, Tally>,
  labelFn: (key: string) => string,
): Breakdown[] {
  return Array.from(map.entries())
    .map(([key, tally]) => ({ key, label: labelFn(key), tally }))
    // Most-sampled first so the categories we actually know about lead.
    .sort((a, b) => decided(b.tally) - decided(a.tally) || b.tally.wins - a.tally.wins);
}

export type Analytics = {
  totalSlips: number;
  slipTally: Tally; // parlay-level outcomes
  legTally: Tally; // every gradeable leg
  ungradedLegs: number;
  bySide: Breakdown[];
  byFamily: Breakdown[];
  bySport: Breakdown[];
};

export function computeAnalytics(results: BetResult[]): Analytics {
  const slipTally = emptyTally();
  const legTally = emptyTally();
  let ungradedLegs = 0;
  const side = new Map<string, Tally>();
  const family = new Map<string, Tally>();
  const sport = new Map<string, Tally>();

  for (const res of results) {
    if (res.slipResult !== "ungraded") addToTally(slipTally, res.slipResult);
    for (const leg of res.legs) {
      if (leg.result === "ungraded") {
        ungradedLegs += 1;
        continue;
      }
      addToTally(legTally, leg.result);
      if (leg.side) {
        const k = leg.side.toLowerCase();
        if (!side.has(k)) side.set(k, emptyTally());
        addToTally(side.get(k)!, leg.result);
      }
      if (leg.family) {
        const k = leg.family.toLowerCase();
        if (!family.has(k)) family.set(k, emptyTally());
        addToTally(family.get(k)!, leg.result);
      }
      if (leg.sport) {
        const k = leg.sport.toLowerCase();
        if (!sport.has(k)) sport.set(k, emptyTally());
        addToTally(sport.get(k)!, leg.result);
      }
    }
  }

  return {
    totalSlips: results.length,
    slipTally,
    legTally,
    ungradedLegs,
    // Only over/under sides are meaningful as a head-to-head; keep just those.
    bySide: toSortedBreakdowns(side, sideLabel).filter((b) =>
      ["over", "under"].includes(b.key),
    ),
    byFamily: toSortedBreakdowns(family, familyLabel),
    bySport: toSortedBreakdowns(sport, (k) => sportLabel(k)),
  };
}

// Build honest, real-data-only insight strings for the Model Report UI. Each
// requires a real sample on both sides of a comparison; we never editorialise
// off a handful of legs.
export function buildInsights(a: Analytics): string[] {
  const out: string[] = [];

  const over = a.bySide.find((b) => b.key === "over")?.tally;
  const under = a.bySide.find((b) => b.key === "under")?.tally;
  if (
    over &&
    under &&
    decided(over) >= MIN_INSIGHT_SAMPLE &&
    decided(under) >= MIN_INSIGHT_SAMPLE
  ) {
    const op = winPct(over)!;
    const up = winPct(under)!;
    const gap = Math.abs(op - up);
    if (gap >= 8) {
      const [hi, lo, hiName, loName] =
        up >= op ? [up, op, "Unders", "Overs"] : [op, up, "Overs", "Unders"];
      out.push(
        `${hiName} are landing ${(hi as number).toFixed(0)}% vs ${(lo as number).toFixed(0)}% on ${loName} — lean ${(hiName as string).toLowerCase()} by ${gap.toFixed(0)} pts.`,
      );
    }
  }

  const strongFamily = a.byFamily
    .filter((b) => decided(b.tally) >= MIN_INSIGHT_SAMPLE)
    .map((b) => ({ ...b, pct: winPct(b.tally)! }))
    .sort((x, y) => y.pct - x.pct)[0];
  if (strongFamily && strongFamily.pct >= 55) {
    out.push(
      `Best market: ${strongFamily.label} hitting ${strongFamily.pct.toFixed(0)}% (${strongFamily.tally.wins}-${strongFamily.tally.losses}).`,
    );
  }

  const strongSport = a.bySport
    .filter((b) => decided(b.tally) >= MIN_INSIGHT_SAMPLE)
    .map((b) => ({ ...b, pct: winPct(b.tally)! }))
    .sort((x, y) => y.pct - x.pct)[0];
  if (strongSport && strongSport.pct >= 55) {
    out.push(
      `Best sport: ${strongSport.label} hitting ${strongSport.pct.toFixed(0)}% (${strongSport.tally.wins}-${strongSport.tally.losses}).`,
    );
  }

  return out;
}

// Compact, soft-signal strings about the user's REAL settled results, for the
// Coach context. Only categories above the insight sample bar are reported, and
// only when they're clearly strong (>=55%) or weak (<=42%) so the model has a
// real reason to lean in or steer clear. Returns [] when nothing qualifies —
// the Coach then gets no signal at all (never a fabricated "you're hot at X").
export function computeModelStrengths(results: BetResult[]): string[] {
  const a = computeAnalytics(results);
  const out: string[] = [];

  const rate = (label: string, t: Tally) => {
    if (decided(t) < MIN_INSIGHT_SAMPLE) return;
    const p = winPct(t)!;
    if (p >= 55) out.push(`${label}: strong (${p.toFixed(0)}%, ${t.wins}-${t.losses})`);
    else if (p <= 42) out.push(`${label}: cold (${p.toFixed(0)}%, ${t.wins}-${t.losses})`);
  };

  for (const b of a.bySide) rate(b.label, b.tally);
  for (const b of a.byFamily) rate(b.label, b.tally);
  for (const b of a.bySport) rate(b.label, b.tally);

  // Cap so the context line stays short.
  return out.slice(0, 6);
}
