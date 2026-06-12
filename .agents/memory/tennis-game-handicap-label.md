---
name: Tennis spread = "Game Handicap" label
description: Why tennis/table-tennis spread cards relabel to "Game Handicap" and why it must stay display-only
---

In tennis (and table tennis) the "spread" market is a GAMES handicap (e.g. -4.5 games), not a points spread, so the card badge reads "Game Handicap" / "Alt Game Handicap".

**Why:** Showing a generic "SPREAD" badge on a tennis games-handicap line reads wrong to bettors.

**How to apply:** Relabel is DISPLAY-ONLY (`marketDisplayLabel(market, sport)` in PickCard.tsx, applied at the badge render only). NEVER change the underlying `market` value — it's the slip leg key (`game|market|pick`), the dedupe family key, and what `parsePicks` matches AI PICK lines back to. Changing it would silently break leg matching/dedupe. The real market name stays "Spread"/"Alt Spread" everywhere functional; only the rendered text changes. `sport` is reliably populated on game legs by parsePicks (from the matched realOdds entry, whose base.sport = g.sport = "tennis").
