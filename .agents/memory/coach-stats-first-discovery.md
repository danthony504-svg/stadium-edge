---
name: Coach prop/stat discovery — stats first, ask before building
description: Why prop "discovery" asks must show stats and offer to build, instead of auto-emitting pickable cards.
---

# Stats-first prop/stat discovery

When the user asks to SEE prop/stat OPTIONS ("top batter props for the Astros",
"best HR props today", "what props do you like", "who's hot") the Coach must
present a stats-first rundown and END by asking if they want a parlay built —
NOT auto-emit picks.

**Why:** users read "give me the top props" as "show me options," but the app
turns every `PICK:` line into an auto-addable card + "Add all N to slip", so the
Coach felt like it was betting FOR them. Reported as "stop just picking props."

**How to apply:**
- This is PROMPT-ONLY. The app renders cards solely from `PICK:`/`ALT:` lines;
  a prose stats reply with zero PICK lines shows as normal text on BOTH web and
  mobile — no client change needed. Mobile `PARLAY_BUILD_RE` (coach.tsx) does NOT
  match prop-discovery phrasing, so its "Building…" lead-in suppression never
  fires for these turns (only when PICK lines actually stream).
- GOTCHA — TWO competing prompt rules force PICK emission and BOTH must defer to
  discovery: (1) the props-mandatory / "Hot picks / today's best" REQUEST-TYPES
  block near the top, and (2) a separate "When the user asks to FIND PLAYER
  PROPS … you MUST format as a PICK line" rule much further down. A "don't
  auto-pick" change that only touches one of them leaks PICK lines via the other.
- Gate on BUILD INTENT, not on the word "props": discovery = no build word
  (parlay/ticket/slip/build/make me a/N-leg/add/props only parlay/safe/longshot/
  lottery). Explicit builds and confirmations after a discovery turn ("yes",
  "build it", "do a 4-leg", "the first three") still build immediately.
- Honesty unchanged: the rundown uses only real realProps lines + real
  playerHistory.recent counts; thin/absent sample → say so, never fabricate a
  stat or projected %. Prompt-enforced only (no structural validator on prose
  stat claims, unlike PICK lines which are card-parsed).
- Shared prompt → applies to web + mobile alike (chat route POST /api/chat;
  restart api-server, no watcher).
