// Ticket-level edge helpers for Coach parlay optimization.

export const TICKET_EDGE_REOPT_MARGIN_PCT = 1;

export type EdgePick = {
  finalAiScore?: { edgePct?: number | null } | null;
  scores?: { edgePct?: number | null } | null;
};

export function pickEdgePct(p: EdgePick): number | null {
  const e = p.finalAiScore?.edgePct ?? p.scores?.edgePct ?? null;
  return e != null && Number.isFinite(e) ? e : null;
}

export function averageTicketEdge(picks: EdgePick[]): number | null {
  const edges = picks.map(pickEdgePct).filter((e): e is number => e != null);
  if (!edges.length) return null;
  return Math.round((edges.reduce((a, b) => a + b, 0) / edges.length) * 10) / 10;
}

/** True when avg edge is negative but within 1% of zero (e.g. -0.9%). */
export function shouldReoptimizeTicketEdge(avgEdge: number | null): boolean {
  return (
    avgEdge != null &&
    avgEdge < 0 &&
    avgEdge > -TICKET_EDGE_REOPT_MARGIN_PCT
  );
}

/** Index of the leg whose removal most improves (or least hurts) ticket avg edge. */
export function weakestEdgeLegIndex(picks: EdgePick[]): number | null {
  if (picks.length <= 1) return null;
  const edges = picks.map((p) => pickEdgePct(p) ?? 0);
  let worst = 0;
  for (let i = 1; i < edges.length; i++) {
    if (edges[i]! < edges[worst]!) worst = i;
  }
  return worst;
}
