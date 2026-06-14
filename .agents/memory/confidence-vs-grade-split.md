---
name: Confidence vs Grade split (mobile Coach)
description: Grade=value/edge, Confidence=real de-vigged win chance; the parseEdgeStats two-track gotcha and the coin-flip cushion lean.
---

# Confidence vs Grade are decoupled (mobile)

- **Grade** = VALUE/edge rating (`scoreLineValue`/composite, unchanged). **Confidence** = REAL
  de-vigged win chance from `winChancePct(odds, edge, fairProb?)`, clamped 5–95, **null** when no
  real basis. `deriveConfidenceScore(gap, odds, fairProb?)` = `winChancePct/10` (0–10). A strong-value
  coin flip → high grade but ~50% confidence.
- **Why:** users asked "9–10 confidence" to mean win-chance bands, and a value grade was being
  read as a win-probability. The two must move independently.

## Win-chance has TWO real bases (fairProb wins)
- `winChancePct` prefers the picked side's no-vig consensus fair WIN PROB `fairProb` (0–1) when valid,
  else falls back to `implied(odds) + edge`. **Why this matters (the non-+EV-side bug):** the server
  attaches `edge` ONLY to the +EV side of a two-sided main market, so the OTHER side (e.g. a -1 spread
  @ -110) had `edge=null` → Confidence "—" while Grade still rendered (composite averages the other
  present sub-scores). It looked broken.
- **Fix:** `RealOddsEntry.noVigFair` is present on BOTH sides of a two-sided main market, so game picks
  pass it through (`scoreGamePick` → `combinePickScore(..., ro.noVigFair)`). **Props stay edge-only** —
  `PropPoolEntry` carries NO both-sides fair prob, so adding one would be fabrication. `fairProb` is an
  OPTIONAL last param everywhere (`winChancePct`/`combinePickScore`/`deriveConfidenceScore`) so the
  edge-only callers (coin-flip cushion lean on alt rungs, which lack noVigFair) are untouched.

## Two-track edge gotcha (the real trap)
- The card **EdgeReadout** AND the Coach **confidence-threshold filter** historically derived
  grade+confidence from `parseEdgeStats(p.edge).edge` (the model's STATED edge prose) + `p.odds` — a
  SEPARATE track from `attachPickScores`/`ScoreBreakdown`, which re-resolve the REAL backing entry from
  realOdds/propPool. This split is pre-existing — don't "unify" it as part of an unrelated change.
- The confidence FILTER now reads the same real backing entry the card scores via
  `pickWinChanceInputs(pick, realOdds, propPool)` → `{edge, fairProb}` (game: realOdds match →
  noVigFair+edge; prop: propPool match → edge only), with the prose-edge `parseEdgeStats(p.edge)` kept
  as the fallback: `deriveConfidenceScore(edge ?? parseEdgeStats(p.edge).edge, p.odds, fairProb)`. Keep
  the prose fallback so the cushion-lean rewrite path still works.
- **How to apply:** anything that swaps a leg's pick/odds/market AFTER the model emitted its EDGE prose
  MUST rewrite `p.edge` too, or the parseEdgeStats fallback applies the OLD rung's edge to the NEW odds
  and lies about win chance.

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
