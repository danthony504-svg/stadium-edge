---
name: Confidence vs Grade split (mobile Coach)
description: Grade=weighted-avg value composite; Confidence=additive points from REAL rubric signals (NOT win chance). Coin-flip cushion lean was REMOVED.
---

# Confidence vs Grade are two readings of the SAME real signals (mobile)

- **Grade** = weighted-AVERAGE VALUE composite (`combinePickScore.composite` → `gradeFromComposite`,
  WEIGHTS lineValue.3/matchup.25/trend.2/injury.15/lineShopping.1), unchanged.
- **Confidence** = `confidenceFromSignals(scores)` (pickScore.ts): baseline 50 + Σ per-PRESENT-factor
  `((s-5.5)/4.5)*10`, clamp 5–95, round, **null when 0 signals present**. So Grade rates the AVERAGE
  quality of the signals; Confidence rewards BREADTH — more strong aligned signals = higher confidence.
- **Why:** users read a value Grade as a win-probability; the chosen fix (via user_query) is that
  Confidence should be BUILT UP additively from how many real signals back a pick, not a win chance.
- Honest by construction: a signal we can't ground (null sub-score) adds nothing; a sub-score below the
  5.5 neutral SUBTRACTS (weak/contrary signal lowers confidence — not inflation-only). Never fabricated.

## Scale + where it's read
- `combinePickScore.confidencePct` now = `confidenceFromSignals(scores)` (0–100). `oddsAmerican`/
  `fairProb` params are KEPT (void'd) for call-site compatibility + the edge passthrough; confidence no
  longer derives from price.
- `confidenceScoreFromSignals(scores)` (confidence.ts) = `Math.round(confidenceFromSignals)/10` → the
  0–10 BAND used by the "9–10 confidence" threshold. null propagates (ungroundable leg can't clear a floor).
- Card display: `ScoreBreakdown.tsx` HeaderTiles renders `data.confidencePct` 0–100 with NO "%" suffix
  (it is a conviction score, not a probability). `confidenceBlurb` thresholds 75/60/45 unchanged.
- Coach filter (coach.tsx, confidence-threshold branch): scores legs via
  `attachPickScores(picks,{realOdds,propPool,matchupHistory,matchupInjuries})` then filters by
  `confidenceScoreFromSignals(p.scores?.scores)` (note: attached `p.scores` is a `CombinedPickScore`; its
  nested `.scores` is the `PickSubScores`). Filter & card both flow from `confidenceFromSignals`, so the
  pass/fail and the displayed number agree (card shows 0–100, filter compares the same value on 0–10).

## deriveConfidenceScore (win-chance) is now a FALLBACK ONLY
- `deriveConfidenceScore(gap, odds, fairProb?)` = `winChancePct/10` STILL EXISTS but is used only by
  surfaces with NO rubric to score: PickCard `EdgeReadout` fallback (game-detail) + `TicketScanSummary`
  (a user's arbitrary slip). Those have just price+edge, so de-vigged win chance is the honest reading
  available there. Its old tests stay valid. Don't delete it.

## Coin-flip cushion lean was REMOVED
- The old `leanCoinFlipToCushion` + `COIN_FLIP_MAX_WIN` (coach.tsx) swapped a coin-flip ML/prop onto a
  safer cushion rung to RAISE win-chance confidence. Under signals-based confidence a cushion rung has a
  WORSE price → LOWER lineValue sub-score → LOWER confidence, so the lean became counterproductive.
  Deleted (const + function + gated call). Cleaned now-unused coach imports: `winChancePct`,
  `americanToImplied`, `deriveConfidenceScore`, `parseEdgeStats`, `pickWinChanceInputs`.

## Web parity (still deferred)
- Mobile only. api-server `src/routes/chat.ts` confidence addendum + web PickCard still use the OLD
  edge/win-chance confidence; chat.ts is SHARED, so flip the server addendum + web client TOGETHER in a
  web-parity pass. Mobile is self-consistent meanwhile.
