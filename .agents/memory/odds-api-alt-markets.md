---
name: Odds API alternate markets endpoint
description: alternate_spreads/alternate_totals are per-event only on The Odds API — bulk /odds call rejects them with 422.
---

The Odds API v4 only accepts `h2h,spreads,totals` (and the core team markets) on the bulk `/v4/sports/{sport}/odds` endpoint. Requesting `alternate_spreads` or `alternate_totals` there returns HTTP 422 `INVALID_MARKET` and kills the whole call (no main odds either).

**Why:** alt ladders are a different product tier — per-event only at `/v4/sports/{sport}/events/{eventId}/odds`, and priced at 5x credit cost vs main markets.

**How to apply:** fetch mains in bulk, then fan out per-event for alts. Cap which events you fan out to (e.g. only upcoming games inside the user-facing window, slice to ~12) and cache per-event for longer than the bulk call (10 min vs 5 min) to keep credit spend sane. Wrap each per-event fetch in try/catch — a single failed event must not blank the whole game list.
