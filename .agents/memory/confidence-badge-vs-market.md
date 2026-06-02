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

## Prompt↔parser wording is a contract (totals coin-flip trap)
The chat.ts prompt EXAMPLE phrasing for a projected % must use vocabulary
`parseAiProjection` actually recognizes, or the badge silently falls back to
market and shows "COIN-FLIP". The totals HARD MANDATE once modeled a note that
cited only `combinedPace` with NO projected % — so totals always read as
coin-flip even though the prompt elsewhere required a projection. The model
mirrors the nearest concrete example, so the example itself must be parseable.
**Why:** an example that contradicts the master "state projected vs implied %"
rule wins under scarcity. **How to apply:** when you add/relax a prompt example
that should produce a projection, paste the exact phrase through the
`parseAiProjection` regex (anchors: project/puts this·it·over·under/model/
estimate/fair value/closer to/more like + bare N%) before shipping. If you want
new wording (e.g. "puts OVER ~N%"), extend the parser anchor in lockstep.

## Props CAN be real model picks — projection is grounded, not fabricated
Reversal of the earlier "props intentionally carry NO projected %" stance. We
already feed the AI real prop data per leg: `playerHistory.recent` (last-5 stat
lines), `playerHistory.vsOpponent` (prior games vs tonight's opponent),
home/away/tonight splits, and `opponentDefense` (shooting % → rebound room,
turnovers → steals, avgPointsAgainst → scoring). The prompt now REQUIRES, when
playerHistory has data, a parseable projected hit % GROUNDED in the empirical
hit count (how many recent / vsOpponent games actually cleared the line) plus the
defensive/home-split tilt — stated with `parseAiProjection` wording + the price's
implied %. That makes the prop a real edge pick with a green chip, not a market
price. **Why:** the data to justify a defensible projection was always there; the
only gap was that props never emitted a parser-readable %. **How to apply:** the
honesty escape is mandatory — thin/contradictory/absent sample ⇒ NO projected %
(qualitative lean only) ⇒ card correctly reads "MARKET PRICE". Never manufacture
a pseudo-precise % from a hit count of 1-2 games. The projected % must trace to
real cleared-the-line counts, never to the price.

## "Use more AI picks not MARKET picks" → widen playerHistory coverage
A recurring complaint that the cards show "MARKET PRICE" too often is usually NOT
a prompt problem — it's COVERAGE. A prop card can only show a grounded projection
when `context.playerHistory` has that player's game log; otherwise it honestly
falls back to "MARKET PRICE". The client only fetches game logs for the first N
unique players (`phTargets = playerTargets.slice(0, N)` in ParlayBuilder.tsx), so
any recommended prop for an uncovered player necessarily reads market-price.
**Fix that worked:** raise that cap (was 20 → 40; fetches are parallel + server-
cached 30min) AND add a chat.ts find-props TIE-BREAKER: prefer recommending props
whose player HAS a playerHistory entry (so the pick carries a real projected hit %)
over no-history props. **Why:** more grounded data ⇒ more cards show the AI's
projection + green edge chip instead of the bare market number. **How to apply:**
the tie-breaker must be explicit it is NOT a fabrication license (a no-history prop
with the genuine best edge may still be picked, leaned on honestly) — never invent
game logs to make a prop look data-backed. realProps cap is 400 but history cap is
40, so coverage is improved, not complete; bumping further trades latency/token
budget for coverage.

## Requested-market props read MARKET PRICE → ORDER, not just cap size
When the user names a market ("5-leg strikeout parlay") and EVERY returned leg
reads "MARKET PRICE", the cause is usually prop-ORDER starvation at the two
independent caps, not the prompt and not the cap size. Props are collected in
prop-order where a game's requested-market props sit LAST (e.g. pitcher_strikeouts
trail ALL the batter props in that game). So on a wide ask: (a) `playerTargets`
fills the 40-player game-log cap with batters before reaching the picked pitchers
→ those pitchers get NO `playerHistory` → no projection → MARKET PRICE; and
independently (b) `realProps` can push the requested market past the 400 prompt
cap so the server market-locks an empty pool ("0 <market> props available").
**Fix that worked:** detect the requested market ONCE (hoist `PROP_MARKET_KEYWORDS`
/ `reqMarketEntry` / `isReqMarket` above the playerTargets loop), collect
`reqMarketAthletes` during the realProps build, then stable-partition BOTH lists
to float requested-market players/props to the front before each slice
(`phSource`→phTargets, orderedProps→400-cap). **Why:** the data chain (athleteId
enrichment + player-history per-start counts + prompt projection rule) all works;
the only gap was the picked players never surviving the fetch cap. **How to apply:**
verify the full chain with curl first (props with `homeTeamId`/`awayTeamId` →
athleteId; player-history → real stat counts) so you fix COVERAGE/ORDER, not the
prompt. Gate the float on `reqMarketEntry` so generic requests are unchanged.

## Prop badge: "MARKET PRICE", not "COIN-FLIP"
Player props fall back to the market-implied number ONLY when the AI emits no
projection (no/thin playerHistory — see section above). Labeling that "COIN-FLIP"
reads as a model verdict it isn't. The chat card shows "MARKET PRICE" when
`proj == null && isPropPick`.
`isPropPick` = market is NOT a game-side market; the game-market regex must
include period prefixes (1H/2H/Q1-4), `alt`, a `live` prefix (live picks use
"Live Moneyline"/"Live Total"), and soccer labels (match result / draw no bet /
double chance / both teams to score). Anything else (stat names like Points,
Rebounds, Home Runs, Anytime TD) is a prop. **Why:** a too-narrow regex
misclassifies live/soccer game sides as props and mislabels them.

## "MARKET PRICE" tag complaint = AI dropping the prop projected hit %
User reads "60% · MARKET PRICE" on a prop card and asks "why not just show AI confidence %". Do NOT relabel the number — that 60% IS the book's implied prob (badgeIsMarketOnly = no parseable projection + isPropPick), so calling it "AI confidence" would fabricate a model read. The HONEST fix: make the AI actually emit a grounded projected hit % so parseAiProjection surfaces it and the badge shows "<proj>% · LEAN/STRONG" instead of MARKET PRICE.
**Root cause:** the chat prompt already REQUIRES a projection-worded hit % for props where playerHistory has data (turns prop→model pick), but the AI drops it — it justifies props with the PRICE/ladder ("priced near his upper band", "17.5 under -125") which is the banned price-as-edge AND leaves the badge nothing to read → forced MARKET PRICE. Added a PROP BADGE SELF-CHECK bullet tying the requirement to this exact user-visible symptom. Props with genuinely no game log honestly stay MARKET PRICE — never invent a % to dress one up.
