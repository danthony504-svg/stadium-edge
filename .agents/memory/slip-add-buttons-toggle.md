---
name: Slip add-buttons must toggle (mobile)
description: Add-to-slip controls have to support un-clicking and reject contradictory same-line sides.
---

# Slip add-buttons must toggle + reject contradictory sides

Any "add to slip" control on mobile (PlayerPropsSheet "Set your line" Over/Under
chips, the AI SUGGESTED button, the game-detail odds board `MarketBlock` line
rows in `app/game/[id].tsx`, etc.) must be a **toggle**, not add-only:
- tapping an already-added side removes it (un-click) via
  `removeLeg(`${game}|${market}|${pick}`.toLowerCase())` — the key MUST match
  BetSlipContext `legKey()` exactly (lowercased composite).
- adding one side of a line first removes the opposite side at the **same line**,
  because a slip can never hold both Over and Under the same number.

**Why:** an add-only handler let users stack Over 0.5 + Under 0.5 on the same
prop and then had no way to remove either ("both able to click and can't
unclick"). PickCard already toggled this way; the sheet's buttons did not. The
game-detail board had the same defect ("the same and can't unclick"):
`BetSlipContext.addLeg` only dedupes the exact id + enforces MAX_LEGS — it has
NO drop-opposite / mutual-exclusion logic, so every call site must enforce it.

**How to apply (board):** on the odds board each market section is one
`MarketBlock` whose `outcomes` are alternatives of ONE bet (a game has one ML /
spread / total), so before adding a rung, loop `outcomes` and `removeLeg` every
sibling legKey (skip current `idx`) → one pick per section. Sibling pick string
must come from the same `pickFor(decoded.base, name, point)` used to add.

**How to apply:** when wiring a new add-to-slip surface, mirror PickCard's
toggle (hasLeg → removeLeg/addLeg) and keep the displayed `added` highlight on
the SAME line value the handler operates on (in the sheet, aiSuggestion.line ===
bookLine === selectedProp.line, so they stay aligned).
