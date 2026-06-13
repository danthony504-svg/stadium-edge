---
name: Coach build weak-link upload failure
description: Why mobile parlay builds fail/feel slow on weak signal and the size-aware connect-timeout fix.
---

# Weak-link Coach build failures = oversized POST body vs fixed connect timeout

"Build me an N-leg parlay" failing with **"I lost the connection while building
your ticket"** (and feeling slow) on a weak uplink (1-bar 5G/LTE) is usually NOT
a dead link — it's the **upload** of an oversized request body timing out.

**Why:** `streamChat` (mobile `lib/api.ts`) POSTs the whole gathered context to
`/api/chat`. Production logs (`chat context size before model call` → `contextChars`)
show a multi-leg "tonight" context serializes to **~130KB**, an 11+ leg full-slate
to **~500KB**. A FIXED connect timeout can't push that many bytes on a weak uplink
before it trips, so every attempt connect-stalls and re-POSTs the IDENTICAL body
(tell: the same `contextChars` POST repeated back-to-back 3-5×) → retry exhaustion
→ the error. The model itself is fine (server `responseTime` 19-65s is inherent
reasoning-model TTFT; `reasoning_effort` already `low` — don't lower for quality).

**How to apply:** scale the connect budget to the actual body size, don't use a
flat constant. Current shape: serialize the body ONCE before the retry loop
(reuse across attempts, no re-stringify), `bodyKB = bodyStr.length/1024`, then
`CONNECT_MS = clamp(12s .. 30s, 12s + max(0, bodyKB-40)*120ms)`. 12s floor keeps
small chats unchanged; cap bounds dead-link wait (background-build path is the
safety net if we still give up). Mobile JS-only → reaches the published app via
OTA/new build, not the dev server.

**Don't** try to fix this by shrinking the medium/full context tiers
(`contextDepthForLegs`): a thin slate already sends far under the caps (~27 props),
the bulk is per-entry richness (books + alt ladders) which the B+ "add points"
floor needs — so trimming it risks under-fill without fixing the upload.
