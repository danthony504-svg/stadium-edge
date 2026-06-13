---
name: Injury report impact + edge (no WAR)
description: How the mobile team-pick INJURY REPORT derives per-injury impact and the team injury edge without any WAR/depth-chart feed.
---

The mobile team-pick INJURY REPORT card (artifacts/stadium-mobile/app/team-pick/[id].tsx,
helpers in lib/injuries.ts) shows per-injury Impact (High/Med/Low/Minimal), an
"INJURY EDGE" summary, position-group counts, friendly status labels, and an
expand/collapse "View all N injuries".

**Rule:** there is NO WAR, depth-chart, or starter feed. "Impact" is a
deterministic guide = injury severity (from ESPN status string) x position
weight (premium positions per sport: MLB SP, NFL QB, goalies). The team EDGE
goes to the LESS-injured team by total impact score; require a gap (~one
high-impact, score diff >=3) before claiming an edge, else "even".

**Why:** this user is honesty-sensitive — never fabricate a metric. The user
literally asked for WAR numbers; we must NOT invent them. A heuristic derived
only from REAL ESPN inputs is allowed ("deterministically derived"), but it must
be labeled a guide, not a player rating (footnote in the card).

**How to apply:** any new injury-impact surface must reuse friendlyInjury /
injuryImpact / summarizeTeamInjuries / injuryEdge. Don't introduce WAR-like
precision. The edge CAPTION must not cite high-impact counts when they're equal
(edge is total-score-driven) — fall back to total-impact wording. Card is
mobile-only; web team-pick has no injury rail.

**Shared InjuryReport component:** `components/InjuryReport.tsx` is a
self-contained (own injuries query + edge + expand state) card now reused on the
GAME DETAIL page (both teams, team-sport only — skip tennis/ufc/mma) and the
PLAYER PROP page (single OPPONENT team via the prop page's fail-closed `oppName`,
title "INJURIES YOU'RE FACING", `framing="facing"`). Edge box only renders when
2 teams resolve. It surfaces the REAL ESPN `description` field per player ("what
injury") — that's the honest answer to "what's the injury", filtered to skip
"No description" boilerplate. team-pick still has its OWN inline injury JSX (not
yet refactored onto the shared component — optional future single-sourcing).

**SUBSTITUTION = NOT BUILDABLE:** ESPN /sports/injuries returns only
{player, position, status, description} — NO substitute/replacement/depth-chart
field. "Show their substitution" CANNOT be honestly built; `framing="facing"`
adds an explicit note that replacements aren't published. Never invent a fill-in.

**Chat coach injuries (mobile-only):** the chat SYSTEM_PROMPT historically
*claimed* to "weigh injury impact" but NO injury data was ever in the chat
context — that instruction was hollow (a quiet honesty gap: told to cite
injuries it couldn't see). Now mobile buildChatContext fetches getInjuries per
sport and attaches `context.matchupInjuries` (keyed "Away @ Home", built by the
shared `buildGameInjuryReport` in lib/injuries.ts — key high/med players out +
groups + edge text; null when no betting-relevant injury so context stays lean).
The server INJURY REPORT RULE is gated on `context.matchupInjuries` PRESENCE, so
WEB (which sends none) is unaffected — this is how the feature stays mobile-only
without forking the prompt. `matchupInjuries` is in the internal-names ban list
(never surface the field name; say "the injury report"). Injuries attach in the
mobile CLIENT context builder, NOT server-side — there is no server injury fetch
in chat.ts.
