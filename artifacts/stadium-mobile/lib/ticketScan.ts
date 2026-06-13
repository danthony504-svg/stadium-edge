// Pure aggregation for the "Ticket Scan" summary card shown while the Coach
// analyzes a slip. Everything here is REAL-or-null, grounded in the slip's own
// odds and the model's OWN stated per-leg edge — nothing is fabricated:
//   - Estimated Hit Rate = the parlay's combined book-implied probability.
//   - Highest Confidence / Weakest leg = ranked by the app's edge-derived
//     confidence score (the SAME deriveConfidenceScore the pick cards show) when
//     at least two legs carry a stated edge; otherwise it falls back to each
//     leg's market-implied likelihood so every leg stays rankable. The caller
//     supplies the already-derived confidence so there is a single source of
//     truth for the score (we never re-derive it here).
//   - Average Edge = mean of the legs that carry a model-stated edge (parsed by
//     the caller via parseEdgeStats); null when no leg states one.
// Implied probability (0..1) for a single American price. Inlined (rather than
// imported from ./format) so this stays a dependency-free pure module — matching
// the repo's other unit-tested helpers and keeping `node --test` happy.
function impliedProb(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

export type TicketLeg = {
  pick: string;
  odds: number;
  // The model's stated edge for this leg in pct points (e.g. +4.2), already
  // parsed from its EDGE note by the caller. null when the leg states no edge.
  edgePct: number | null;
  // The app's edge-derived confidence score (0–10) for this leg, computed by the
  // caller with the SAME deriveConfidenceScore the pick cards use. null when the
  // leg has no stated edge to grade.
  confidence: number | null;
};

export type TicketLegRef = {
  pick: string;
  // The number shown beside the pick. With mode "conf" it is the 0–10 confidence
  // score; with mode "prob" it is the market-implied probability (0..1).
  metric: number;
  mode: "conf" | "prob";
};

export type TicketScan = {
  count: number;
  // Combined implied probability of the whole parlay, 0..1 (null when empty).
  hitRate: number | null;
  highest: TicketLegRef | null;
  weakest: TicketLegRef | null;
  // Mean stated edge in pct points across legs that carry one (null otherwise).
  avgEdge: number | null;
  // How many of the legs actually carried a stated edge (for an honest caption).
  edgeLegs: number;
};

export function computeTicketScan(legs: TicketLeg[]): TicketScan {
  const count = legs.length;
  if (count === 0) {
    return { count: 0, hitRate: null, highest: null, weakest: null, avgEdge: null, edgeLegs: 0 };
  }

  const valid = legs.filter((l) => Number.isFinite(l.odds) && l.odds !== 0);
  const hitRate = valid.length
    ? valid.reduce((acc, l) => acc * impliedProb(l.odds), 1)
    : null;

  // Prefer the app's real edge-derived confidence (consistent with the pick
  // cards) when at least two legs are graded; otherwise rank by market-implied
  // likelihood so every priced leg is still rankable.
  const scored = legs.filter(
    (l) => l.confidence != null && Number.isFinite(l.confidence),
  );
  let highest: TicketLegRef | null = null;
  let weakest: TicketLegRef | null = null;
  if (scored.length >= 2) {
    for (const l of scored) {
      const metric = l.confidence as number;
      if (highest === null || metric > highest.metric) highest = { pick: l.pick, metric, mode: "conf" };
      if (weakest === null || metric < weakest.metric) weakest = { pick: l.pick, metric, mode: "conf" };
    }
  } else {
    for (const l of valid) {
      const metric = impliedProb(l.odds);
      if (highest === null || metric > highest.metric) highest = { pick: l.pick, metric, mode: "prob" };
      if (weakest === null || metric < weakest.metric) weakest = { pick: l.pick, metric, mode: "prob" };
    }
  }

  const edges = legs
    .map((l) => l.edgePct)
    .filter((e): e is number => e != null && Number.isFinite(e));
  const avgEdge = edges.length
    ? Math.round((edges.reduce((a, b) => a + b, 0) / edges.length) * 10) / 10
    : null;

  return { count, hitRate, highest, weakest, avgEdge, edgeLegs: edges.length };
}
