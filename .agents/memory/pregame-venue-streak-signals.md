---
name: Pre-game venue / streak / season signals + pick price-authenticity gap
description: Real ESPN-derived pre-game ML/spread signals (home-away splits, current streak, season record), where they plug in, and the known limit that pick validation does NOT check price/point.
---

# Pre-game ML/spread signals (venue split, streak, season record)

Goal: make pre-game moneyline/spread calls smarter using ONLY real data, and
surface alt-spread value when an ML favorite is pricey.

**Key insight — no new feed needed.** ESPN's per-team `/schedule` (already pulled
by `fetchTeamHistory` in history.ts) carries every completed game with `isHome`,
`won`, `margin`. So home/away venue splits, current W/L streak, and full-season
record are all derivable from data already in hand — just reduce the existing
results list, never add a feed or fabricate.

**4-hop flow (same as other pick signals):** history.ts `/sports/matchup-history`
→ client chat-context builder → context object the AI sees → chat.ts SYSTEM_PROMPT
rule. Plus the client mirrors the same matchup map into `matchupHistoryByGame`
state so `generateReasoning` ("Why this pick?") can render the real numbers.

**Venue orientation (easy to get backwards):** the upcoming game is at the HOME
team's building, so the relevant read is the home team's HOME split vs the away
team's ROAD split. `venueDiff = homeHomeSplit.avgMargin − awayAwaySplit.avgMargin`,
positive favors home. Context keys: `homeVenueForm` ← home.homeSplit,
`awayVenueForm` ← away.awaySplit, plus `homeStreak/awayStreak`,
`homeSeason/awaySeason`. A form bucket with `games:0` must be nulled out so the AI
won't lean on an empty split.

**Local scorer caps:** venue bump ±6 ML / ±5 spread, streak bump ±5 — deliberately
small so these stay SECONDARY to live score/margin and to the existing L10/H2H
reads. They live inside the Moneyline and Spread branches only.

**SIDE-markets only for streak/venue notes.** A streak/venue note is keyed to ONE
team; Totals have no side, so applying it there misattributes the read. Gate the
`generateReasoning` trend block to a SIDE_MARKETS set (Moneyline/Spread/Alt
Spread/Run Line/Puck Line), NOT `market !== "Player Prop"`.

**Fabrication removed:** `generateReasoning` previously synthesized a fake
"(sample)" win streak from a hash seed — a core-principle violation hiding behind
the "(sample)" label. Replaced with the REAL streak/venue from matchupHistory,
honest silence when absent. **Why:** the no-fabrication rule applies to "Why this
pick?" copy too, not just the AI edge notes.

## Known gap — pick validation does NOT check price/point (pre-existing, pipeline-wide)
`filterPicksToReal` (ParlayBuilder.tsx) only validates that a leg's GAME is a real
in-window matchup (team-token overlap + [-4h,+48h] window). It does NOT verify the
market/selection/point/price exists in realOdds. So a hallucinated alt-spread rung
or price on a REAL game can pass through to the slip. Enforcement today is
prompt-only ("NEVER invent an alt point or price not in realOdds", repeated in
several rules). **Why not fixed inline:** a true price-tuple validator touches every
market in a heavily-tuned pipeline and risks dropping legit legs over price/label
normalization differences (merged book prices, point formatting, nickname vs full
name — see tracker-pick-string-forms.md). Treat as a deliberate follow-up, not a
quick bolt-on. The alt-spread "value play" rules inherit this same prompt-only
guarantee — they don't add a new class of risk (alt usage was already pushed by
the existing ALTERNATE LINES + MATCHUP-EDGE→ALT-LINE rules).
