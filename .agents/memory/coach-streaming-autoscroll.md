---
name: Coach streaming auto-scroll must be instant
description: Why per-token auto-scroll during a streamed chat reply must be non-animated.
---

# Coach streaming auto-scroll must be instant

**Rule:** the mobile Coach's per-token streaming auto-scroll must be an INSTANT
(non-animated) scroll-to-end. Reserve animated scroll for one-off jumps (after
send, on finish, card insertion).

**Why:** a fast stream fires many tokens per second; an animated scroll can't
finish before the next token triggers another, so the view perpetually lags the
growing text and the newest lines fall below the fold — reported as "text
overflowing as it's being delivered."

**How to apply:** any handler that scrolls on EVERY streamed chunk (each onToken)
uses the instant path; there are multiple such handlers (main chat stream and the
stat-lookup projection stream) — keep them consistent.
