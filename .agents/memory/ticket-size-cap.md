---
name: Ticket-size (max legs) cap
description: Where the maximum parlay/ticket leg count is enforced, so a cap change stays in lockstep across surfaces.
---

The maximum number of legs the AI Coach will build / the slip will hold is
enforced in TWO real places that must change together:

1. **Server prompt** — `artifacts/api-server/src/routes/chat.ts` SYSTEM_PROMPT
   "HARD TICKET-SIZE CAP — N LEGS MAX" block + the "N-leg parlay" REQUEST TYPE
   line ("NEVER more than the N-leg cap"). This governs BOTH web and mobile AI
   output (mobile coach hits the shared `POST /api/chat`). Requires an
   api-server workflow restart (no file-watcher).
2. **Mobile slip hard cap** — `artifacts/stadium-mobile/context/BetSlipContext.tsx`
   `export const MAX_LEGS` — `addLeg()` refuses past this so a bulk "Add all"
   can't blow past it.

The **web app has NO numeric slip cap** of its own; its AI output is bounded
purely by the server prompt above.

**Why:** a cap change that only touches the prompt leaves the mobile slip
silently enforcing the old number (and vice-versa).

**How to apply:** when changing the max ticket size, update the chat.ts prompt
numbers AND mobile MAX_LEGS, then restart the api-server. Comments in
`stadium-mobile/app/(tabs)/coach.tsx` reference "N-leg slip max/cap" for
accuracy — update them too.
