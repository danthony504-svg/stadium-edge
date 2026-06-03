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
