---
name: Slip-sweep / fresh-fetch race
description: Why a passing per-render "clean the slip" useEffect can still strip just-added legs when validation reads React state.
---

When an insert path validates picks against a freshly-fetched **in-call** matchup pool, a defense-in-depth `useEffect` that re-runs the same validator over the slip can still drop those just-added items. Reason: the effect reads React state (props/odds maps) populated by `setState` calls from the *same* user turn. `setState` is async — the new entries haven't committed by the time the effect fires after `setParlayLegs`, so the validator sees a stale pool and "doesn't recognize" the legitimate legs.

**Why:** insert-time validation and sweep-time validation read from two different sources of truth (local snapshot vs. React state) that briefly disagree. The disagreement is the bug.

**How to apply:** any time a sweep effect re-validates inserted items, stamp the items with `addedAt: Date.now()` and exempt anything within a short grace window (~90s) from removal. The grace bounds hallucination retention while letting state catch up. Keep the loop-terminating early-return (`if survivors.length === current.length return`) on the rewritten condition, not the old `kept.length` one.

**Smell test:** if the diagnostic shows `nextLen: N` after `setParlayLegs` but the rendered count is 1, look for a per-render `useEffect` that re-filters the same state with a validator backed by other React state. Adding an `[addedAt]` flag is almost always cheaper than restructuring the validator.
