---
name: Game-detail AI-pick real-data gate
description: Why any AI recommendation surface in the game-detail view must filter p.real
---

Game-detail `picks` = `realPicks` (from `buildPicksFromOdds`, every leg has `real: true`) **OR** a `PICK_POOL[sport]` sample fallback (legs have NO `real` flag) when no live odds exist.

**Rule:** Any AI-recommendation surface in game-detail (e.g. the "AI Spreads & Totals" tab) must compute from `p.real`-only legs, never the raw `picks`/`gameLines`.

**Why:** STRICT honesty rule — only real bookmaker data may be shown outside the disclaimed Player Props page. The AI tab even says "real prices only," which becomes a lie if it recommends a sample fallback line. Gating to `p.real` makes the section render nothing (graceful) when only sample data exists.

**How to apply:** When adding a new AI pick/highlight in the game-detail render, filter the source list by `p.real` before scoring. Display-only sections (Game Lines, Team Props) intentionally still show sample data with a "Sample markets" caption — the gate is specifically for *AI recommendations*.
