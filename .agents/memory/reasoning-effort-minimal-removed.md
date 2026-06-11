---
name: Chat reasoning_effort "minimal" removed by model
description: The chat model dropped support for reasoning_effort:"minimal"; it now 400s on every chat. Floor is "none".
---

# reasoning_effort "minimal" is no longer supported

The single chat completion in `artifacts/api-server/src/routes/chat.ts` (the
`stream: true` call near the bottom of the POST `/api/chat` handler) sets
`reasoning_effort` to push time-to-first-token down on the big real-data context.

The model **dropped support for `"minimal"`** and now rejects it:

```
400 Unsupported value: 'reasoning_effort' does not support 'minimal' with this model.
Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'.
(code: unsupported_value, param: reasoning_effort)
```

**User-visible symptom:** EVERY chat (web + mobile Coach, any sport — the user hit
it on a soccer parlay) failed instantly. The SSE handler catches the upstream
error and the client renders it as **"AI service is temporarily unavailable.
Please try again."** It is NOT sport-specific and NOT a data/context problem — the
400 fires before any token is generated (request completes in <1s).

**Fix / current floor:** `reasoning_effort: "none"` — the lowest supported value,
functionally equivalent to the old "minimal" for TTFT. Supported ladder is
`none | low | medium | high | xhigh`.

**Why:** keep the snappy TTFT the user explicitly asked for; "none" is the closest
remaining setting. Bump up only if pick quality visibly regresses.

**How to apply:** if chat starts 400ing on `reasoning_effort` again after a model
swap, check this enum first — provider value sets drift. There is exactly ONE
`reasoning_effort` site in the codebase (`rg "reasoning_effort"`). The api-server
has NO watcher — **restart the API workflow** after editing chat.ts or it serves
stale compiled code.
