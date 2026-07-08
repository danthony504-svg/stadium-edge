// Compact parlay-ticket stats for the Coach UI — derived from grounded pick scores only.

import { gradeFromComposite } from "./pickScore.ts";
import { isGameLinePick } from "./gameSimScoring.ts";

export type TicketPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  isProp?: boolean;
  simulationPending?: boolean;
  scores?: {
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    composite?: number | null;
    scores?: { simulation?: number | null };
  } | null;
  finalAiScore?: {
    grade?: string | null;
    confidencePct?: number | null;
    edgePct?: number | null;
    composite?: number | null;
    simHit?: number | null;
  } | null;
};

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  "C-": 2,
  C: 3,
  "C+": 4,
  "B-": 5,
  B: 6,
  "B+": 7,
  "A-": 8,
  A: 9,
  "A+": 10,
};

const RANK_GRADE = Object.entries(GRADE_RANK).sort((a, b) => a[1] - b[1]);

function gradeRank(g: string | null | undefined): number {
  if (!g) return -1;
  return GRADE_RANK[g] ?? -1;
}

function gradeFromRank(rank: number): string | null {
  if (rank < 0) return null;
  let best: string | null = null;
  for (const [g, r] of RANK_GRADE) {
    if (r <= rank) best = g;
  }
  return best;
}

export type GameLineSummary = {
  pick: TicketPick;
  grade: string | null;
  confidence: number | null;
  edge: number | null;
  simHitPct: number | null;
};

export type CoachTicketSummary = {
  pickCount: number;
  gameLineCount: number;
  simulations: number | null;
  avgConfidence: number | null;
  overallGrade: string | null;
  gameLines: GameLineSummary[];
};

function scoresForPick(p: TicketPick) {
  const fa = p.finalAiScore;
  const rubric = p.scores;
  return {
    grade: fa?.grade ?? rubric?.grade ?? null,
    confidence: fa?.confidencePct ?? rubric?.confidencePct ?? null,
    edge: fa?.edgePct ?? rubric?.edgePct ?? null,
    composite: fa?.composite ?? rubric?.composite ?? null,
    simHitPct:
      fa?.simHit != null ? Math.round(fa.simHit * 1000) / 10 : null,
  };
}

export function summarizeCoachTicket(picks: TicketPick[]): CoachTicketSummary {
  const gameLines = picks.filter((p) => isGameLinePick(p) && !p.isProp);
  const scored = picks.map(scoresForPick);
  const confs = scored.map((s) => s.confidence).filter((c): c is number => c != null);
  const composites = scored.map((s) => s.composite).filter((c): c is number => c != null);
  const avgComposite =
    composites.length > 0
      ? composites.reduce((a, b) => a + b, 0) / composites.length
      : null;

  const usedSim =
    picks.some(
      (p) =>
        p.finalAiScore?.simHit != null ||
        p.scores?.scores?.simulation != null ||
        p.simulationPending,
    ) || gameLines.length > 0;

  return {
    pickCount: picks.length,
    gameLineCount: gameLines.length,
    simulations: usedSim ? 10_000 : null,
    avgConfidence:
      confs.length > 0
        ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length)
        : null,
    overallGrade:
      avgComposite != null
        ? gradeFromComposite(avgComposite)
        : (() => {
            const ranks = scored.map((s) => gradeRank(s.grade)).filter((r) => r >= 0);
            if (ranks.length === 0) return null;
            const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
            return gradeFromRank(Math.round(avg));
          })(),
    gameLines: gameLines.map((p) => {
      const s = scoresForPick(p);
      return {
        pick: p,
        grade: s.grade,
        confidence: s.confidence,
        edge: s.edge,
        simHitPct: s.simHitPct,
      };
    }),
  };
}
