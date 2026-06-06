---
name: Underdog watch push notification
description: How the daily model-backed underdog push alert is computed/gated on the server and surfaced on mobile
---

# Underdog watch push notification

A daily push that surfaces REAL model-backed underdogs (Upset Watch ported to the
notification backend).

- **Source of truth is shared with the in-app Upset Watch.** The server (api-server
  notifyJobs) ports computeMlLean + the upset definition verbatim from the client
  (mobile lib/api.ts / web ParlayBuilder). An upset = the analytics lean lands on
  the side carrying the LONGER real American price AND that side is genuine
  plus-money (>= +100). Real h2h prices only — fail-CLOSED, never invent a dog.
- **Cost is bounded by a once-per-UTC-day GLOBAL block.** The expensive ESPN +
  odds fan-out (computeDailyUpsets) runs ONCE per day, cached in appKv under
  `upsetdaily:<date>`, gated to fire after DAILY_HOUR_UTC. Per-user at-most-once
  delivery via notif_log key `upset:<date>`. Empty result stores `[]` and sends
  nothing.

**Why:** the cron ticks many times a day; without the KV day-cache every tick would
re-run the full matchup-history fan-out across every sport.

**How to apply / gotchas:**
- The odds price map MUST be sport-namespaced (`<sport>|Away @ Home`, via
  `priceKey`). Same game label can collide across sports (e.g. same school in
  ncaaf vs ncaab) and silently overwrite prices. Both the lookup AND the
  has-price sort must use the namespaced key.
- Label join is `${awayTeam} @ ${homeTeam}` using ESPN names; nickname = last
  whitespace token (NOT lowercased) to match the odds-feed side names. Honest skip
  on any mismatch.
- New pref `upsetAlerts` is auto-whitelisted by the PUT route because it derives
  PREF_KEYS from `Object.keys(DEFAULT_PREFS)` — only add it to DEFAULT_PREFS
  (server) + NotifPrefs (mobile lib/api.ts) + the settings toggle + tap routing
  (`upsetAlert` -> home, where the Upset Watch card lives). No route schema edit.
