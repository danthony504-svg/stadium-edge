---
name: Coach stat-card projection answer
description: Why a resolved stat card must NOT always short-circuit the chat — projection/opinion asks need a grounded answer too.
---

When a player/stat question resolves to a REAL stat card, the coach used to
render the card and stop. That silently fails projection/opinion questions like
"how many points do you think X will score tonight?" — the user sees stats but
gets no actual answer.

**Rule:** a resolved stat card is the *complete* answer ONLY for a pure lookup
("X points last 10 games"). If the prompt is a projection/opinion ask, render the
card AND then stream a grounded AI reply.

**How to apply (mobile, stadium-mobile/app/(tabs)/coach.tsx):**
- `isProjectionQuestion()` (PROJECTION_RE + a "will <someone> <verb>" pattern)
  gates the second phase; pure lookups stay card-only.
- Ground the second stream with `serializeStatCardForAI(card)` — a REAL-DATA
  block built from ONLY the card payload (ESPN seasonSummary/recent/vsOpponent,
  or StatMuse period rows). Never inject invented numbers — this is what keeps
  the never-fabricate rule intact while still answering.
- Do NOT run parsePicks / setAiPicks on this reply (it's Q&A, not a parlay) or it
  wipes the last real recommendation.

**Why:** the never-fabricate design routes stat asks to a deterministic real card,
but that path also swallowed the AI's actual take. Pairing card + grounded stream
gives the answer without ever fabricating.

Parity: the web ParlayBuilder has its own stat-card path (see
mobile-stat-card-port.md) — apply the same card+grounded-answer logic there if the
same gap shows up.
