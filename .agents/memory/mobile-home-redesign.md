---
name: Mobile Home parlay-assistant redesign
description: How the stadium-mobile Home screen reproduces the web parlay-assistant layout under the never-fabricate rule, plus the Coach auto-send token pattern.
---

The mobile Home (`artifacts/stadium-mobile/app/(tabs)/index.tsx`) mirrors the web ParlayBuilder home layout: logo, search pill, tagline, "Build best parlay" button, three quick chips (Hot Picks / Easy Money / Lottery Ticket), Featured Players row, Live Now row, then the existing Upcoming odds list.

**Never-fabricate substitution (the key decision):** the web app's FEATURED PLAYERS show a hardcoded `form X/10` rating from a sample `PLAYERS` object — pure fabrication. The mobile App-Store build forbids that. Featured Players are instead built ONLY from real bookmaker props: fan out `getProps` over the soonest ~4 pickable games of the selected sport, take non-alt lines with real `overPrice`+`line`+`headshot`, dedupe by player, cap 8. The card's third line is the REAL prop (`o{line} {label} {price}`), never a form score.
**Why:** copying the web's fake form rating would violate the hard never-fabricate rule the whole mobile app exists to satisfy.
**How to apply:** any "featured/notable players" surface on mobile must derive its headline stat from a real feed (props/game-log), not a rating. Team abbr is resolved by matching `prop.playerTeamId` against the game's `homeTeamId`/`awayTeamId` → `homeAbbr`/`awayAbbr` (props feed has no abbr/position). Featured row is gated to `PROPS_SPORTS` only.

**Coach auto-send token pattern:** quick chips + Build button + Live "build from this game" navigate to `/coach` with `{prefill, send:"1", ts:Date.now()}`. coach.tsx auto-sends in an effect gated by the per-navigation `ts` token — NOT the prefill text — because tabs stay mounted and several actions share the same prompt text ("Build me the best parlay" is used by both Build button and Hot Picks); text-keyed guard suppresses later taps. Mark sent only after invoking send, and skip while `streaming` (effect re-runs when streaming flips false so the send isn't lost).

Featured-player tap and the search pill route to `/props` with `{q, sp}` params; props.tsx reads them via `useLocalSearchParams` + a sync `useEffect` to seed search query + sport selector.
