import { COACH_PARLAY_SIZES, type CoachParlayLegCount } from "@workspace/coach-types";

export function parseLegsQuery(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 3 ? n : undefined;
}

export function parseSportQuery(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();
  return s && s !== "global" && s !== "all" ? s : null;
}

export function nearestParlaySize(legs: number): CoachParlayLegCount {
  const sizes = [...COACH_PARLAY_SIZES];
  let best = sizes[0]!;
  let bestDist = Math.abs(legs - best);
  for (const size of sizes) {
    const dist = Math.abs(legs - size);
    if (dist < bestDist) {
      best = size;
      bestDist = dist;
    }
  }
  return best;
}
