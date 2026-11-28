import { marketFamily } from "./altLinePool.ts";

type LinePick = {
  isProp?: boolean | null;
  market?: string | null;
  sport?: string | null;
  sportsbook?: string | null;
  finalAiScore?: { rubric?: { composite?: number | null } | null } | null;
};

export function coachSpreadIsUncalibrated(pick: LinePick): boolean {
  return !pick.isProp && marketFamily(pick.market ?? "").endsWith("spread");
}

export function coachTotalIsUncalibrated(pick: LinePick): boolean {
  return !pick.isProp && marketFamily(pick.market ?? "").endsWith("total");
}

export function collegeCoachLegHasEvidence(pick: LinePick): boolean {
  return !/^(ncaaf|ncaab|cfb|cbb)$/i.test(pick.sport ?? "") ||
    Boolean(pick.sportsbook?.trim() && Number.isFinite(pick.finalAiScore?.rubric?.composite));
}

export function coachTimeBudgetNote(returned: number, target: number): string {
  return `Stopped at time budget. Returned ${returned} of ${target} qualified legs.`;
}


export function coachLineHoldReason(pick: LinePick): "check_line" | "college_evidence_missing" | null {
  if (coachSpreadIsUncalibrated(pick) || coachTotalIsUncalibrated(pick)) return "check_line";
  return collegeCoachLegHasEvidence(pick) ? null : "college_evidence_missing";
}
