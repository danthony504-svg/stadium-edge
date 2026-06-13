---
name: Mobile yes/no prop grounding (HR / anytime TD / anytime goal)
description: Why "3 leg home run?" got "couldn't ground any of those legs" on mobile Coach and how yes/no props are matched.
---

# Mobile yes/no prop grounding

Yes/no prop markets (`batter_home_runs`, `player_anytime_td`, `player_goals`,
`player_goal_scorer_anytime`) are surfaced in the feed / `propPoolFromRealProps`
as an **Over 0.5** entry (HR/TD) or a **null-line** entry (anytime goalscorer),
with an Over (= "Yes") and sometimes Under (= "No") side.

But the shared chat prompt (`api-server/src/routes/chat.ts`) tells the AI to
phrase these — like the books do — as `<Player> To Hit a HR` / `Anytime TD` /
`Anytime Goal`, with **no line number and no Over/Under token**.

**The bug:** `matchProp` in `stadium-mobile/components/PickCard.tsx` gated every
`e.line != null` entry on the selection containing the exact line string ("0.5")
AND an explicit Over/Under side. Yes-phrased HR picks have neither → every leg
dropped → 0 grounded → Coach refusal "I couldn't ground any of those legs in
tonight's real odds right now". Web (`ParlayBuilder.tsx`) never had this because
it normalizes these markets to friendly yes/no labels everywhere.

**The fix (mobile-only, client JS → ships via OTA, no server restart):** in
`matchProp`, when the selection is yes-phrased AND the pool entry is a yes/no
market with `line == null || line === 0.5`, bypass the line/side gate and match
ONLY the Over (= "Yes") side. Explicit "Over 0.5 …" phrasing still falls through
to the original gate (no regression).

**Why:** keeps the strict line/side gate for countable props (so a prop can't
collide with a same-numbered game total) while accepting the one phrasing the AI
is actually instructed to emit for yes/no markets.

**How to apply:** any future yes/no prop market must be added to
`YES_NO_PROP_MARKETS` in PickCard.tsx AND to the `selYesNo` phrasing regex, OR it
will silently fail to ground on mobile Coach. `backfillProps` is unaffected — it
self-builds its pick strings ("Player Over 0.5 Home Runs") from the pool, never
from AI text. `matchProp` is not testable via `node --test` (lives in a `.tsx`
component); verify by replicating the gate logic standalone.
