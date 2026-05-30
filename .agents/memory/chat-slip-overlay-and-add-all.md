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

# "+ Add all N legs" silently landing 3-of-13 = Odds-API pool CHURN, not bad legs

`messagePicks` renders EVERY AI `PICK:` line, and those lines are ALREADY
validated at generation time (hallucinated/out-of-window legs are scrubbed from
the message text before it renders via `cleaned`). So a displayed leg is a real
game. The "only 3 of 13 added / couldn't be verified in the live feed" report is
NOT hallucination: the Odds API pool CHURNS between sends (429 → smaller ESPN
fallback, server log shows realOdds 120→82→120, realGames stable ~18). A real
game valid at generation churns OUT of current React state by add-click, and a
blind re-`filterPicksToReal` at click time drops it.

Two compounding sites both re-validated against churned state:
1. **"+ Add all" onClick** ran `autoFillSlip(messagePicks)` WITHOUT
   `alreadyValidated`.
2. **slip-sweep effect** (`survives`, no-deps effect) re-runs
   `filterPicksToReal([l])` per leg every render and strips churned-but-real
   legs once the 90s `addedAt` grace expires — so fixing only the add path is
   insufficient; the leg vanishes ~90s later.

**Fix (the right one — trust generation-time validation, survive churn):**
- "+ Add all" onClick: partition `messagePicks` into `finished`
  (`gameResolvesToFinal`) vs `live`; call
  `autoFillSlip(live, { alreadyValidated: true, chatValidated: true })`. Honest
  message uses `messagePicks.length` as denominator (added X of N; Y already
  finished; Z already on slip) — and since alreadyValidated fully accounts for
  the shortfall, no "couldn't be verified" wording anymore.
- `autoFillSlip` + `addLeg(skipValidation)`: stamp inserted legs
  `chatValidated: true` and `gameStartTs` (from `lookupGameStart` AT INSERT,
  while the game is still in a feed).
- slip-sweep `survives`: also keep a leg if
  `l.chatValidated && !gameResolvesToFinal(l.game) && !(gameStartTs &&
  now-gameStartTs > 8h)`. I.e. churn never strips a chat-committed leg; only a
  CONFIRMED-finished game (or the 8h staleness fallback for a finished game that
  rotated out of every feed so gameResolvesToFinal can't see it) removes it.

**Why `gameStartTs` is stamped at insert, not read at sweep time:**
`lookupGameStart` returns null once the game is evicted from all feeds — exactly
the case the staleness fallback must cover — so it must be captured while the
game is still present.

**Supersedes earlier "honest feedback beats forcing legs" note:** that was wrong
about the cause (assumed the dropped legs were genuinely unverifiable). They were
real; the bug was re-validating against a transiently-churned pool. The streaming
auto-fill path's `alreadyValidated` was the correct pattern all along — the add
paths just needed the same trust plus churn-resistant persistence.
