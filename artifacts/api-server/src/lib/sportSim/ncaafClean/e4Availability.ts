/**
 * E4 injury / availability policy — behavioral contract.
 *
 * Historical predictive validation (segment conservatism on real holdout
 * joins) is separate and requires pre-kick snapshots with
 * captureTimestamp < kickoff. Synthetic tests here prove policy behavior only.
 *
 * Never coerce missing → false. Never invent health from null.
 * Does not flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */

import type { AvailabilityInput, AvailabilitySide, MissingInput } from "./types.ts";

export type E4SnapshotClass =
  | "usable_pre_kick"
  | "stale_or_post_kick"
  | "unavailable_missing"
  | "unavailable_bad_timestamp";

export type E4JoinLabels = {
  eventId: string;
  /** true only when a usable pre-kick snapshot was joined; null if unavailable/stale. Never false-from-null. */
  injuryKnown: true | null;
  /** true/false only when QB status is known on a usable snapshot; null otherwise. */
  qbOut: boolean | null;
  /** Aggregate key-skill outs; null when unknown on either side. */
  keyPlayerOut: boolean | null;
  snapshotClass: E4SnapshotClass;
  captureTimestamp: string | null;
  missing: MissingInput[];
};

export type E4ConservativeAdjust = {
  /** Multiplier on margin/total σ (≥1). Mean μ left unchanged unless qbOut tilt applied. */
  uncertaintyScale: number;
  /** Home−away margin points tilt (negative when home QB/skill out). */
  marginTiltPoints: number;
  features: string[];
  notes: string[];
};

/** Locked behavioral constants — not FINAL_EVAL retune knobs. */
export const E4_POLICY = {
  /** Widen σ when a usable snapshot shows QB out or key offense out. */
  uncertaintyScaleKnownAbsence: 1.15,
  /** Conservative mean tilt (points of margin) when home QB out; opposite for away. */
  qbOutMarginTiltPoints: 3.0,
  /** Same tilt magnitude for keyOffenseOut when QB not already out. */
  keyOffenseOutMarginTiltPoints: 1.5,
  /** Segment conservatism: mean|edge| on null must not exceed known. */
  segmentConservatism: "meanAbsEdge_null_le_meanAbsEdge_known",
} as const;

export function classifyAvailabilitySnapshot(opts: {
  kickoffIso: string;
  availability?: AvailabilityInput | null;
}): E4SnapshotClass {
  const av = opts.availability;
  if (!av) return "unavailable_missing";
  const cap = Date.parse(av.captureTimestamp);
  const kick = Date.parse(opts.kickoffIso);
  if (!Number.isFinite(cap) || !Number.isFinite(kick)) {
    return "unavailable_bad_timestamp";
  }
  if (!(cap < kick)) return "stale_or_post_kick";
  return "usable_pre_kick";
}

function sideQbOut(side: AvailabilitySide): boolean | null {
  if (side.qbStatus === "out" || side.qbStatus === "doubtful") return true;
  if (side.qbStatus === "active") return false;
  return null;
}

function sideKeyOut(side: AvailabilitySide): boolean | null {
  if (side.keyOffenseOut === true || side.keyDefenseOut === true) return true;
  if (side.keyOffenseOut === false && side.keyDefenseOut === false) return false;
  // Partial nulls → unknown aggregate (never coerce null→false)
  if (side.keyOffenseOut == null || side.keyDefenseOut == null) return null;
  return false;
}

/**
 * Join availability → injuryKnown / qbOut labels.
 * Missing or stale snapshots → injuryKnown=null (never false).
 */
export function joinE4Labels(opts: {
  eventId: string;
  kickoffIso: string;
  availability?: AvailabilityInput | null;
}): E4JoinLabels {
  const cls = classifyAvailabilitySnapshot(opts);
  const missing: MissingInput[] = [];

  if (cls === "unavailable_missing" || cls === "unavailable_bad_timestamp") {
    missing.push("injury_unavailable", "qb_availability_unavailable");
    return {
      eventId: opts.eventId,
      injuryKnown: null,
      qbOut: null,
      keyPlayerOut: null,
      snapshotClass: cls,
      captureTimestamp: opts.availability?.captureTimestamp ?? null,
      missing,
    };
  }
  if (cls === "stale_or_post_kick") {
    missing.push("injury_unavailable", "qb_availability_unavailable");
    return {
      eventId: opts.eventId,
      injuryKnown: null,
      qbOut: null,
      keyPlayerOut: null,
      snapshotClass: cls,
      captureTimestamp: opts.availability?.captureTimestamp ?? null,
      missing,
    };
  }

  const av = opts.availability!;
  const homeQb = sideQbOut(av.home);
  const awayQb = sideQbOut(av.away);
  let qbOut: boolean | null = null;
  if (homeQb === true || awayQb === true) qbOut = true;
  else if (homeQb === false && awayQb === false) qbOut = false;
  else qbOut = null;

  const homeKey = sideKeyOut(av.home);
  const awayKey = sideKeyOut(av.away);
  let keyPlayerOut: boolean | null = null;
  if (homeKey === true || awayKey === true) keyPlayerOut = true;
  else if (homeKey === false && awayKey === false) keyPlayerOut = false;
  else keyPlayerOut = null;

  if (homeQb == null && awayQb == null) {
    missing.push("qb_availability_unavailable");
  }

  return {
    eventId: opts.eventId,
    injuryKnown: true,
    qbOut,
    keyPlayerOut,
    snapshotClass: cls,
    captureTimestamp: av.captureTimestamp,
    missing,
  };
}

