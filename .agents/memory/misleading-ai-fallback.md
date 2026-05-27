---
name: Misleading AI-fallback messages
description: When a chat client falls back to an offline analyzer, the user-facing message must name the actual cause — not a blanket "AI unavailable".
---

When a chat endpoint can fail for multiple reasons (own rate limiter, upstream provider outage, missing API key, network), the client catch block must inspect the HTTP status (or error shape) and surface the **actual** cause. A single "AI service unavailable" message for every failure makes users debug the wrong system — e.g. they assume the LLM provider is down when they really just tripped a local 60/min cap and need to wait 5 seconds.

**Why:** in this repo the chat endpoint sits behind `rateLimit({ max: N })` middleware. A burst of in-app "build best parlay for this game" clicks legitimately fires several chats in a row. When that returned 429, the client lumped it into the "AI service unavailable — used offline analyzer" branch, which (a) wrongly blamed the AI provider and (b) silently degraded the user to the rules-based fallback when the real fix was "wait 1 second".

**How to apply:** any fetch wrapper that throws on `!res.ok` should attach `err.status = res.status` so the catch branch can distinguish 429 (own limit), 5xx (upstream), 401/403 (auth/config), and network errors. Render a different user message per class. Never call the offline fallback path for 429 — the LLM works fine, the user just needs to wait.
