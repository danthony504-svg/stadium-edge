export type ProbValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** Strict probability gate: finite and in (0,1) exclusive for grading-quality hits. */
export function validateSimHitProbability(simHit: number | null | undefined): ProbValidation {
  if (simHit == null) return { ok: false, reason: "sim_hit_null" };
  if (!Number.isFinite(simHit)) return { ok: false, reason: "sim_hit_non_finite" };
  if (simHit <= 0 || simHit >= 1) return { ok: false, reason: "sim_hit_out_of_open_unit_interval" };
  return { ok: true };
}

export function validateClosedUnitInterval(p: number | null | undefined): ProbValidation {
  if (p == null) return { ok: false, reason: "prob_null" };
  if (!Number.isFinite(p)) return { ok: false, reason: "prob_non_finite" };
  if (p < 0 || p > 1) return { ok: false, reason: "prob_out_of_unit_interval" };
  return { ok: true };
}
