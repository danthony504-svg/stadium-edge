---
name: Thin-slate big-parlay period unlock
description: Why a generic "N-leg today" parlay under-fills on a small slate, and the effective-supply gate that fixes it without crowding the chat context budget.
---

# Thin-slate big-parlay under-count

**Symptom:** "do 15, only today's games" comes back ~8 with an honest "pool too thin"
note, even though the same-day board has plenty (e.g. 6 WNBA games each carrying full
quarter/half period ladders + ~15 MLB games).

**Root cause:** in the chat-context build, a GENERIC big parlay (not a named game, no
explicit period/sgp intent) emits only full-game ML/Spread/Total per game — period
markets are gated to named/period intent. So the AI sees ~3 full-game markets per game;
after one-leg-per-game + anti-correlation it stops near the game count. Game-level
PERIOD markets (independent settlement windows) never reach it, and it wrongly dismisses
a whole sport (e.g. WNBA) for having no PLAYER PROPS.

**Fix (two halves, both required):**
1. Client (chat send path): unlock period markets for the build when EFFECTIVE supply
   falls short of N. Trigger on `(distinctEligibleGames + usablePropPlayers) < requestedLegs`,
   NOT on raw game count. Then throttle per-game period depth so the 120-entry context
   cap still spans every eligible game (reserve ~3 full-game entries per game; few-game
   slates keep the full period sample, a ~14-game boundary slate drops to ~5).
2. Prompt (SYSTEM_PROMPT N-leg bullet): a THIN-SLATE DEPTH clause telling the AI not to
   stop at one leg per game — reach N by pairing a game's Spread+Total (different families,
   allowed; never same-team ML+Spread) and by using period windows (each a different
   settlement window = independent under per-family×period), note the same-game/period
   correlation honestly, keep every HARD BAN, and only fall short if even periods can't
   supply N legs that pass the bans.

**Why effective-supply, not raw game count:** triggering on `games < N` alone fires on
near-rich slates (e.g. 14 games + props for N=15) where full-game sides + props already
reach N. Unlocking periods there spikes per-game depth and lets the global realOdds
slice(120) truncate later games, costing cross-game breadth. Count usable distinct prop
players toward supply so periods open ONLY when genuinely needed.

**Honesty invariant preserved:** still returns a SHORT ticket with an explicit note when
even Spread+Total + period windows can't supply N independent legs. Period legs are real
markets from realOdds, never fabricated.

**Verify:** direct `/api/chat` with a thin WNBA-only realOdds (full-game + period
markets, empty realProps) + a 15-leg "today only" ask should return exactly 15 PICK
lines, several from 1H/Q* windows, no duplicate family×period×game, no same-team ML+Spread.

**Related:** game-level-period-markets-context.md (buildPicksFromOdds must EMIT periods
when includePeriods), big-parlay-prop-fetch-cap.md (the breadth/prop-reserve cap this sits
beside), period-intent-enforcement.md, anti-correlation-period-picks.md.
