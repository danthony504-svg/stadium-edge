---
name: Refer-a-friend (mobile account screen)
description: Honesty boundary for the mobile refer-a-friend feature — link is a real shareable URL, NOT a tracked referral program.
---

# Refer-a-friend

The mobile Account screen has a "Refer a friend" card whose link/code is derived
deterministically from the real Clerk user id (`?ref=<code>` against
EXPO_PUBLIC_DOMAIN). The card is gated on a real openable link existing — never a
code-only or placeholder fallback.

**Why:** There is NO referral-tracking backend (no reward ledger, no signup
attribution, no per-user referral stats). The feature is just a real shareable
URL the user can hand out.

**How to apply:** Do NOT add UI/copy/AI claims about referral rewards, counts,
"friends joined", credits, or tracking unless a real backend is built first.
Treat any such number as fabrication (project honesty rule). The link/code is
real; the *program semantics* are not.
