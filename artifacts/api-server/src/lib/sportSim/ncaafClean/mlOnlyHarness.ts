/**
 * Moneyline-only research harness for frozen clean E1 α=1.15.
 * Spreads/S2 reported as separate blocked market — never auto-fail ML.
 * Closes are eval-only. FINAL_EVAL scoring requires explicit allow flag (default off).
 */

import { CLEAN_E1_ALPHA, CLEAN_E1_CANDIDATE_ID, predictE1Frozen } from "./e1Frozen.ts";
import {
  CLV_CRITERIA,
  evaluateClvCriteria,
  evaluateMlCriteria,
  finalMlAcceptanceLabel,
  ML_CRITERIA,
  ML_ONLY_POLICY,
  type ClvMetricInputs,
} from "./mlOnlyCriteria.ts";
import { buildPregameFromFixtureRow } from "./features.ts";
import { pHomeMlFromMargin, settleMoneyline } from "./settlement.ts";
import { CleanOppAdjStrength } from "./strength.ts";
import { NCAAF_CLEAN_ENGINE_STAMP } from "./stamp.ts";
import type { CleanFixtureGameRow } from "./types.ts";

export type MlCloseRow = {
  gameId: string;
  closeMlHome?: number | null;
  closeMlAway?: number | null;
};

export type MlHarnessGame = CleanFixtureGameRow & {
  /** When true, outcomes must not drive model selection (FINAL_EVAL vault). */
  outcomeSealed?: boolean;
};

function brier(ps: number[], ys: number[]): number | null {
  if (!ps.length || ps.length !== ys.length) return null;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += (ps[i]! - ys[i]!) ** 2;
  return s / ps.length;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) return 0.5;
  if (american < 0) return (-american) / (-american + 100);
  return 100 / (american + 100);
}

export type MlHarnessOpts = {
  split: "TUNING" | "FINAL_EVAL";
  /** Must be true to compute M1–M4 on FINAL_EVAL rows. Default false. */
  allowFinalEvalScoring?: boolean;
  season: number;
  /** Prior-season games for seed (pre-kickoff ratings only). */
  seedGames: CleanFixtureGameRow[];
  /** Chronological walk games (TUNING and/or priors). Updates use finals. */
  walkGames: MlHarnessGame[];
  /** Score only these event IDs (e.g. identical-334). */
  scoreEventIds: Set<string>;
  closes: Map<string, MlCloseRow>;
  /** Optional CLV inputs; omit → missing evidence. */
  clv?: ClvMetricInputs;
  e4InjuryValidated?: boolean;
  useVenueSidecar?: boolean;
};

export type MlHarnessReport = {
  stamp: typeof NCAAF_CLEAN_ENGINE_STAMP;
  candidateId: typeof CLEAN_E1_CANDIDATE_ID;
  alpha: typeof CLEAN_E1_ALPHA;
  split: "TUNING" | "FINAL_EVAL";
  allowFinalEvalScoring: boolean;
  scored: boolean;
  policy: typeof ML_ONLY_POLICY;
  lockedCriteria: { ml: typeof ML_CRITERIA; clv: typeof CLV_CRITERIA };
  spreadsMarket: {
    status: "BLOCKED_SEPARATE_GATE";
    note: "S2 failure does not automatically fail ML";
  };
  metrics: {
    nMl: number;
    mlBrier: number | null;
    mktBrier: number | null;
    deltaVsMarket: number | null;
    meanP: number | null;
    meanY: number | null;
    bias: number | null;
  };
  mlCriteria: ReturnType<typeof evaluateMlCriteria>;
  clvCriteria: ReturnType<typeof evaluateClvCriteria>;
  acceptance: ReturnType<typeof finalMlAcceptanceLabel>;
  withhold: Record<string, number>;
  notes: string[];
};

/**
 * Causal walk: seed → predict (pre-kickoff state only) → update from final.
 * Scoring uses eval-only closes; never as features.
 */
