---
name: Mobile Player Props premium redesign
description: PropVisuals real-data visual kit + where it's wired (Player Props list rails + prop detail AI Breakdown), and the RN percent-string typing gotcha.
---

# Mobile Player Props premium redesign

Premium App-Store-quality redesign of the two mobile prop surfaces, keeping the
dark-navy/blue theme. All visuals are **real-data-only / null-safe** — they render
nothing (return null) when the backing real numbers are absent. Never fabricate.

## Shared visual kit — `components/PropVisuals.tsx`
- `ConfidenceRing` — SVG arc gauge (react-native-svg) fed a real percent.
- `TrendBarChart` — flex vertical bars with a dashed posted-line marker, green =
  cleared / muted = missed, opponent x-axis + legend. **Input contract: caller
  passes NEWEST-first; the component reverses internally to oldest→newest.**
- `ProjectedRangeBar` — low→high range track + projection dot + posted-line marker.
- `MiniStat` — tiny icon + label + value tile (icon is `keyof Feather.glyphMap`).

## Where wired
- Detail `app/prop/[id].tsx`: "AI Breakdown" hero (LinearGradient card with
  ConfidenceRing + big AI-Grade letter + edge/hits chips), gated on
  `propScore.composite != null`; old 7px recent-games bars REPLACED by a "RECENT
  FORM" section = TrendBarChart + ProjectedRangeBar.
- List `app/(tabs)/props.tsx`: enrich the **RAILS not every row** (per-row full
  grading is cost-infeasible). AI RECOMMENDED grade items + VALUE (+EV) items each
  get a MiniStat strip below the PickCard: grade items show AI Grade / Recent
  (hits/n) / Hit % / Best; value items show Edge / Fair / Best. Badge stays a
  headline pill (caption dropped so the strip doesn't duplicate it). Upset and
  honest-fallback rec items carry no strip (no real grade to show).
- **Do NOT change the PropRow / PickCard pick-string format** — single source of
  truth for slip dedupe/AI parity.

## RN + TS gotcha (cost 2 attempts)
A style `left`/`width` percent must satisfy `DimensionValue`. A template literal
`` `${n}%` `` where `n` is a number **infers `string`**, not the literal type, so
tsc rejects it. Fix: type the value as `` `${number}%` `` (helper return type or
a typed const) and assign the typed const directly — do NOT re-wrap it in another
`` `${var}%` `` template or you get a double-`%` (`${number}%%`) type error.
