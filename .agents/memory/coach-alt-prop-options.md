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
