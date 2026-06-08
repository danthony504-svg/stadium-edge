---
name: Coach responsible-gambling reminder line
description: The AI's trailing "bet responsibly" sign-off is prompt-generated and suppressed at display per-surface; keep web + mobile matchers in sync.
---

# Coach responsible-gambling reminder line

**Rule:** the chat SYSTEM_PROMPT tells the model to end betting replies with a
one-line responsible-gambling sign-off (wording VARIES). It is removed at the
DISPLAY layer, independently on each surface — never from the prompt. Web strips
it inline during the streamed line-by-line render; mobile strips it after the
fact in the bubble text path. Persistent "21+ · Bet responsibly" UI labels stay;
only the per-message AI line is suppressed.

**Why:** users dislike the dangling sign-off (web removed it per an earlier
request; mobile showed it as a full-width line below the reply — reported as
"overflowing").

**How to apply:**
- Any new sign-off wording in the prompt must be reflected in BOTH surfaces'
  matchers or it leaks on one. Web's matcher is narrower than mobile's (it misses
  "comfortable losing" / "no wager is guaranteed").
- Matchers must stay disclaimer-SHAPED (betting/responsible-gambling-anchored)
  and tail-only with a short-line guard — a broad/unanchored matcher silently
  eats legitimate trailing analysis (e.g. "averaging 21+ points", "no guarantee
  he plays"). Mobile pure helper is unit-tested for exactly these false positives.
- Mobile change is JS-only → OTA-unsafe, ships next native build.
