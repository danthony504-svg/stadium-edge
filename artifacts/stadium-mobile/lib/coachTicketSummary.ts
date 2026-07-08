// Compact parlay-ticket stats for the Coach UI — derived from grounded pick scores only.

import { gradeFromComposite } from "./pickScore.ts";
import { isGameLinePick } from "./gameSimScoring.ts";
import { decimalToAmerican } from "./format.ts";

function fairOddsFromSimHit(simHit: number | null | undefined): number | null {
  if (simHit == null || !Number.isFinite(simHit) || simHit <= 0 || simHit >= 1) return null;
  return decimalToAmerican(1 / simHit);
}

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

function normGame(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Team-sided spread / ML — at most one per game on the ticket display. */
export function isTeamSidedGameLine(p: TicketPick): boolean {
  if (!isGameLinePick(p as Parameters<typeof isGameLinePick>[0]) || p.isProp) return false;
  const m = String(p.market ?? "").toLowerCase();
  if (/total|over|under|o\/u/.test(m) || /\b(over|under)\b/i.test(p.pick)) return false;
  return !/^(over|under)\s/i.test(p.pick.trim());
}

function pickComposite(p: TicketPick): number {
  return p.finalAiScore?.composite ?? p.scores?.composite ?? -1;
}

/** One team-sided game line per matchup — the side on the final ticket. */
export function dedupeTicketGameLines(gameLines: TicketPick[]): TicketPick[] {
  const bestTeamSided = new Map<string, TicketPick>();
  for (const p of gameLines) {
    if (!isTeamSidedGameLine(p)) continue;
    const key = normGame(p.game);
    const prev = bestTeamSided.get(key);
    if (!prev || pickComposite(p) > pickComposite(prev)) bestTeamSided.set(key, p);
  }

  const seenTeamGame = new Set<string>();
  const out: TicketPick[] = [];
  for (const p of gameLines) {
    if (isTeamSidedGameLine(p)) {
      const key = normGame(p.game);
      const best = bestTeamSided.get(key);
      if (!best || best !== p || seenTeamGame.has(key)) continue;
      seenTeamGame.add(key);
      out.push(p);
    } else {
      out.push(p);
    }
  }
  return out;
}

export type GameLineSummary = {
  pick: TicketPick;
  grade: string | null;
  confidence: number | null;
  edge: number | null;
  simHitPct: number | null;
  fairOdds: number | null;
  bookOdds: number;
  whyLine: string;
};

export type CoachTicketSummary = {
  pickCount: number;
  gameLineCount: number;
  simulations: number | null;
  avgConfidence: number | null;
  avgEdge: number | null;
  overallGrade: string | null;
  gameLines: GameLineSummary[];
};

function scoresForPick(p: TicketPick) {
  const fa = p.finalAiScore;
  const rubric = p.scores;
  const simHit = fa?.simHit ?? null;
  return {
    grade: fa?.grade ?? rubric?.grade ?? null,
    confidence: fa?.confidencePct ?? rubric?.confidencePct ?? null,
    edge: fa?.edgePct ?? rubric?.edgePct ?? null,
    composite: fa?.composite ?? rubric?.composite ?? null,
    simHitPct: simHit != null ? Math.round(simHit * 1000) / 10 : null,
    fairOdds: fairOddsFromSimHit(simHit),
  };
}

function whyLineForPick(p: TicketPick): string {
  const market = String(p.market ?? "game line").toLowerCase();
  if (/alt spread|spread/.test(market)) {
    return "Highest Final AI Score among posted spread / alt spread rungs for this game after the 10k sim.";
  }
  if (/moneyline|ml/.test(market)) {
    return "Highest Final AI Score among posted moneyline rungs for this game after the 10k sim.";
  }
  if (/total/.test(market)) {
    return "Highest Final AI Score among posted total / alt total rungs for this game after the 10k sim.";
  }
  return "Selected from posted game-line rungs with the strongest Final AI Score after the 10k sim.";
}

export function summarizeCoachTicket(picks: TicketPick[]): CoachTicketSummary {
  const rawGameLines = picks.filter((p) => isGameLinePick(p as Parameters<typeof isGameLinePick>[0]) && !p.isProp);
  const gameLines = dedupeTicketGameLines(rawGameLines);
  const scored = picks.map(scoresForPick);
  const confs = scored.map((s) => s.confidence).filter((c): c is number => c != null);
  const edges = scored.map((s) => s.edge).filter((e): e is number => e != null);
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
    avgEdge:
      edges.length > 0
        ? Math.round((edges.reduce((a, b) => a + b, 0) / edges.length) * 10) / 10
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
        fairOdds: s.fairOdds,
        bookOdds: p.odds,
        whyLine: whyLineForPick(p),
      };
    }),
  };
}
