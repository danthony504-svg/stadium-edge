// Real hit-rate grading for player props — the SINGLE source of truth shared by
// the Props tab's "AI RECOMMENDED" rail and the Home "Hot Picks Today" rail.
// Every grade is earned from a player's REAL game log (how often they cleared the
// posted line over their last N games) — never a fabricated rating. Players with
// no game-log feed (e.g. tennis/ufc) or too few real games are simply not graded.
import { getPlayerHistory, type PlayerProp } from "./api";
import { computeAmbiguous, gameValueForMarket } from "./propStats";

export const GRADE_WINDOW = 10; // most-recent real games read for the hit-rate
export const GRADE_MIN_SAMPLE = 5; // need at least this many real games to grade
export const GRADE_POOL = 12; // candidate players we pull game logs for per sport

export type Grade = "A+" | "A" | "A-";

// Map a real hit-rate (cleared / sample) to a letter. Below A- we don't grade.
export function gradeFromHitPct(pct: number): Grade | null {
  if (pct >= 80) return "A+";
  if (pct >= 70) return "A";
  if (pct >= 60) return "A-";
  return null;
}

// Pick the side to recommend for a prop from its REAL posted prices only. When
// both sides are priced, take the higher American number (the shorter-juice /
// better-return side) — a transparent rule, never a fabricated lean. Yes/no
// markets (line null) only carry an Over/"Yes" price, so that side is used.
// Returns null when no real price exists (nothing to honestly recommend).
export function recommendSide(
  p: PlayerProp,
): { side: "Over" | "Under"; price: number } | null {
  const o = p.overPrice;
  const u = p.underPrice;
  if (o != null && u != null) return o >= u ? { side: "Over", price: o } : { side: "Under", price: u };
  if (o != null) return { side: "Over", price: o };
  if (u != null) return { side: "Under", price: u };
  return null;
}

// A prop to grade. `key` is caller-defined so each surface can map results back
// to its own row identity (e.g. "game|pick").
export type GradeCand = {
  key: string;
  player: string;
  athleteId: string | null;
  marketKey: string;
  line: number | null;
  side: "Over" | "Under";
};

export type GradeResult = { grade: Grade; hits: number; n: number };

// Grade a pool of prop candidates against their REAL recent game logs, with
// bounded concurrency. Returns a map keyed by each candidate's `key`; candidates
// we can't grade for certain (no game log, too few games, fetch error) are simply
// absent from the map — never given a fabricated grade.
export async function gradePropCands(
  cands: GradeCand[],
  sport: string,
  signal?: AbortSignal,
): Promise<Map<string, GradeResult>> {
  const isSoccer = sport === "soccer";
  const results = new Map<string, GradeResult>();
  const queue = [...cands];
  const worker = async () => {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      // Soccer is graded by player NAME (StatMuse); everything else by athleteId.
      if (!c.athleteId && !(isSoccer && c.player)) continue;
      try {
        const h = await getPlayerHistory(
          { sport, athleteId: c.athleteId, name: isSoccer ? c.player : null },
          signal,
        );
        const ambiguous = computeAmbiguous(h.labels);
        const vals = (h.recent ?? [])
          .map((g) => gameValueForMarket(c.marketKey, g.stats, ambiguous))
          .filter((v): v is number => v != null)
          .slice(0, GRADE_WINDOW);
        const n = vals.length;
        if (n < GRADE_MIN_SAMPLE) continue;
        const threshold = c.line != null ? c.line : 0.5;
        const isUnder = c.side === "Under";
        const hits = vals.filter((v) => (isUnder ? v < threshold : v >= threshold)).length;
        const grade = gradeFromHitPct((hits / n) * 100);
        if (grade) results.set(c.key, { grade, hits, n });
      } catch {
        // No game log / fetch error — skip this player, never fabricate.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return results;
}
