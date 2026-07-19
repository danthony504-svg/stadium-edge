// Fast prescore for every prop before Monte Carlo — EV estimate, matchup, odds value.

import type { ParsedPick } from "../components/PickCard.tsx";
import { impliedProb } from "./format.ts";

export type QuickPrescoreSignals = {
  evEstimate: number;
  matchupGrade: number;
  oddsValue: number;
  total: number;
};

function rubricScore(
  pick: ParsedPick,
  key: "matchup" | "trend" | "lineShopping" | "lineValue" | "simulation",
): number | null {
  return (
    pick.finalAiScore?.rubric?.scores?.[key] ??
    pick.scores?.scores?.[key] ??
    null
  );
}

/** Lightweight prescore without Monte Carlo — ranks the pool before deep sim. */
export function quickPropPrescore(pick: ParsedPick): QuickPrescoreSignals {
  const edge = pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null;
  const composite = pick.finalAiScore?.composite ?? pick.scores?.composite ?? null;

  let evEstimate = edge ?? 0;
  if (!evEstimate && pick.odds != null) {
    const fair = pick.finalAiScore?.fairProb;
    if (fair != null && Number.isFinite(fair)) {
      evEstimate = Math.round((fair - impliedProb(pick.odds)) * 1000) / 10;
    }
  }

  const matchup = rubricScore(pick, "matchup");
  const trend = rubricScore(pick, "trend");
  const lineShop = rubricScore(pick, "lineShopping");
  const lineValue = rubricScore(pick, "lineValue");

  const matchupGrade =
    matchup != null
      ? matchup
      : trend != null
        ? trend
        : composite != null
          ? composite / 10
          : 0;

  let oddsValue = lineShop ?? lineValue ?? 0;
  if (!oddsValue && pick.odds != null) {
    if (pick.odds >= 500) oddsValue = 8;
    else if (pick.odds >= 200) oddsValue = 7;
    else if (pick.odds >= 100) oddsValue = 6;
    else if (pick.odds >= -110) oddsValue = 4;
    else oddsValue = 2;
  }

  const total = evEstimate * 0.45 + matchupGrade * 2.5 + oddsValue * 2.2;
  return { evEstimate, matchupGrade, oddsValue, total };
}
