---
name: Confidence badge vs market-implied
description: Why "market picks" complaints can't be fixed by prompt changes alone — the pick-card confidence badge is computed client-side from market-implied prob, independent of the AI.
---

The pick-card confidence badge ("49% · COIN-FLIP") is computed CLIENT-SIDE by
`calculateConfidence(pick)` (ParlayBuilder.tsx), which starts at the market's
implied probability (`score = impliedProb(odds)*100`) and only nudges it with
sample data (player form, coaches, weather, hash variance). So the badge IS the
market number.

**Why:** A user kept complaining the AI "only picks market picks" across multiple
turns. Earlier fixes were prompt-only (value-over-chalk reframe in chat.ts) and
NEVER moved the badge — because the badge isn't driven by the AI at all. No prompt
change can fix this perception.

**How to apply:** When a complaint is about what the user SEES on a pick card
(confidence %, COIN-FLIP label, "edge"), check the client render path FIRST, not
the prompt. The fix that worked: parse the AI's OWN projected % out of its EDGE
note (`parseAiProjection`) and use THAT for the badge, with a green/red
"+X% vs mkt" edge chip (proj − implied). Fall back to `calculateConfidence` only
when no projection is parseable.

Gotchas in the parser:
- The EDGE note states BOTH implied and projected (chat.ts prompt ~line 215
  requires "−150 implies 60%, ... puts this ~68% → +8% edge" for every
  ML/spread/total/period side). Player props intentionally carry NO projected %
  (prop edge notes ban price-as-edge framing), so props always fall back — that's
  fine, just don't show the edge chip for them.
- Must reject the signed edge DELTA ("+8% edge") and qualitative notes ("rest edge
  only") so they aren't read as a projection. Reject signed numbers and numbers
  immediately followed by edge/gap/ev/vs/delta.
- Normalize Unicode minus (−, U+2212) to ASCII before matching.
- Note lookup: notes are keyed off the RAW parsed pick label; the render uses the
  canonical relabeled pick. Look up canonical key first, then
  `${rawPick.game}::${rawPick.pick}` as fallback, or canonical relabeling silently
  drops the projection.

Scope: only the chat pick cards were rewired. Slip legs (`confidenceAtAdd`),
parlay-confidence product, and the demo-picks drawer remain market-anchored by
design.
