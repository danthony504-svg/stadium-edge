---
name: Downloadable parlay-slip PNG
description: How the Stadium Edge slip-image (download ticket) is rendered and the data-honesty rules that bound it
---

`downloadTicketImage` in `artifacts/stadium-edge/src/ParlayBuilder.tsx` renders the
shareable parlay slip to a PNG via the raw canvas API (no library, fully offline).

**Design:** premium DARK infographic style (stadium glows, centered SE logo + title,
3-cell hero panel, per-leg rows with colored market badge + monogram chip + per-leg
confidence, 3-cell payout panel, "WHY THE AI LIKES THIS PARLAY" panel with a
half-circle confidence gauge, footer). It is `async` because it `await`s the local
logo asset (`stadiumEdgeLogo`) via an `Image` with `onerror→null` fallback so a logo
failure never blocks the download. The onClick is fire-and-forget (no await needed).

**Why only real data:** the user supplied a marketing infographic mock that included
fabricated betting signals (sharp money %, public bets %, line movement, edge score,
win record). Those were deliberately NOT drawn — the app has no feed for them and
inventing them violates the anti-fabrication rule. Everything shown is derived from
in-scope slip state: `calculateConfidence` (per leg), `parlayConfidence`,
`parlayMath`, `payout`, the user-adjustable `stake` (NOT the old hardcoded $10),
and team/prop counts (`market === "Player Prop"` is the prop classifier).

**How to apply / gotchas:**
- Canvas height `H` is computed up-front from fixed per-section heights + `legs.length*rowH`;
  if you add/resize a section, update the `H` sum or rows clip.
- All variable text goes through `fit(text,maxW,font)` (ellipsis truncation), never wraps.
- Edge cases handled: all-PrizePicks slips (`bookLegCount===0` → "PP SLIP" / "DFS"),
  single-leg ("LEG" vs "LEGS").
- Logos must stay LOCAL/bundled assets — remote (ESPN) logos can taint the canvas and
  make `toBlob` throw, silently breaking the download. Keep it offline.
- Verified visually by dropping a standalone `public/slip-test.html` that copies the
  draw fn with sample legs reproducing the reference (+2356, 4% conf), screenshotting,
  then deleting the test files. Reuse that trick to re-verify layout changes.
