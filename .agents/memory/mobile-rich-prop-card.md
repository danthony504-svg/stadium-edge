---
name: Mobile rich Player Props card + list virtualization
description: How the mobile Player Props tab renders the polished per-prop card and why the list is a single FlatList
---

# Mobile rich Player Props card (PropCard)

The mobile Player Props tab (`app/(tabs)/props.tsx`) renders one rich `components/PropCard.tsx` per main prop: market chip, big odds, "Player Over <line> <Market>" headline, colored Away(blue `primary`)@Home(red `destructive`) teams split from `gameLabel.split(" @ ")`, game time, a SAFE•BEST•VALUE rung selector, a Model/Implied/Edge/Confidence/Variance stat grid, an AI Edge expander, and a full-width toggle Add-to-slip.

**Honesty (sacred):** every number is REAL or hidden. Model%/Edge/Confidence/Variance come from the player's REAL game log via `lib/propAnalytics.ts` (`recentValues`/`hitRate`/`impliedPct`/`varianceTier`/`confidenceTier`/`selectRungs`) and collapse to "—" when there's no usable log. Implied% is from the posted price only. The rung selector only shows rungs the book actually posts. The card is Over-oriented; an under-only main shows "—" odds + disabled add (honest) — tap opens the full sheet showing both sides.

**Shared cache key:** PropCard's player-history `useQuery` key MUST stay identical to `PlayerPropsSheet`'s: `["player-history", sport, athleteId ?? null, isSoccer ? player : null]` (staleTime 10min, enabled on `athleteId || (isSoccer && player)`). Opening the sheet after viewing a card is then instant.

**Why a single FlatList:** every PropCard fires its own real game-log fetch, so the list MUST virtualize — only on-screen cards mount, bounding the fetch fan-out. The screen is ONE FlatList with discriminated rows (`gameHeader | card | searchPlayer`) and header chrome (logo/search/recommended/sport pills) as a `ListHeaderComponent` **element** (not a function/inline component) so the search `TextInput` doesn't remount and lose focus per keystroke.

**Gotchas:**
- FlatList row keys must include `startsAt` (not just `gameLabel`) — same-label rematches/doubleheaders collide otherwise.
- Pick-string parity is the dedupe invariant: `${player} Over${lineTxt} ${label}` (side token always present, `lineTxt` = "" for yes/no markets); legKey `${game}|Player Prop|${pick}`.toLowerCase(); add drops the opposite same-line side first.
- Props tab sits behind the signed-out `/welcome` gate, so a static app-preview screenshot of `/props` shows the welcome screen unless already signed in.
