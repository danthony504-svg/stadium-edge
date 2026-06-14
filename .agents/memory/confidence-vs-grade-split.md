---
name: Confidence vs Grade split (mobile Coach)
description: Grade=value/edge, Confidence=real de-vigged win chance; the parseEdgeStats two-track gotcha and the coin-flip cushion lean.
---

# Confidence vs Grade are decoupled (mobile)

- **Grade** = VALUE/edge rating (`scoreLineValue`/composite, unchanged). **Confidence** = REAL
  de-vigged win chance = `winChancePct(odds, edge)` = `americanToImplied(odds)*100 + edgePct`,
  clamped 5–95, **null** when there's no real price+edge to de-vig. `deriveConfidenceScore(gap, odds)`
  = `winChancePct/10` (0–10). A strong-value coin flip → high grade but ~50% confidence.
- **Why:** users asked "9–10 confidence" to mean win-chance bands, and a value grade was being
  read as a win-probability. The two must move independently.

## Two-track edge gotcha (the real trap)
- The card **EdgeReadout** AND the Coach **confidence-threshold filter** both derive grade+confidence
  from `parseEdgeStats(p.edge).edge` (the model's STATED edge prose) + `p.odds`. They are consistent
  with each other but are a SEPARATE track from `attachPickScores`, which re-resolves the REAL backing
  edge from realOdds/propPool and feeds `ScoreBreakdown`. This split is pre-existing — don't "unify" it
  as part of an unrelated change.
- **How to apply:** anything that swaps a leg's pick/odds/market AFTER the model emitted its EDGE prose
  MUST rewrite `p.edge` too, or the parseEdgeStats track applies the OLD rung's edge to the NEW odds and
  lies about win chance.

## Coin-flip cushion lean
- `leanCoinFlipToCushion(picks, realOdds, propPool)` in coach.tsx swaps a coin-flip (`mainWin <= ~56`)
  ML or player-prop leg onto its safer REAL cushion rung (`altOptions.cushion`) so win-chance Confidence
  rises while Grade may stay C. Only swaps when `cushionEdge != null` AND `cWin > mainWin` (strictly).
- Gated to confidence-band asks only: runs when `confidenceThreshold` is set AND not
  oddsThreshold/altSign/altRungBias/wantsValueRungs/wantsLongshot. Placed BEFORE the confidence filter.
- On swap it rewrites `p.edge` to the cushion's OWN real numbers (`Model ~{cWin}% win chance, implies
  {x}%, {±}{e}% edge …`) shaped to satisfy parseEdgeStats' projected/implied/edge regexes — so card,
  filter, and attachPickScores all agree on the cushion's real win chance. Never fabricates: every number
  traces to the real cushion odds + the realOdds/propPool edge.

## Web parity (deferred)
- api-server `src/routes/chat.ts` confidence addendum still describes the OLD edge/variance confidence
  math (≈ `5.5 + edge*0.45 ± variance`). chat.ts is SHARED web+mobile and the web client still uses
  edge-based confidence, so flipping the prompt now would break web. Flip the server addendum + web
  PickCard confidence TOGETHER in a web-parity pass. The mobile lean + win-chance filter bridge the gap
  meanwhile (model aims edge; lean raises coin-flip win chance; win-chance filter enforces the band).
