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

# STRICT alt mode — every leg must be a real alternate line

A bare "alt picks" / "N-leg alt" request is STRICT: EVERY leg must be a real alternate-ladder
rung — no straight Moneylines, no main Spread/Total, no main posted prop line.
- Prop legs: only rungs flagged `alt:true` in realProps.
- Game-side legs: only "Alt Spread"/"Alt Total" (or period rungs like "1H Alt Spread") copied
  verbatim from realOdds.
- CONVERT MONEYLINES: express a "team wins" read as that SAME team's real Alt Spread rung (e.g.
  baseball Mariners ML → Mariners alt run-line rung). If no Alt Spread exists for that team, DROP
  the leg — never fall back to the moneyline.
- HONEST SHORT TICKET: if only K of N requested legs can be filled with real alt rungs, return K
  and say so; NEVER backfill an alt ticket with moneylines/main lines to hit the count.

**Why:** user reported a "9 leg alt" ticket came back as straight Moneylines (Mariners/Pirates/
Royals ML) + main Assists props, only 1 of 7 an actual Alt Spread. User explicitly chose strict:
"Every leg must be a real alternate line… convert moneylines to same-side alt spreads, and if
there aren't enough real alts tonight, give me a shorter honest ticket." The cushion-vs-value cap
fix alone did NOT prevent main-line / moneyline filler — needed a separate every-leg-must-be-alt rule.

**How to apply (strict mode):** lives in the same chat.ts SYSTEM_PROMPT bare-alt block (EVERY LEG
MUST BE A REAL ALTERNATE LINE clause + DROP-not-stay fallback). Moneyline conversion changes only
the MARKET/RUNG, never the side — does NOT conflict with the mlLean winner-side rule. Client already
emits alt spreads/totals (mobile buildRealOdds: one rung/side) + alt prop rungs (ALT_RUNGS_PER_PROP),
so the model HAS alts to pick — purely a prompt selection fix.

**How to apply (juice cap):** The -350 cap is SCOPED to the bare-alt request type only. The global HARD BAN
stays -1000; explicit "safe"/"safer"/"lock" asks still prefer cushion rungs; odds-bound asks
("-300 or less") still follow the oddsChalkOverride path (which WANTS juiced favorites). The client
already emits up to 3 alt rungs per player+market (ALT_RUNGS_PER_PROP), so cushion AND value rungs
are both in context — this is a PROMPT selection fix, not a client emission fix. Rule lives in
chat.ts SYSTEM_PROMPT, in the PROP-LEVEL alts section right after the CUSHION/VALUE HARD RULES.
api-server has no watcher — restart the API workflow after editing.

# Bare-alt PROP legs default to VALUE direction, not cushion

After the every-leg-must-be-alt fix, GAME-SIDE legs came back as clean plus-money alt spreads
(e.g. Yankees -1 -104, Mariners -1 +105) but PLAYER PROP legs still came back as deep-juice
CUSHION rungs (Diggins-Smith Over 4.5 ast -188, Thomas Over 6.5 ast -244, Luzardo Over 5.5 K -220)
— even though those ARE alt rungs and the SAME feed carried plus-money VALUE rungs
(verified live: Diggins-Smith Over 6.5 +187, Thomas Over 8.5 +120, Luzardo Over 7.5 +190).

**Why:** game-side alts have a crisp directional rule ("step to plus money"), but the prop block
gave the model a cushion-OR-value CHOICE and it reflexively defaulted props to the cushion
direction (lower Over line at -150 to -300). The general "DON'T CUSHION-BIAS" language wasn't
forceful enough to flip the prop default. The -350 cap doesn't catch it (those cushions are within
the cap). User: "Player props also" = give props the same plus-money value treatment the spreads got.

**How to apply:** added a "BARE-ALT PROP DIRECTION" mandate in the same bare-alt block: in a bare-alt
request, prop legs DEFAULT to the VALUE direction (Over UP / Under DOWN onto the real plus-money
rung) the same way game-side alts step to plus money, whenever recent form makes the tougher number
defensible. Still analytics-gated + never-fabricate: drop the leg if form doesn't support the step,
never invent a rung. Pure PROMPT fix — alt prop rungs already reach realProps. Restart api-server after.

# Value-lean must FILL with within-cap cushions, not DROP legs (over-correction)

The value-lean above immediately over-corrected: a "9 leg alt" came back as only 5 legs (4 game-side
alts + 1 prop) because the model DROPPED every prop leg it couldn't turn into a clean plus-money
VALUE rung — even though valid within-cap cushion alts (-200/-300) existed to fill the ticket. User:
"Why not pick some alt -200 -300 or more?"

**Why:** the drop language ("if no rung clears the read AND escapes the deep-cushion band, DROP") +
the EVERY-LEG / HONEST-SHORT-TICKET rule made the model treat "no plus-money value rung" as
"unfillable" → it shrank N down to a handful instead of using a legitimate -200/-300 cushion alt.
A within-(-350)-cap cushion is a VALID alt leg, not a reason to drop.

**How to apply (the balance):** value-LEAN governs WHICH rung when several qualify; it is NEVER a
reason to drop a leg or shrink an N-leg ask. Order of preference per leg: (1) plus-money value rung
if the read supports stepping up; else (2) a real cushion rung WITHIN the -350 cap to fill toward N;
(3) DROP only when NO real alt rung exists within the -350 cap at all. "Unfillable" = no within-cap
rung, NOT "no plus-money rung." Three chat.ts edits enforce this (drop sentence, BARE-ALT PROP
DIRECTION tail, HONEST SHORT TICKET clause). Deeper than -350 still needs an explicit "safe" ask.
Watch for drift back to wall-to-wall cushions (the original failure) — the value-lean default must stay.
