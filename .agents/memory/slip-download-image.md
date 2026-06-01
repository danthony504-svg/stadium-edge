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

**Current layout (poster redesign):** header (logo + two-line "AI PICKS / PARLAY CARD"
title + right info box: picks/teams/prop counts, AI-confidence segmented bar, "BUILT BY
AI / BACKED BY DATA" tagline, 3 mini feature labels) → two-column masonry of league
panels (legs grouped by league then market family, monogram chip + game + pick + odds +
conf%) → CORE N-LEG (top-by-confidence subset) + FULL N-LEG summary panels each with a
combined "AI PROJECTED ODDS" from `comboOdds()` (bookable `Number.isFinite(odds)` legs
only) → feature-badge strip → disclaimer.

**How to apply / gotchas:**
- Canvas height `H` is computed up-front from fixed per-section heights + masonry/summary
  sums; if you add/resize a section, update the `H` math or content clips.
- **Header collision:** define the right info-box geometry (`boxW/boxX/boxY/boxH`) BEFORE
  drawing the title, so the title can be width-clamped to `boxX - margin`. Otherwise a long
  title overruns and renders behind/cut by the box. Title auto-fits font + stacks 2 lines.
- All variable text goes through `fit(text,maxW,font)` (ellipsis truncation), never wraps.
- Edge cases: all-PrizePicks slips (`bookLegCount===0` → "PP SLIP"/"DFS"; `formatOdds`
  returns "PP line" for null odds), single-leg ("LEG" vs "LEGS").
- Logos must stay LOCAL/bundled assets — remote (ESPN) logos can taint the canvas and
  make `toBlob` throw, silently breaking the download. Keep it offline.
- **Verify offscreen-canvas visually:** drop a throwaway `public/_*.html` that defines mock
  legs + the helper deps, pastes the draw-fn body with the final `canvas.toBlob(...)` swapped
  for `canvas.style.width/height=…; document.body.appendChild(canvas)`, copy the logo to
  `public/`, then screenshot `/_*.html`. PITFALL: use `body{display:block}` and don't leave a
  stray empty `<canvas>` — a default flex layout makes the appended canvas sit side-by-side
  and clip. Delete the throwaway HTML + copied asset when done.
