---
name: Coach slip-clearance composer double-count
description: Why the Coach chat list's bottom slip-clearance must NOT re-add the composer height.
---

# Coach slip-clearance composer double-count

**Rule:** the mobile Coach chat scroll list's bottom clearance for the floating
SlipBar must be the bar's own footprint only — do NOT add the composer height on
top of it.

**Why:** the floating SlipBar is already positioned a composer-height above the
screen bottom, AND the chat composer is an in-flow flex sibling, so the scroll
viewport already ends at the composer's top (also ~a composer-height above the
screen bottom). Those two lifts cancel. Adding the composer height again left a
large dead gap below the last message and pushed long replies up so their top
scrolled off — reported as "too much empty space / text doesn't fit."

**How to apply:** clearance is measured relative to the scroll viewport's bottom
edge (= composer top), not the physical screen bottom. Any time the SlipBar
offset or the composer layout changes, re-derive the overlap from the viewport
bottom rather than stacking named constants. Clearance only matters when the
slip has legs (bar visible); empty slip needs none.
