import type { SlatePreAnalysisSnapshot } from "./coachSlateTypes.js";

type DailySlate = { snapshot: SlatePreAnalysisSnapshot | null; fresh: boolean; deepSimComplete: boolean; computedAt: string | null };
/** Never announce ready picks from stale, incomplete, past-game, or unqualified data. */
export function dailyCoachPicksReady(row: DailySlate, now = Date.now()): boolean {
  const computed = Date.parse(row.computedAt ?? "");
  if (!row.fresh || !row.deepSimComplete || !Number.isFinite(computed) ||
      computed > now || now - computed > 15 * 60_000) return false;
  const picks = row.snapshot?.boardScan?.picks ?? [];
  return picks.filter(p => {
    const start = Date.parse(p.startsAt ?? "");
    const score = p.finalAiScore;
    const sim = score?.simHit;
    const grade = String(score?.grade ?? "").trim();
    const odds = p.odds;
    if (!p.game || !p.pick || !p.market || !Number.isFinite(odds) || Math.abs(odds) < 100 ||
        !Number.isFinite(start) || start <= now || start > now + 48 * 60 * 60_000 ||
        !/^(A[+-]?|B[+-]?|C\+)$/.test(grade) ||
        (score?.confidencePct ?? 0) < 52 || (score?.edgePct ?? 0) <= 0 ||
        sim == null || !Number.isFinite(sim) || sim < 0.52 || sim >= 1) return false;
    const implied = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
    return sim > implied;
  }).length >= 2;
}
