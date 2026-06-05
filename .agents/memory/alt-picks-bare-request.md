---
name: Bare "alt picks" default behavior
description: How the Coach should interpret an unqualified "alt picks"/"alts" request (value vs cushion + juice cap)
---

# Bare "alt picks" request → varied plus-money value, not deep-juice cushions

A bare "alt picks" / "alternate lines" / "alts" ask (NO "safe"/"value" qualifier, NO odds bound)
must build a VARIED MIX leaning to plus-money VALUE rungs, with a request-scoped JUICE CAP:
no alt leg as the PICK priced worse than **-350**.

**Why:** "alt picks" with no qualifier made the model cushion-bias the whole ticket — it returned
deep-ITM safe rungs at indefensible juice (real report: Over 7.5 pts -321, Over 3.5 reb -530,
Over 2.5 ast -329). Those rungs add almost no payout over the main line, defeating the purpose of
an alt. User confirmed the desired behavior is "a varied mix — mostly plus-money value, with a cap
so no leg is brutally juiced (no -500 unless I ask for safe)."

**How to apply:** The -350 cap is SCOPED to the bare-alt request type only. The global HARD BAN
stays -1000; explicit "safe"/"safer"/"lock" asks still prefer cushion rungs; odds-bound asks
("-300 or less") still follow the oddsChalkOverride path (which WANTS juiced favorites). The client
already emits up to 3 alt rungs per player+market (ALT_RUNGS_PER_PROP), so cushion AND value rungs
are both in context — this is a PROMPT selection fix, not a client emission fix. Rule lives in
chat.ts SYSTEM_PROMPT, in the PROP-LEVEL alts section right after the CUSHION/VALUE HARD RULES.
api-server has no watcher — restart the API workflow after editing.
