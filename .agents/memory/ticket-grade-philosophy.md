---
name: Whole-ticket grade philosophy
description: Why the parlay overall letter grade measures construction quality, not leg count / parlay cash-probability
---

# Whole-ticket grade philosophy

A built/analyzed parlay's overall letter grade (A–F) was coming back D on big
(e.g. 15-leg) tickets even when every leg was sharp, because the chat.ts
SYSTEM_PROMPT told the model to weigh "leg count" and that "a 15-leg ticket is a
longshot no matter how good the legs are." That conflated two different things.

**Rule:** the overall grade measures **construction quality** — real line
value/edge on the chosen legs, leg INDEPENDENCE (low correlation, no duplicate /
anti-correlated exposure), and price efficiency — NOT the raw number of legs. A
long parlay of genuinely sharp, independent, +EV legs is well-built and should
grade B-to-A. Reserve C/D/F for tickets whose legs lack edge, are chalk with no
value, or are correlated/contradictory.

**Why:** the user asked why a built 15-leg ticket got a D and why the Coach
doesn't aim for A/B at any size. Grading on leg count punished good selection
for something the user explicitly chose (size) and is mathematically baked into
the combined odds anyway. The honest "longshot" disclosure is NOT removed — it
moves to the combined-odds / implied-probability line ("well-built, but ~X% for
all N to land"). We never claim a big parlay is likely to cash — that stays
honest; we just stop double-penalizing it in the construction grade.

**How to apply:** the philosophy is a global SYSTEM_PROMPT rule (governs both the
build verdict and the read-only ANALYZE-the-ticket verdict, which references it).
Prompt-only change → restart the api-server workflow (one-shot build+start, no
hot reload) AND it reaches mobile/web through the deployed server, so a published
app needs a redeploy, not just a dev restart.
