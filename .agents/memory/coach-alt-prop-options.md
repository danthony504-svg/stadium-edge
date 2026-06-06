---
name: Coach shows alt prop options on every pick
description: The Coach surfaces a safer cushion rung AND a higher-payout value rung next to each prop pick — as prose suggestions, never as extra slip legs.
---

User wants to SEE the alt ladder on every prop pick, not just the one rung the
Coach chose. The chat.ts SYSTEM_PROMPT prop-alt section ("SHOW THE ALT OPTIONS
ON EVERY PROP PICK") tells the Coach: when realProps carries alt rungs for that
exact player+stat, end the pick with a one-line "Alt options:" note listing both
a SAFER cushion rung and a HIGHER-PAYOUT value rung, quoting the real line+price
from realProps.

**Critical invariant:** these alt options are PROSE-ONLY suggestions. They must
NOT be emitted as additional `PICK` lines and must not change the leg count —
the client parses `PICK` lines into slip legs, so emitting alts as picks would
silently add them to the bet slip. Only the single main PICK line is the leg.

**Why:** the previous behavior committed to one rung per leg and only showed the
ladder when the user explicitly asked for "alts"/"safer"/"value".

**How to apply:** never-fabricate still wins — only list rungs that exist in
realProps (no invented line/price, nothing worse than -1000); show only the
direction(s) that really exist; omit the note entirely if no alt ladder exists.

**MOBILE GOTCHA — prose alone is invisible on Expo.** The mobile Coach's
`assistantBubbleText(content, hasPicks)` returns `""` whenever pick cards render,
so ALL AI prose (the "Alt options:" line included) is stripped on mobile — the
prose-only approach only ever surfaces on WEB. Mobile must render the alt rungs
PER-CARD from real data: `matchProp` (components/PickCard.tsx) computes
`pick.altOptions {cushion,value}` from the SAME propPool ladder it resolves the
main rung from — cushion = nearest SAFER rung (odds < best, within CUSHION_FLOOR
-550), value = nearest HIGHER-PAYOUT rung (odds > best), restricted to same
fixture + exact player + exact marketLabel + same side + line != null/!= best.
yes/no markets (line==null) and deep-cushion bests (no safer rung) just omit.
**Why:** user reported "I don't see the alt options" on TestFlight — they're on
mobile, where the server prose never shows.

**TAPPABLE rungs (later ask):** `AltRungChip` is now a Pressable that toggles
that exact rung into the slip (was display-only). Each rung carries a full slip
`pick` string (`player side line marketLabel`, built in matchProp from the SAME
pool entry, only the line swapped) so the leg flows through `addLeg` exactly like
the main pick. added-state = `hasLeg(parent.game, parent.market, rung.pick)`;
toggle passes ONLY slip-`Leg` fields {game,market,pick,odds,sport} (no headshot/
teamAbbr — not in Leg). A rung is a DISTINCT leg from the main (different line),
so main + rung can coexist; MAX_LEGS refusal handled via addLeg's boolean return.
**Why:** user asked to "click the safer and value picks and add to ticket".
