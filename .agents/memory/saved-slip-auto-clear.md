---
name: Saved-slip cap + auto-clear (mobile)
description: How stadium-mobile caps saved bet slips and auto-removes finished ones safely.
---

# Saved-slip cap + auto-clear (stadium-mobile Bet Slip tab)

Saved slips live in `BetSlipContext` (`savedSlips`, persisted to AsyncStorage).

## Cap
- `MAX_SAVED_SLIPS` (currently 25) enforced in `saveCurrentSlip` via
  `[slip, ...s].slice(0, MAX)` (newest-first, oldest fall off). Bounded storage.

## Auto-clear finished slips
- Done at render in `slip.tsx` (SlipScreen), NOT in context. The same `getGames`
  feed already fetched for AI-pick art is reused; the sport set is the union of
  aiPicks sports AND savedSlips legs' sports.
- `legGameStatus(games)(label, sport)` matches a leg's "Away @ Home" label to the
  feed by **team nickname** (last word, lowercased), order-independent.
- **Fail-closed rule (critical, was a flagged data-loss bug):** matching is
  sport-scoped and requires EXACTLY ONE candidate. 0 or >1 matches → "unknown"
  → slip kept. This blocks cross-sport nickname collisions and doubleheaders from
  falsely deleting a slip. A slip is deleted only when EVERY leg is "over";
  any "live"/"unknown" leg preserves it. Never delete on missing/ambiguous data.
- "over" = ESPN `state==="post"` OR status matches /final/ OR `startsAt` past a
  6h buffer.

**Why:** the main `/sports/games` feed includes finished games (status "Final",
state "post") but only within a ~yesterday→+7d window, so finished games drop off
after ~a day. Auto-clear therefore fires while results are still visible; older
dropped games become "unknown" and the slip simply lingers (acceptable — we never
delete on missing data). Legs carry `sport` but NOT a startsAt or game id, so
nickname+sport+unique-match is the resolution signal.

## Download button gotcha
- Each SavedSlipCard's "Save to Photos" button mirrors the active-slip one
  (`saveSlipToPhotos(slip.legs, slip.stake)`). "Button not showing" on device is
  almost always a stale Metro bundle — restart the `artifacts/stadium-mobile: expo`
  workflow so the device reloads fresh JS.

## Saved-slip pending-status display (display-only grading)
- A parlay grades atomically: a slip mixing finished + future games (e.g. created
  yesterday but containing tonight's games) silently waits in Saved Slips with no
  feedback → user thinks Model Report grading is broken ("No settled bets yet").
- `SavedSlipCard` now shows a summary line + per-leg ✓/✗/clock. Per-leg status:
  game not over → "pending"; over → server grader's real win/loss/push/ungraded;
  over-but-not-loaded → "grading". `anyLoss` surfaces "Parlay lost" even with
  pending legs (a confirmed losing leg is determinative). all-push → "Parlay
  pushed" (NOT "won"); a leftover ungraded leg stays in neutral "N/N settled".
- Powered by a SEPARATE display-only `useQueries` (`["saved-slip-grade", id,
  overIdx]`, 5min stale, enabled when ≥1 leg over) reusing the same `gradeBets`
  server grader — does NOT mutate slips/results. The existing grade-then-archive
  effect still solely owns committing settled slips to the Model Report.
- **Why grading must be honest:** grader fail-closes to "ungraded"; never invent
  a W/L. Mobile-only, OTA-unsafe → ships next native build.
