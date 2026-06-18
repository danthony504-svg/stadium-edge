---
name: HR multi-homer over ban
description: Why a 2+ HR (Over 1.5/2.5 home runs) over must never be a graded PICK, and the two-layer guard that enforces it.
---

# HR multi-homer over ban

A recommendable home-run OVER is the **anytime-HR line only** (batter_home_runs
Over 0.5 / "To Hit a HR"). A multi-home-run over — Over 1.5 (2+ in a game) or
Over 2.5 (3+) — must NEVER be the graded PICK.

**Why:** Reported failure — the Coach surfaced "Jo Adell Over 1.5 Home Runs +4000"
as a "Best" pick while the app's own prop card showed 0.1 projection, 0/10 recent,
0% hit rate. No hitter's real projection (~0.1-0.4 HR/game) or recent form can
defensibly support a 2+ HR game; surfacing one as a graded recommendation is the
exact indefensible call this app must never make. Holds even for
"longshot"/"value"/"alt" asks — express HR upside as anytime HR, never 2+. The
deeper rungs may still appear as display-only "Alt options"/Value-rung, never as
the PICK.

**How to apply (two layers — prompt alone leaks under scarcity):**
- SERVER prompt (chat.ts): hard rule "HOME-RUN PICK LINE — ANYTIME HR ONLY" near
  the other HR weighing rules. Governs both web and mobile model output. Restart
  api-server after editing (no watcher).
- MOBILE client safety-net (PickCard.tsx matchProp, after `best` resolution,
  BEFORE altRungBias/altOptions so the ladder builds from the capped rung): if a
  grounded `batter_home_runs` Over rung has `line >= 1.5`, snap down to the same
  player+game's REAL anytime rung (null-line affirmative leg — skip `side==="Under"`
  — or Over 0.5); if none exists, fail-closed `return null` (parsePicks drops null).
  Never widen to another player/game.

**Gaps / notes:**
- WEB client has NO equivalent post-parse net — it relies on the prompt rule only.
  If the web ParlayBuilder ever leaks a 2+ HR pick, mirror this cap in its prop
  grounding.
- Mobile client change only reaches installed apps via an OTA/native build; the
  prompt change ships with an api-server republish.
- matchProp lives in components/ (not lib/), so the node --test harness can't
  import it — covered by tsc + the contained, fail-closed logic, not a unit test.
