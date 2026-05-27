---
name: ESPN scoreboard live fields
description: Where to read real in-game clock/period/period-label from ESPN's public scoreboard JSON.
---

The public ESPN scoreboard endpoint (`site.api.espn.com/.../scoreboard`) exposes the live game state on BOTH `event.status` and `event.competitions[0].status`. Read the competition-level one first and fall back to the event-level one — competition status updates more reliably mid-game (especially for MLB inning state and soccer halves).

Fields worth surfacing for a live UI:
- `status.displayClock` — formatted clock string ("8:42", "0:00"). Raw `status.clock` is a number.
- `status.period` — integer period (1..N). Compare against the sport's regulation period count (NFL=4, NBA=4, NHL=3, MLB=9, soccer=2, NCAAF=4, NCAAB=2) to estimate elapsed fraction.
- `status.type.shortDetail` — the human-friendly label fans see on espn.com ("Q3 8:42", "Bot 7th", "HT", "OT", "Final"). Use this as the `periodLabel`. `type.description` ("In Progress") is too generic.
- `status.type.state` — coarse state: `"pre" | "in" | "post"`. Use it to derive a status when `type.description` is missing instead of defaulting to "Scheduled".

**Why:** ESPN doesn't ship per-game win probability on the scoreboard endpoint — that lives on a separate `probabilities` endpoint per event. Don't fabricate one; render "—" if you don't fetch it.

**How to apply:** When proxying ESPN into our `GET /sports/games` response, project these fields onto the `EspnGame` schema as nullable (`clock`, `period`, `periodLabel`, `state`). UI consumers must treat them as nullable and never substitute zeros or placeholders for missing values.