export function runMlOnlyHarness(opts: MlHarnessOpts): MlHarnessReport {
  const allowFinal = opts.allowFinalEvalScoring === true;
  const notes: string[] = [];
  const withhold: Record<string, number> = {};

  if (opts.split === "FINAL_EVAL" && !allowFinal) {
    notes.push(
      "FINAL_EVAL scoring refused — allowFinalEvalScoring=false (membership/state prep only)",
    );
    const clv = evaluateClvCriteria(
      opts.clv ?? {
        available: false,
        nMlWithClv: null,
        meanClvProbPoints: null,
        pctSelectionsBeatClose: null,
        homeSelections: null,
        awaySelections: null,
        softGatesOk: null,
        earlyCachePicks: null,
      },
    );
    return {
      stamp: NCAAF_CLEAN_ENGINE_STAMP,
      candidateId: CLEAN_E1_CANDIDATE_ID,
      alpha: CLEAN_E1_ALPHA,
      split: opts.split,
      allowFinalEvalScoring: false,
      scored: false,
      policy: ML_ONLY_POLICY,
      lockedCriteria: { ml: ML_CRITERIA, clv: CLV_CRITERIA },
      spreadsMarket: {
        status: "BLOCKED_SEPARATE_GATE",
        note: "S2 failure does not automatically fail ML",
      },
      metrics: {
        nMl: 0,
        mlBrier: null,
        mktBrier: null,
        deltaVsMarket: null,
        meanP: null,
        meanY: null,
        bias: null,
      },
      mlCriteria: evaluateMlCriteria({
        nMl: 0,
        mlBrier: null,
        mktBrier: null,
        meanP: null,
        meanY: null,
      }),
      clvCriteria: clv,
      acceptance: finalMlAcceptanceLabel({
        split: opts.split,
        allowFinalEvalScoring: false,
        ml: [],
        clv,
        e4InjuryValidated: opts.e4InjuryValidated === true,
      }),
      withhold,
      notes,
    };
  }

  const strength = new CleanOppAdjStrength({ season: opts.season });
  strength.seedFromPriorSeason(
    opts.seedGames
      .filter((g) => g.homeFg != null && g.awayFg != null)
      .map((g) => ({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeFg: g.homeFg!,
        awayFg: g.awayFg!,
        season: g.season,
        kickoffIso: g.kickoffIso,
      })),
  );

  const ps: number[] = [];
  const ys: number[] = [];
  const mkt: number[] = [];

  const walk = [...opts.walkGames].sort((a, b) =>
    String(a.kickoffIso).localeCompare(String(b.kickoffIso)),
  );

  for (const g of walk) {
    const pre = buildPregameFromFixtureRow(g, {
      useVenueSidecar: opts.useVenueSidecar !== false,
    });
    const pred = predictE1Frozen({ pregame: pre, strength });

    const shouldScore =
      opts.scoreEventIds.has(String(g.eventId)) &&
      !(g.outcomeSealed === true && opts.split === "TUNING");

    // Selection isolation: sealed FINAL_EVAL outcomes never used for α/param choice
    // (α already frozen). Scoring FINAL_EVAL only when allowFinal && split FINAL_EVAL.
    const scoreThis =
      shouldScore &&
      (opts.split === "TUNING" ||
        (opts.split === "FINAL_EVAL" && allowFinal && !g.outcomeSealed));

    // Actually for FINAL_EVAL when allowFinal, we NEED outcomes to score M1-M4.
    // outcomeSealed means inaccessible to *selection* — scoring uses them under allowFinal.
    const scoreFinal =
      opts.split === "FINAL_EVAL" &&
      allowFinal &&
      opts.scoreEventIds.has(String(g.eventId));
    const scoreTuning =
      opts.split === "TUNING" && opts.scoreEventIds.has(String(g.eventId));

    if (scoreTuning || scoreFinal) {
      void scoreThis;
      if (!pred.ok) {
        withhold[pred.reason] = (withhold[pred.reason] ?? 0) + 1;
      } else if (!pred.evaluableSupported) {
        withhold.not_evaluable = (withhold.not_evaluable ?? 0) + 1;
      } else {
        const close = opts.closes.get(String(g.eventId));
        if (close?.closeMlHome == null) {
          withhold.missing_close_ml = (withhold.missing_close_ml ?? 0) + 1;
        } else if (g.homeFg == null || g.awayFg == null) {
          withhold.missing_final = (withhold.missing_final ?? 0) + 1;
        } else {
          const ml = settleMoneyline({
            homeScore: g.homeFg,
            awayScore: g.awayFg,
            decided: true,
          });
          if (!ml.ok) {
            withhold.ml_tie_or_invalid = (withhold.ml_tie_or_invalid ?? 0) + 1;
          } else {
            ps.push(pHomeMlFromMargin(pred.marginMean, pred.marginSd));
            ys.push(ml.yHomeWin);
            mkt.push(americanToImplied(close.closeMlHome));
          }
        }
      }
    } else if (!pred.ok) {
      // walk-only withhold not counted for screen
    }

    // Causal update from observed final — allowed for chron state; not "selection"
    if (g.homeFg != null && g.awayFg != null) {
      strength.update({
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeFg: g.homeFg,
        awayFg: g.awayFg,
        season: g.season,
        kickoffIso: g.kickoffIso,
      });
    }
  }

  const mlBrier = brier(ps, ys);
  const mktBrier = brier(mkt, ys);
  const meanP = mean(ps);
  const meanY = mean(ys);
  const metrics = {
    nMl: ps.length,
    mlBrier,
    mktBrier,
    deltaVsMarket:
      mlBrier != null && mktBrier != null ? mlBrier - mktBrier : null,
    meanP,
    meanY,
    bias: meanP != null && meanY != null ? meanP - meanY : null,
  };

  const mlCriteria = evaluateMlCriteria(metrics);
  const clvCriteria = evaluateClvCriteria(
    opts.clv ?? {
      available: false,
      nMlWithClv: null,
      meanClvProbPoints: null,
      pctSelectionsBeatClose: null,
      homeSelections: null,
      awaySelections: null,
      softGatesOk: null,
      earlyCachePicks: null,
      note: "Clean E1 CLV not measured — early two-sided cache missing",
    },
  );

  if (opts.split === "TUNING") {
    notes.push(
      "TUNING ML screen only — M3 true here is not FINAL_EVAL PASS",
    );
  }
  notes.push("Closes used as eval labels only — not in predict features");
  notes.push("Spreads/S2 out of scope for this harness");

  return {
    stamp: NCAAF_CLEAN_ENGINE_STAMP,
    candidateId: CLEAN_E1_CANDIDATE_ID,
    alpha: CLEAN_E1_ALPHA,
    split: opts.split,
    allowFinalEvalScoring: allowFinal,
    scored: true,
    policy: ML_ONLY_POLICY,
    lockedCriteria: { ml: ML_CRITERIA, clv: CLV_CRITERIA },
    spreadsMarket: {
      status: "BLOCKED_SEPARATE_GATE",
      note: "S2 failure does not automatically fail ML",
    },
    metrics,
    mlCriteria,
    clvCriteria,
    acceptance: finalMlAcceptanceLabel({
      split: opts.split,
      allowFinalEvalScoring: allowFinal,
      ml: mlCriteria,
      clv: clvCriteria,
      e4InjuryValidated: opts.e4InjuryValidated === true,
    }),
    withhold,
    notes,
  };
}
