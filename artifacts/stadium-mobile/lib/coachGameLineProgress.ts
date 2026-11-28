export function summarizeCoachGameLineDecisions(decisions: readonly string[]) {
  const counts = new Map<string, number>();
  const labels: Record<string, string> = {
    non_positive_edge: "edge at or below zero",
    sim_not_above_implied: "model chance below price threshold",
    non_positive_ev: "expected value at or below zero",
    grade_floor: "below grade floor",
    confidence_floor: "below confidence floor",
    simulation_or_grade_unavailable: "simulation or grade unavailable",
    college_evidence_missing: "missing college evidence",
    missing_score: "missing score",
    sim_unsupported: "unsupported simulation",
    sim_invalid: "invalid simulation",
    check_line: "held pending calibration",
  };
  for (const reason of decisions) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const failures = [...counts].filter(([reason]) => reason !== "ok");
  const rejected = failures.reduce((total, [, count]) => total + count, 0);
  const scored = decisions.length - (counts.get("simulation_or_grade_unavailable") ?? 0) -
    (counts.get("college_evidence_missing") ?? 0) - (counts.get("check_line") ?? 0);
  return { scored, evaluated: decisions.length, rejected,
    firstRejections: failures.map(([reason, count]) => `${labels[reason] ?? reason.replaceAll("_", " ")} ${count}`) };
}
