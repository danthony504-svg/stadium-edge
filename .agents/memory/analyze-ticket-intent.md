---
name: Analyze-the-ticket chat intent
description: Mobile "Analyze ticket" read-only slip critique — how it's detected client+server and why it must stay distinct from improve
---

# Analyze-the-ticket chat intent

Mobile-only "Analyze ticket" action: SlipBar overlay button sends a fixed
"Analyze my ticket" prompt to the Coach (router.push to /coach with
`prefill`+`send:"1"`+fresh `ts`, the standard auto-send pattern). The server
streams an HONEST, READ-ONLY breakdown of the slip the user ALREADY built
(letter grade, leg-by-leg risk, correlation warnings, real combined-odds /
implied-win-prob math, weakest leg) and emits NO PICK/ALT lines — the slip is
never modified.

## Why it's a SEPARATE flow from "improve"
"Improve this slip" REBUILDS (diversifies / swaps legs). "Analyze" only
critiques. They share the same `currentSlip` context plumbing
(`slipForContext`→`buildChatContext`→`context.currentSlip`→server contextBlock
JSON) but must not collide:
- server: `analyzeIntent = analyzeWording && !improveIntent && currentSlipLen>0`
  (improve WINS — "make it better" owns that phrasing).
- client: `wantsAnalyzeSlip(t) = ANALYZE_SLIP_RE.test(t) && !wantsImproveSlip(t)`.

## Read-only guarantee (the real gotcha)
The base SYSTEM_PROMPT is heavily build-oriented, so the read-only behavior is
enforced in THREE layers, not just the prompt:
1. `analyzeSystemAddendum` (chat.ts) — appended into the system message
   (concatenated alongside improveSystemAddendum); forbids any line starting
   `PICK:`/`ALT:`, mandates the combined-odds/implied-prob math (honest "can't
   compute" escape only if a leg has no real price), grade + leg-by-leg +
   correlation + weakest leg.
2. client `coach.tsx`: when `isAnalyze`, `picks = []` AND `emittedPickLines = 0`
   so NO add-cards render and the "couldn't ground any of those legs"
   empty-bubble refusal note can never fire even if the model slips a stray PICK
   line through. The analysis prose renders as a normal chat bubble.
3. "Analyze my ticket" deliberately does NOT match PARLAY_BUILD_RE / requestedLeg
   count → `isParlayBuild=false` → no "Building parlay…" lead-in suppression, no
   background-finish; prose streams normally.

## Slip-player enrichment (the "but this is a ticket you picked" fix)
Analyze sends the SAME generic capped/balanced slate context as a build, so a
deep same-game slip's prop players are NOT in `playerHistory` — the Coach then
honestly-but-uselessly says "no game log in my feed" on EVERY leg it picked. Fix:
`buildChatContext` now takes an `analyzeSlip` flag; when set + `currentSlip` has
legs it extracts each PROP player's name and pulls their REAL recent game log
into `playerHistory` (recentFormOnly).
- The existing named off-pool form-question enrichment was refactored into a
  shared `enrichRecentForm(candidates)` closure (whole-word + active-player guard
  intact); the analyze pass reuses it, so a TEAM name (team total) or a bare
  total never binds to an athlete — fail-closed, never fabricated.
- Player name is parsed by `slipPropPlayerName(pick)` (pure module `lib/slipPlayer.ts`,
  unit-tested): text before the first ` over|under|yes|no` token; null for ML /
  spread / bare total. Pick format is `"<Player> <Side> <line> <stat>"`.
- coach.tsx passes `wantsAnalyzeSlip(trimmed)` as the new (last) buildChatContext
  arg. chat.ts analyze addendum now tells the model the slip players' logs ARE in
  playerHistory so it uses them before claiming no data.

## How to apply
- Any new analyze phrasing must go in BOTH `coach.tsx` ANALYZE_SLIP_RE and
  `chat.ts` analyzeWording or the halves drift. Restart api-server after editing
  chat.ts (no watcher). chat.ts SYSTEM_PROMPT is a backtick literal — never write
  `${...}` inside addendum strings.
- Honesty rule still binds: per-leg reads are grounded ONLY in real context data;
  no-data legs are stated plainly, never fabricated.
- Client analyze/enrichment changes need an EAS OTA to reach the installed app
  (dev/preview is live immediately).
