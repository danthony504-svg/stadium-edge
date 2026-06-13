---
name: Real prop-pick factors now feed-available
description: Three formerly "needs-a-feed" prop signals (recent-form windows, opponent pace, minutes trend) are now real and wired; their league/range constraints.
---

Three prop-pick factors that betting-signal-data-boundary.md once listed as unsupported are now REAL and wired into the AI prop pipeline (chat context + SYSTEM_PROMPT). Don't re-derive them or treat them as unavailable.

- **Recent-form windows (L10 / L20 per-stat averages)**: built server-side in player-history from the real game log (splitAverages over the flat log). Client `buildChatContext` forwards ONLY non-empty `last10`/`last20` — it deliberately drops `last5` because `recent` (the 5 most-recent games) already covers it. Don't re-add last5 to `windows` on the client.
- **Opponent PACE (NBA / WNBA ONLY)**: `teamPace(sport, teamName)` in statmuse.ts, possessions-per-game from StatMuse. Strict league gate + a hard 85–115 range guard + parse only the pace/possessions-adjacent number (no loose grab) → null on anything off. Surfaced on matchup-history as `home.pace`/`away.pace` (client `homePace`/`awayPace`). It's an OPPONENT-pace tilt for PLAYER props (faster opp ⇒ more counting-stat volume), distinct from the points-based `combinedPace` totals proxy.
- **minutesTrend (NBA / WNBA ONLY)**: `{l5,l10,season,direction}` on player-history, emitted only when the log has a MIN column; null otherwise. Volume signal: rising minutes → over leans, minutes cut → under.

**Why:** the boundary memory warned "never prompt-add an unsupported signal — it forces fabrication." These three crossed into supported, so the prompt now documents them; but each is NULLABLE/omitted on any miss and pace/minutes are NBA/WNBA-only — never fabricate them for other sports.

**How to apply:** any future prop-factor work should reuse these (don't invent a parallel pace/minutes path); honor the league gates and the pace range guard; keep new fields in chat.ts's NEVER-EXPOSE-INTERNAL-NAMES list (windows/minutesTrend/homePace/awayPace/pace are already there).
