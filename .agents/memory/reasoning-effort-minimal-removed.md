---
name: Chat reasoning_effort "minimal" removed by model
description: Chat model dropped reasoning_effort:"minimal" (400s every chat). Now on "low" — "none" was supported but regressed pick quality.
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

**Fix history / current value:** first dropped to `"none"` (lowest supported), but
**`"none"` regressed pick QUALITY**: with zero reasoning the model could not execute
the multi-step thin-slate / sport-scope build logic and returned a self-contradictory
ZERO-leg refusal on a thin soccer "today" slate ("I can build the safest 7-leg…
[then] nothing is upcoming"). Bumped to **`reasoning_effort: "low"`** — restores the
reasoning while staying near the bottom of the ladder (`none | low | medium | high |
xhigh`).

**Why "low" is fine now (the old TTFT fear is stale):** measured TTFT at "low" on the
new model is ~1.6s to first content token (no-context curl) — NOT the ">25s silent
thinking" seen on the older model generation that originally pushed us off "low". The
SSE heartbeat (250ms pings) + the early "Pulling real odds…" status frame + the
client's animated loading dots already mask any longer full-context wait, so the user
never sees a blank screen. Net: correctness > a couple seconds of TTFT. Bump further
(medium+) only if quality still regresses.

**How to apply:** if chat starts 400ing on `reasoning_effort` again after a model
swap, check this enum first — provider value sets drift. There is exactly ONE
`reasoning_effort` site in the codebase (`rg "reasoning_effort"`). The api-server
has NO watcher — **restart the API workflow** after editing chat.ts or it serves
stale compiled code.
