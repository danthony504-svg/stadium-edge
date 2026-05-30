---
name: Moneyline winner consistency (mlLean)
description: How the deterministic winner-pick lean is computed client-side and enforced in the chat prompt so the same game never flip-flops its moneyline side across requests.
---

# Moneyline flip-flop → deterministic winner (mlLean)

Symptom: the chat AI picked one team to win a game on one request and the
opposing team on the next for the SAME matchup (e.g. Blue Jays vs Orioles).

## The fix has two halves — both are required

1. **Client computes the winner deterministically.** A pure helper
   `computeMlLean(label, data)` in `ParlayBuilder.tsx` (near the
   `matchupHistory` build) mirrors the existing `scoreCandidate` engine: signed
   home-edge from L10 avgMargin (×1.2 ±10) + season winPct diff (×15 ±8) +
   venue split avgMargin (×0.9 ±6) + streak diff (×1.2 ±5) + H2H (×2 ±5).
   Deadzone → returns `null` when no signals OR |edge|<1 (genuinely too close —
   don't force a side). Returns `{side, edge, reasons[]}` for the favored team,
   attached as `mlLean` onto each `matchupHistory[gameLabel]` entry sent to chat.
   Because it's a pure function of the fetched data, the side is stable.

2. **Prompt enforces commitment.** `chat.ts` SYSTEM_PROMPT documents the
   `mlLean` field and has a "MONEYLINE CONSISTENCY — COMMIT TO ONE WINNER" rule
   that forces any moneyline/"to win" pick to `mlLean.side`.

## The non-obvious gotcha: it must override TWO rules, not one
**Why:** the prompt has multiple competing side-selection directives. Overriding
only the RANDOM-TICKET VARIETY rotation rule is NOT enough — the **VALUE OVER
CHALK** rule (the "run both sides, pick the larger edge, often the underdog"
directive) independently tells the model to flip to the opposing team. An
architect review caught this as a residual flip path.

**How to apply:** the consistency rule must explicitly say it supersedes BOTH
the variety rule AND value-over-chalk *for the winner side only*. Frame it as:
`mlLean.side` fixes WHO wins; value-over-chalk only refines HOW you bet that
side (ML vs spread/alt/total/prop, or SKIP the moneyline) — it must never pick
the other team. Add the reciprocal note inside the value-over-chalk rule too, so
neither rule reads as the final word. The only legitimate override is the LIVE
dead-market rule (don't take a trailing team's already-dead ML — skip the ML,
never take the other side as a workaround). When `mlLean` is absent, default to
the shorter-priced ML in realOdds and still never alternate.

## Smaller correctness notes
- Always emit at least one entry in `reasons[]` — if the edge came only from the
  streak differential, the other reason-pushes are skipped and `reasons` would
  be empty, breaking the prompt's "echo mlLean.reasons" requirement. Push a
  favored-side win-streak reason (≥2, type W) and a generic fallback when empty.
- Don't cite a losing skid as a reason FOR the favored side (contradictory) —
  only cite a win streak.
