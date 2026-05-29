---
name: ParlayBuilder has multiple independent search renderings
description: A UX change to "search" in ParlayBuilder.tsx must be applied to every search render or it only half-works.
---
ParlayBuilder.tsx renders the `homeSearch` query in THREE separate, independent places — each with its own results JSX:
- Home view (~line 7133): real game rows ("Build →") + pool rows ("+ Add").
- "All Sports" view (~line 7650): flat market rows ("+ Add").
- All-upcoming view (~line 8180): "Build →" rows.

**Why:** A search/UX change applied to only one render looks done in code but the user sees the old behavior on whichever screen they're actually on (e.g. the home screen). I once added a feature to the All Sports render only; the user's screenshot was the home render, so nothing changed for them.

**How to apply:** When changing search behavior (new sections, click targets, filters, empty-state), grep for every `homeSearch.trim()` block and update all of them. Confirm which screen the user is on from their screenshot before assuming a render is the right one.
