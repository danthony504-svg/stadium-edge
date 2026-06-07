---
name: Improve-the-ticket chat intent
description: How "improve this slip" intent is detected on client + server, and the phrasings it must catch
---

# Improve-the-ticket chat intent

"Improve THIS slip" intent is detected in TWO mirrored places that must stay in
sync: client `wantsImproveSlip` (stadium-mobile coach.tsx) and server
`improveWording`→`improveIntent` (api-server chat.ts). When it fires:
- client silently RE-ATTACHES the last uploaded slip photo (lastSlipImagesRef) so
  the model can re-read the slip the user is talking about;
- server sets improveIntent → improveFromSlipImage (when an image is present) →
  KEEP-SAME-GAMES / SAME-LEG-COUNT improve constraints; with a currentSlip but no
  image it instead DIVERSIFIES ACROSS GAMES to cut correlation.
improveIntent is gated on `currentSlip.length>0 OR a prior assistant turn that
talked about a slip`, so it can't fire in unrelated chat.

## Phrasings it must catch (and the gotchas)
- "give me a better one/ticket/slip/version/card/option/parlay" — anchor-noun form.
  TYPO-TOLERANT: "give me a batter one" (typo for "better") must NOT be read as an
  MLB batter request; the ticket-pronoun-noun adjacency disambiguates.
- "make it/this better|stronger|cleaner|safer|tighter|less correlated".
- "improve/fix/tighten/trim/diversify/de-correlate/clean up <this|that|it|ticket|...>".
- "do better" / "can you do better" / "how can you do better" / "do any better" /
  "do this better" — the **DO_BETTER_RE** family. This was a real bug: a user asked
  "you picked this one how can you do better?" and it matched NONE of the anchor-noun
  patterns, so the image was never re-attached and the server built a GENERIC new
  parlay instead of improving the slip.

**Why DO_BETTER_RE is separate & bypasses the comparison exclusion:** a comparison
("which is better", "what is better here") routes to the compare/rank flow and is
excluded via comparisonAsk / IMPROVE_COMPARISON_RE. But the verb form
`do|doing|does|did + better` never appears in a "which is better" comparison, so it
is unambiguously an improve ask — it short-circuits to true on the client and is
OR'd into improveWording AHEAD of the !comparisonAsk-gated branch on the server.

**How to apply:** any new improve phrasing must be added to BOTH coach.tsx and
chat.ts or the two halves drift (client re-attaches but server builds generic, or
vice-versa). Restart api-server after editing chat.ts (no watcher).