/**
 * Conservative predict-time adjustment from a *usable* pre-kick snapshot.
 * Stale/missing → identity (scale=1, tilt=0) — caller must not invent health.
 */
export function e4ConservativeAdjust(opts: {
  kickoffIso: string;
  availability?: AvailabilityInput | null;
}): E4ConservativeAdjust {
  const labels = joinE4Labels({
    eventId: opts.availability?.eventId ?? "",
    kickoffIso: opts.kickoffIso,
    availability: opts.availability,
  });
  if (labels.snapshotClass !== "usable_pre_kick" || !opts.availability) {
    return {
      uncertaintyScale: 1,
      marginTiltPoints: 0,
      features: [],
      notes: [`e4_${labels.snapshotClass}_no_adjust`],
    };
  }

  const av = opts.availability;
  let tilt = 0;
  const features: string[] = ["availability_snapshot"];
  const notes: string[] = [];
  let scale = 1;

  const homeQbOut = sideQbOut(av.home) === true;
  const awayQbOut = sideQbOut(av.away) === true;
  if (homeQbOut) {
    tilt -= E4_POLICY.qbOutMarginTiltPoints;
    scale = Math.max(scale, E4_POLICY.uncertaintyScaleKnownAbsence);
    features.push("e4_home_qb_out");
    notes.push("home_qb_out_tilt");
  }
  if (awayQbOut) {
    tilt += E4_POLICY.qbOutMarginTiltPoints;
    scale = Math.max(scale, E4_POLICY.uncertaintyScaleKnownAbsence);
    features.push("e4_away_qb_out");
    notes.push("away_qb_out_tilt");
  }

  // Key offense outs only if QB not already driving tilt on that side
  if (!homeQbOut && av.home.keyOffenseOut === true) {
    tilt -= E4_POLICY.keyOffenseOutMarginTiltPoints;
    scale = Math.max(scale, E4_POLICY.uncertaintyScaleKnownAbsence);
    features.push("e4_home_key_offense_out");
    notes.push("home_key_offense_out_tilt");
  }
  if (!awayQbOut && av.away.keyOffenseOut === true) {
    tilt += E4_POLICY.keyOffenseOutMarginTiltPoints;
    scale = Math.max(scale, E4_POLICY.uncertaintyScaleKnownAbsence);
    features.push("e4_away_key_offense_out");
    notes.push("away_key_offense_out_tilt");
  }

  // Explicit null key flags must not be treated as healthy
  if (av.home.keyOffenseOut == null || av.away.keyOffenseOut == null) {
    notes.push("key_offense_null_not_coerced_false");
  }

  return {
    uncertaintyScale: scale,
    marginTiltPoints: tilt,
    features,
    notes,
  };
}

export type E4SegmentRow = {
  eventId: string;
  injuryKnown: true | null;
  /** Engine edge vs market in probability points (signed). */
  edge: number;
};

/**
 * Segment conservatism check (historical predictive validation when rows are real).
 * Passes when mean|edge| on injuryKnown=null ≤ mean|edge| on injuryKnown=true.
 */
export function evaluateE4SegmentConservatism(rows: E4SegmentRow[]): {
  status: "PASS" | "FAIL" | "INSUFFICIENT_DATA";
  nKnown: number;
  nNull: number;
  meanAbsEdgeKnown: number | null;
  meanAbsEdgeNull: number | null;
  detail: string;
  evidenceClass: "behavioral_synthetic" | "historical_predictive" | "missing";
} {
  const known = rows.filter((r) => r.injuryKnown === true);
  const nul = rows.filter((r) => r.injuryKnown === null);
  if (known.length < 20 || nul.length < 20) {
    return {
      status: "INSUFFICIENT_DATA",
      nKnown: known.length,
      nNull: nul.length,
      meanAbsEdgeKnown: known.length
        ? known.reduce((s, r) => s + Math.abs(r.edge), 0) / known.length
        : null,
      meanAbsEdgeNull: nul.length
        ? nul.reduce((s, r) => s + Math.abs(r.edge), 0) / nul.length
        : null,
      detail: `need ≥20 known and ≥20 null rows; got known=${known.length} null=${nul.length}`,
      evidenceClass: rows.length ? "historical_predictive" : "missing",
    };
  }
  const meanKnown =
    known.reduce((s, r) => s + Math.abs(r.edge), 0) / known.length;
  const meanNull = nul.reduce((s, r) => s + Math.abs(r.edge), 0) / nul.length;
  const pass = meanNull <= meanKnown;
  return {
    status: pass ? "PASS" : "FAIL",
    nKnown: known.length,
    nNull: nul.length,
    meanAbsEdgeKnown: meanKnown,
    meanAbsEdgeNull: meanNull,
    detail: `mean|edge| null=${meanNull.toFixed(4)} vs known=${meanKnown.toFixed(4)}`,
    evidenceClass: "historical_predictive",
  };
}

/** Never coerce: document that null stays null. */
export function coerceInjuryKnownForbidden(
  raw: true | false | null | undefined,
): true | null {
  if (raw === true) return true;
  // false and undefined both become null — missing is not "no injuries"
  return null;
}
