---
name: Chat slip overlay sizing + "Add all" silent leg drop
description: Why the bottom composer's measured height must drive both chat scroll padding and the expanded-slip overlay maxHeight, and why "+ Add all" silently lands fewer legs than promised.
---

# Bottom composer height is a shared layout input

The chat lives in a `fixed inset-0 flex flex-col` root. The bottom composer
(slip pill + Build/PickLive/Analyze controls + attachment rows + input +
disclaimer) is `absolute bottom-0`, so it OVERLAYS the chat and its height is
VARIABLE (slip pill, image-attachment preview, pinned-slips strip each add
rows). A `ResizeObserver` on the composer (`composerRef` → `composerH` state)
is the single source of truth for its height.

Two things must consume `composerH`, or content hides behind the bar:
1. **Chat scroll area** `paddingBottom: Math.max(composerH, 130) + 16` — a fixed
   padding (the old `130`) is too small once the slip pill/attachments grow the
   bar, so the last messages can't be scrolled into view.
2. **Expanded YOUR SLIP popup** — it's `absolute bottom-full` (grows UPWARD from
   the top of the composer). With `maxHeight: 85vh` its TOP (the cyan header)
   extends off the top of the screen and is unreachable. Use
   `maxHeight: calc(100dvh - (composerH + 24)px)` so header+footer stay on
   screen and only the leg list (`flex-1 min-h-0 overflow-y-auto`) scrolls.

**Why:** the composer overlays, so its height is dead space the scroll area and
any bottom-anchored overlay must account for. `dvh` (not `vh`) handles mobile
toolbar collapse; target is iOS Safari which supports it.

# "+ Add all N legs" can silently land fewer than N

`messagePicks = rawMessagePicks` renders EVERY AI `PICK:` line uncapped, so the
button label "Add all N legs" equals the AI's PICK-line count. But the onClick
runs `autoFillSlip(messagePicks)` WITHOUT `alreadyValidated`, so it re-runs
`filterPicksToReal` against current React state — any leg whose game isn't
verifiable in the live 48h pool, plus duplicates already on the slip, get
dropped. Result: user asks for 15, sees "Add all 15", slip shows 10, no
explanation → "only added 10 when it was supposed to be 15".

**Fix shape:** `autoFillSlip` returns
`{ requested, added, droppedNotLive (game-label STRINGS from
filterPicksToReal().dropped), droppedDup (count) }` at every exit; the add-all
onClick posts an honest assistant message when `added < requested`. Note
`filterPicksToReal` returns `{ kept (pick OBJECTS), dropped (game STRINGS),
poolSize }` — `dropped` is strings, don't `.game` it. Keep the drop-reason
wording neutral ("couldn't be verified in the live feed") — drops also include
malformed/cross-sport/unverifiable labels, not only out-of-window.

**Why not just bypass validation:** the slip-sweep effect re-validates with a
grace window and would strip truly-stale legs anyway, so honest feedback beats
forcing legs that won't survive. This is distinct from the streaming auto-fill
path, which legitimately passes `alreadyValidated` (props fetched same turn
aren't in committed state yet).
