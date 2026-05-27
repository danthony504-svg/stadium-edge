---
name: Finals suppression belt-and-braces
description: How to suppress finished games in a multi-feed UI without nuking long-running live games — combine status keywords with a time-based safety net, but gate the time net behind an active-status bypass.
---

# Rule

When suppressing finished games across UI surfaces fed by two independent feeds (odds feed + score feed) whose team-name strings don't byte-match, use a two-layer filter:

1. **Status-keyword set** (`finalKeys`) — primary, built from the score feed.
2. **Time-based safety net** (`isLikelyDoneByTime`, ~4h after start) — secondary, catches games whose status lookup failed because the team-name strings didn't match between feeds (e.g. "LA Lakers" vs "Los Angeles Lakers").

But the time net MUST be bypassed for games known to be actively in-progress, or it will hide legitimately long-running games. Build a parallel `liveKeys` set from active-status keywords (`in progress`, `live`, `halftime`, `delay`, `suspend`, `rain`, `overtime`, `extra`, `end of`) and skip the time cutoff when the matchup key is in `liveKeys`.

**Why:** A naked time cutoff ignores reality — MLB extra innings, rain delays, NCAAF long bowls, soccer ET+penalties can all push a game past any reasonable "done by" threshold. The user's complaint was finished MLB games lingering ~5h post-start; the fix is NOT to make the time net more aggressive globally, it's to keep it aggressive only when the score feed has no opinion (unknown status / scheduled / name mismatch).

**How to apply:** Anywhere we iterate `realOdds`/`realGames` to render game cards, replace `if (isLikelyDoneByTime(x)) continue;` with `if (!liveKeys.has(key) && isLikelyDoneByTime(x)) continue;`. For the scheduled-real-games loop, gate on the game's own status: `if (!isActiveStatus(g.status) && isLikelyDoneByTime(g.startsAt)) continue;`. Keep the threshold ≤4h so finals don't linger, but the active-status bypass means delayed games of any duration still render.

# Related

- ESPN MLB scoreboard reports `clock:"0:00"` for finished games (`state:"post"`). That clock field is post-game padding, NOT a kickoff time — render sites must suppress `0:00` / `0:0` clock strings (baseball has no minute clock anyway, only innings).
