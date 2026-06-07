---
name: Per-leg projected-edge readout (mobile)
description: How the AI Coach surfaces model vs implied % + edge on every parlay leg without fabricating
---

# Per-leg projected-edge readout (mobile Coach)

`parseEdgeStats(edge?)` + `<EdgeReadout edge>` live in `components/PickCard.tsx`
(both exported) and are rendered in BOTH `PickCard` and `AiPickCard`.

## The rule
The readout never invents numbers. It only *surfaces* figures the chat AI already
wrote into the `EDGE:` note prose (the chat.ts prompt mandates a parseable shape
like `-110 implies ~52%, I project this OVER ~66% -> +14% edge`). When no
projection is present it shows an honest "Market price" chip — never a guess.

**Why:** the whole product invariant is REAL-data-only / fail-closed. An edge UI
that estimated a win% from the odds would be fabrication.

## Parsing gotchas (cost real bugs — keep the guards)
- Projection-word→percent gap MUST exclude signs/digits: `[^%\d+\-]{0,24}?`.
  Without it, "Model edge is +14% edge" skips across to `+14` and mislabels an
  EDGE number as a projected win-rate. Same guard on the implied regex.
- Percent capture is `\d{1,3}(?:\.\d+)?` (multi-decimal) with a 0–100 range
  guard, rounded for display.
- Edge gap = explicit `+N% edge` token if present, else `projected - implied`
  (only when BOTH parsed), else null.

## Render rule
`<EdgeReadout>` renders UNCONDITIONALLY on both cards (not inside the `pick.edge`
gate) so every leg shows either real Model/implied/edge chips or "Market price".
The collapsible EDGE prose pill stays gated on `pick.edge`.

**Scope:** mobile Coach only (the surface users complained about). Web
ParlayBuilder already has its own confidence badge — separate effort.
