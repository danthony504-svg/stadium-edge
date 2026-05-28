---
name: Live Player Props AI Pick must be pinned
description: Why decorating a single row in the Live Player Props list is invisible to users — pin the recommendation at the section top instead.
---

When The Odds API returns player props for a game it can return **hundreds of rows** (every bookmaker × every player × every market = 200+ items is normal for a popular NBA/NFL slate). A per-row visual highlight on the "best edge" prop is effectively invisible because:

- The chosen row can be anywhere in the long list (often deep, since lowest-vig prices come from books listed alphabetically late).
- The Section header + bookmaker line scroll off under the sticky game-detail header, so users only see whatever cards happen to be in the current viewport.

**Rule:** any "AI's top pick / best edge" surface inside a long, scrollable list of bookmaker rows must be **pinned at the top of the section** as its own card — not just a ring/banner on the matching row. Keep the per-row decoration too if you want, but the pinned card is the only thing the user is guaranteed to see.

**Why:** users testing on mobile reported "still nothing" three times in a row even though the per-row highlight was rendering correctly — it was just on a card 40+ rows down. Multi-book props lists are deceptively long.

**How to apply:** when adding a recommendation to any list that aggregates across bookmakers (props, futures, multi-book moneylines), render a separate "AI's pick" / "Best edge" card immediately after the section header with the player, side, line, price, reasoning, and an Add-to-ticket button. Then optionally still highlight the underlying row inline.
