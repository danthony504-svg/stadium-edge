---
name: Confidence-threshold lock (mobile Coach)
description: How a "9 to 10 confidence" parlay ask is honoured when the Confidence badge is derived, not AI-set
---

# Confidence-threshold lock

A user asking for "5 leg with **9 to 10 confidence**" used to get legs scoring
8.6/7.7/7.6 — none in the band. The 0–10 Confidence badge is **client-derived
from each leg's stated EDGE** (`deriveConfidenceScore`), NOT set by the AI, so a
confidence-band request was an unhandled class of constraint.

**Rule:** treat a confidence band as a per-leg derived-score filter, mirroring
the odds-threshold lock exactly. Parse the band, steer the model via a server
prompt addendum, then **hard-filter the resolved legs client-side using the SAME
score function**. Never inflate an edge to hit the number; honest-short if too
few qualify; a leg with no stated edge derives a `null` score and is excluded
(there is no confidence to verify).

**Why:** confidence is downstream of edge, and edge is grounded/real. The only
way every rendered card truly sits in the band is to recompute the card's own
score post-parse and drop the misses — prompt steering alone leaks under scarcity
(same lesson as odds-threshold-parlay and ai-pick-safety-net).

**How to apply:**
- Single source of truth: `lib/confidence.ts` (deriveVariance,
  deriveConfidenceScore moved out of PickCard; parseConfidenceThreshold,
  confidenceSatisfiesThreshold, describeConfidenceThreshold). PickCard imports
  them — don't re-fork the formula.
- Score recompute in coach.tsx is
  `deriveConfidenceScore(parseEdgeStats(p.edge).edge, deriveVariance(p.odds, p.isProp))`.
- Gate reach-N backfill off when a confidence threshold is active (alongside the
  odds-threshold gate) or filtered legs get reintroduced as low-confidence fillers.
- `parseConfidenceThreshold` is DUPLICATED in client (lib/confidence.ts) and
  server (api-server chat.ts) and MUST stay in sync — same hazard as the 3
  parseOddsThreshold copies. Requires a `\bconf` word; strips "/10"/"out of 10";
  precedence range>max>min; rejects >10; returns null with no conf word so it
  won't trip on "5 leg" or odds bounds. A band whose ceiling is 10 reads as
  "9/10 or higher", not "9–10/10".
- Mobile JS is OTA-unsafe (appVersion runtimeVersion) → ships next native build.
  api-server has no watcher → restart after the prompt addendum change.
