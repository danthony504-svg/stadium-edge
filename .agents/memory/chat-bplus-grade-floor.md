---
name: Chat grade floor REMOVED — grades are display-only
description: AI Coach grade floor was fully removed; grades still render on cards but NEVER drop or limit legs. Do not reintroduce a grade filter without an explicit user request.
---

# Chat pick-quality grade floor — REMOVED (grades are display-only)

**Authoritative user decision:** the Coach must NOT limit/drop parlay legs by grade.
A requested N-leg ticket returns up to N real legs (bounded only by the slip max
and what the real board supports), each shown with its real AI Grade + Confidence.

This is the "original grading system": grades are **display-only**. There was a
short-lived grade FLOOR (a client filter that dropped legs grading below a
composite threshold — B+, later relaxed to D, plus a steering paragraph in the
server prompt). It was fully removed on both surfaces.

**Do NOT reintroduce a grade floor / composite filter** unless the user explicitly
asks for one. The honesty invariants are unaffected and still hold: only real
resolved legs, never fabricate or inflate a grade, honest short-ticket note when
fewer than requested legs can be grounded.

- Grading still computed for the card UI (the mobile pick rubric / composite) — it
  just no longer gates which legs survive.
- Grades are mobile-only (web ParlayBuilder has no grading).
- Mobile coach.tsx change reaches the published app only via EAS Update (OTA) or a
  new build; OTA from HEAD is dangerous (see ota-update-unsafe-appversion).
- Restart api-server after any SYSTEM_PROMPT edit (no watcher).
