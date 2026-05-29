---
name: All live-prop players clickable (synth player)
description: How non-pool live-prop players open the Player Props page without fabricating season stats.
---

Every player in the game-detail "Live Player Props" list opens the Player Props
(selectedPlayer) page. Two paths:
- Pool player (curated PLAYERS): existing logic, real curated season stats.
- Non-pool player: build a `_synth` player object whose `stats` come from that
  player's REAL live prop lines (keyed by stat label, value = the real line,
  first-wins). Page relabels to "Live Prop Lines" / "live line" and uses the real
  matchup as `gameLabel` for add-to-slip.

**Why:** STRICT no-fabrication rule. We must NOT invent season numbers for
arbitrary players. Synth stats are real prop lines only. The 5-game bars on the
page remain simulated, which is acceptable ONLY because the Player Props page
carries the explicit bottom disclaimer "Sample stats & game log — not live data ·
Hypothetical only" — the one sanctioned fabrication exception in this app.

**How to apply:** Don't try to make the synth game-log bars "real," and don't
reuse synth stats outside the disclaimed page. If extending player-stat surfaces
elsewhere, either feed real data or add an equivalent disclaimer.

Gotcha: there are several distinct `gameLabel` locals in different scopes in
ParlayBuilder.tsx — never blanket-sed `${pl.team} game` → gameLabel without
scope-checking; only the selectedPlayer view needs that swap.
