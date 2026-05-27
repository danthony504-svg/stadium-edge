---
name: Bovada odds fallback
description: Third-tier real-odds fallback after Odds API and ESPN, using Bovada's free public coupon JSON
---

Bovada exposes an unauthenticated coupon JSON used as the third fallback in the Stadium Edge odds chain (Odds API → ESPN pickcenter → Bovada).

URL: `https://www.bovada.lv/services/sports/event/coupon/events/A/description/{sportPath}?marketFilterId=def&preMatchOnly=true&lang=en` with `User-Agent` header required.

**Why these specific quirks matter:**

- Payload is `Array<{events}>` — multi-container for soccer (one container per league, ~120 leagues, 500+ events); single-container for US sports. Always `flatMap(c => c.events)`, never `data[0].events`.
- Market keys: `2W-12` h2h, `3W-1X2` 3-way h2h (soccer), `2W-HCAP` spread, `2W-OU` total. Map both `2W-12` and `3W-1X2` to h2h (drop draw side — UI doesn't render it).
- Period label varies by sport: `"Game"` for US sports, `"Regulation Time"` for soccer. Whitelist both; without this the soccer mapper silently returns 0 markets.
- Side matching must prefer outcome `type` field (`"H"`/`"A"`/`"O"`/`"U"`/`"D"`) then `competitorId`, with description as last resort — team `description` strings don't always equal the competitor `name` (accents, suffixes).
- Prices are strings like `"-165"` / `"+140"`; strip leading `+` before `parseInt`. `startTime` is unix ms.
- `preMatchOnly=true` inherently excludes finished games (the demo's no-fake-data rule), so no extra post-filter needed.
- **No UFC**: all obvious Bovada paths (`martial-arts/mma`, `ufc`, `martial-arts/ufc`, `mma/ufc`) return 404. Omit UFC from the path map so the route returns 400 and the chain falls through.
- Public scrape — observed 429s under burst. Mitigations live: 60s server cache + 30/min rateLimit. If tightening needed, increase cache TTL before adding retries.

**How to apply:**

When adding a new sport, verify the Bovada path returns 200 first, then check `period.description` and market `key` values — if they don't match the existing whitelists, extend `isFullGamePeriod` or the market key branches rather than adding a new ad-hoc mapper.
