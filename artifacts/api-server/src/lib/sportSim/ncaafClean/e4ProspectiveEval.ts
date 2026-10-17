/**
 * Prospective E4 evaluation harness (E4-seg + E4-inj).
 *
 * Does NOT activate the injury collector.
 * Does NOT apply injury adjusts to frozen M_base FINAL_EVAL scoring.
 * M_inj requires fresh independent prospective evidence — never inherits
 * frozen FINAL_EVAL pass bits.
 */

import {
  E4_POLICY,
  e4ConservativeAdjust,
  evaluateE4SegmentConservatism,
  joinE4Labels,
  type E4SegmentRow,
} from "./e4Availability.ts";
import type { AvailabilityInput } from "./types.ts";

export const E4_PROSPECTIVE_CRITERIA = {
  N1_minDecidedCloseMlWithJoinAttempt: 60,
  N2_minInjuryKnownTrue: 20,
  N3_minInjuryKnownNull: 20,
  N4_minHome: 15,
  N4_minAway: 15,
  N5_captureBeforeKickoff: true,
  N6_neverCoerceNullToFalse: true,
} as const;

export type ProspectiveGameRow = {
  eventId: string;
  kickoffIso: string;
  /** Engine vs close ML edge in probability points (M_base, no injury). */
  edgeAbsMbase: number;
  side: "home" | "away";
  decided: boolean;
  closeMlPresent: boolean;
  availability?: AvailabilityInput | null;
};

export type E4ProspectiveSampleCheck = {
  id: "N1" | "N2" | "N3" | "N4" | "N5" | "N6";
  pass: boolean | null;
  detail: string;
};

export type E4ProspectiveReport = {
  status: "INSUFFICIENT_DATA" | "SEG_SCORED" | "INJ_SCORED";
  e4Resolved: boolean;
  /** Always false — harness never auto-resolves product E4. */
  productE4Cleared: false;
  mBaseFrozenUntouched: true;
  mInjInheritsFinalEval: false;
  sample: E4ProspectiveSampleCheck[];
  segment: ReturnType<typeof evaluateE4SegmentConservatism> | null;
  injNote: string;
  nJoinAttempt: number;
  nKnown: number;
  nNull: number;
  nHome: number;
  nAway: number;
  policy: typeof E4_POLICY;
};

function sampleChecks(opts: {
  nJoinAttempt: number;
  nKnown: number;
  nNull: number;
  nHome: number;
  nAway: number;
  allKnownCaptureBeforeKick: boolean;
  coercionViolations: number;
}): E4ProspectiveSampleCheck[] {
  const c = E4_PROSPECTIVE_CRITERIA;
  return [
    {
      id: "N1",
      pass: opts.nJoinAttempt >= c.N1_minDecidedCloseMlWithJoinAttempt,
      detail: `nJoinAttempt=${opts.nJoinAttempt}`,
    },
    {
      id: "N2",
      pass: opts.nKnown >= c.N2_minInjuryKnownTrue,
      detail: `nKnown=${opts.nKnown}`,
    },
    {
      id: "N3",
      pass: opts.nNull >= c.N3_minInjuryKnownNull,
      detail: `nNull=${opts.nNull}`,
    },
    {
      id: "N4",
      pass:
        opts.nHome >= c.N4_minHome && opts.nAway >= c.N4_minAway,
      detail: `home=${opts.nHome} away=${opts.nAway}`,
    },
    {
      id: "N5",
      pass: opts.allKnownCaptureBeforeKick,
      detail: `allKnownCaptureBeforeKick=${opts.allKnownCaptureBeforeKick}`,
    },
    {
      id: "N6",
      pass: opts.coercionViolations === 0,
      detail: `coercionViolations=${opts.coercionViolations}`,
    },
  ];
}

/**
 * Score E4-seg on M_base edges stratified by joined labels.
 * Never mutates frozen FINAL_EVAL fixtures. Never applies M_inj to M_base edges.
 */
export function runE4ProspectiveEval(
  games: ProspectiveGameRow[],
): E4ProspectiveReport {
  const segmentRows: E4SegmentRow[] = [];
  let nJoinAttempt = 0;
  let nKnown = 0;
  let nNull = 0;
  let nHome = 0;
  let nAway = 0;
  let allKnownCaptureBeforeKick = true;
  let coercionViolations = 0;

  for (const g of games) {
    if (!g.decided || !g.closeMlPresent) continue;
    nJoinAttempt += 1;
    if (g.side === "home") nHome += 1;
    else nAway += 1;

    const labels = joinE4Labels({
      eventId: g.eventId,
      kickoffIso: g.kickoffIso,
      availability: g.availability,
    });

    // N6: injuryKnown must never be false (only true | null).
    if ((labels.injuryKnown as unknown) === false) {
      coercionViolations += 1;
    }

    if (labels.injuryKnown === true) {
      nKnown += 1;
      if (labels.snapshotClass !== "usable_pre_kick") {
        allKnownCaptureBeforeKick = false;
      }
      if (
        labels.captureTimestamp == null ||
        !(Date.parse(labels.captureTimestamp) < Date.parse(g.kickoffIso))
      ) {
        allKnownCaptureBeforeKick = false;
      }
    } else {
      nNull += 1;
    }

    segmentRows.push({
      eventId: g.eventId,
      injuryKnown: labels.injuryKnown,
      edge: g.edgeAbsMbase,
    });
  }

  const sample = sampleChecks({
    nJoinAttempt,
    nKnown,
    nNull,
    nHome,
    nAway,
    allKnownCaptureBeforeKick,
    coercionViolations,
  });

  const floorsMet =
    sample.find((s) => s.id === "N2")?.pass === true &&
    sample.find((s) => s.id === "N3")?.pass === true;

  const segment = floorsMet
    ? evaluateE4SegmentConservatism(segmentRows)
    : null;

  // M_inj path: only note — requires separate edges with e4ConservativeAdjust.
  // This harness refuses to score M_inj unless caller supplies inj edges later.
  const injNote =
    "M_inj not scored here — requires fresh prospective edges with e4ConservativeAdjust on usable_pre_kick only; does not inherit FINAL_EVAL pass";

  const status: E4ProspectiveReport["status"] = floorsMet
    ? "SEG_SCORED"
    : "INSUFFICIENT_DATA";

  return {
    status,
    e4Resolved: false,
    productE4Cleared: false,
    mBaseFrozenUntouched: true,
    mInjInheritsFinalEval: false,
    sample,
    segment,
    injNote,
    nJoinAttempt,
    nKnown,
    nNull,
    nHome,
    nAway,
    policy: E4_POLICY,
  };
}

/**
 * Build M_inj edge magnitude from M_base edge + conservative adjust metadata.
 * Diagnostic only — never write into FINAL_EVAL frozen score.
 */
export function mInjAdjustMeta(opts: {
  kickoffIso: string;
  availability?: AvailabilityInput | null;
}): ReturnType<typeof e4ConservativeAdjust> {
  return e4ConservativeAdjust(opts);
}
