---
name: Chat reply leaks internal context-field names
description: Why the AI Coach must be told to never surface internal data-structure/field names to the user, and how the missing-data case triggers it.
---

# Chat reply leaks internal context-field names

The chat.ts SYSTEM_PROMPT documents the model's data using the LITERAL internal field names of the context object (realProps, playerHistory, realOdds, realGames, liveOdds, matchupHistory, mlbGameEnv, mlbPlatoon, mlbBatterVsPitcher, playerVsOpponentCareer, teamPeriodStats, opponentDefense, statmuseFacts, fightAnalysis, lastMeeting, vsOpponent, tonightSplit, currentSlip, startsAt, context.*). The model parrots those names back to the non-technical user — most visibly in the MISSING-DATA case, e.g. a player not in the feed produced "He's not listed in `realProps`, playerHistory, mlbGameEnv, mlbPlatoon, or mlbBatterVsPitcher here" and "`matchupHistory` actually leans Baltimore".

**Why:** the user only ever sees the chat message; those tokens are code plumbing and look broken/unprofessional. The honesty rule (never fabricate, say when data is missing) is correct and must stay — the bug is purely the WORDING, not the refusal to invent.

**How to apply:**
- Fix is a single high-priority rule near the TOP of SYSTEM_PROMPT (right after the voice/NEVER-guarantee lines), labelled "NEVER EXPOSE INTERNAL NAMES". It bans surfacing any code/field name, gives the exact anti-pattern ("not listed in realProps…"), supplies plain-English substitutes ("my live prop board", "his recent game log", "the posted odds", "head-to-head history"), and — critically — states it is an OUTPUT-WORDING rule ONLY so the model keeps USING every field internally for analysis. Without that last clause the model can over-correct and stop reasoning from the data under token pressure.
- It is PROMPT-ONLY suppression (high probability, not a hard guarantee). If a hard guarantee is ever needed, add a server-side final-pass redaction of known internal identifiers before returning assistant text — not done yet, deliberately (scope).
- Any NEW context field added to the prompt should also be safe under the catch-all "any other code/variable/field name", but add egregiously-leakable ones to the explicit list.
- api-server has NO file-watcher: restart the workflow after any prompt edit or it serves stale compiled text.
