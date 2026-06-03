---
name: Player Props analytics (suggested lines + set-your-line) — real-only
description: How the mobile Player Props "analytics" block stays inside the never-fabricate rule, and why it diverges from the web version.
---

# Player Props analytics: hit-rate explorer, real-only

The web app (stadium-edge ParlayBuilder) Player Props modal has an "analytics"
block — **Suggested lines** (Safe/Balanced/Risky pills) + **set-your-line**
stepper with Over/Under prices. The web version FABRICATES: odds come from a
`decimalToAmerican(1.9 ± diff*0.5)` formula and it carries a "sample hit-rate,
not a prediction / odds are estimates" disclaimer. That violates the project's
hard never-fabricate rule, so the mobile port (stadium-mobile
`components/PlayerPropsSheet.tsx`) must NOT copy it 1:1.

**Real-only mobile rules:**
- Suggested-line **values** are hypothetical (derived from the real game log:
  Safe = min−STEP, Balanced = snapped recent avg, Risky = max+STEP), but the
  **hit-counts are empirical** (count of real games clearing that line). Present
  as "real hit-rate … not a prediction". No odds on the pills.
- The set-your-line stepper shows real recent average + real hit-rate at any
  chosen line, but **Over/Under prices only appear when the chosen line equals
  the posted book line** (`atBookLine`). Off the book line, price is `null` →
  disabled "—" chip + caption explaining the price is posted only at the book
  line. Never run an estimate formula.
- **Why this works on mobile:** mobile props are MAINS-ONLY (props.tsx
  `fetchAllProps` filters `!p.alt`), so each market has exactly ONE real line
  (`selectedProp.line` + over/under). There is no alt ladder to price against,
  so any non-book line genuinely has no real odds.

**State gotcha:** an adjustable `chartLine` (not the static book line) drives the
chart dashed line, bar-cleared coloring, and hit caption. Seed it from the book
line (or rounded recent avg if none posted) and reset on market change via
`useEffect([selectedProp?.market, bookLine, recentAvg])`. Keep all hooks before
the `if (!data) return null` guard. `addPick` builds the pick from
`selectedProp.line`, so an added leg always uses the real posted line/odds and
survives slip validation.

## AI Suggested card (in-modal)
PlayerPropsSheet has an "AI Suggested" card (between Recent Performance and
Suggested Lines) that recommends a real pick. aiSuggestion useMemo: null unless
selectedProp+bookLine+bars; overHits=bars.value>=bookLine, pick side with more
real hits, return null if that side has no posted price (FAIL-CLOSED). pct is the
empirical hit rate (NOT a projection); tier strong>=70/lean>=57/toss. Add button
calls addPick(side, price) at the real posted book price; the pick-string in the
hasLeg check must match addPick's `${player} ${side} ${line} ${label}` form for
dedupe. Never surface odds away from the book line.
