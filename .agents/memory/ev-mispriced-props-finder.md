---
name: +EV / mispriced props finder
description: Honest cross-book no-vig fair-value EV signal on props; where it's computed, where it's read, and the no-line side trap.
---

# +EV / mispriced props finder

Honest "value props": best posted price beats the de-vigged CROSS-BOOK CONSENSUS fair value.

- **Single source of truth = server (api-server props.ts).** Per-book two-sided MAIN
  (non-alt) prices collected during ingest; for rows with ≥3 two-sided books, de-vig
  each book `oImpl/(oImpl+uImpl)`, take the **median** consensus fair prob per side,
  `EV = fair * decimal(bestPrice) - 1`, pick the higher-EV side, attach
  `ev/evSide/fairProb/edge/books`. Alt rows + thin coverage → fields absent (null).
- **Clients NEVER recompute or guess EV** — read the server fields only. Mobile threads
  them through PlayerProp + RealPropEntry (lib/api.ts) into chat context; Props tab
  has a VALUE rail (ev≥1.5, sort desc, cap 8). Chat has valuePropsIntent + addendum.

**Why:** honesty mandate — a fabricated/locally-estimated fair value is the exact thing
this app must never produce. The de-vig + ≥3-book + omit-when-thin design is what makes
the signal real.

**No-line (Yes/No) side trap:** no-line markets (anytime scorer/TD) quote only the
Over/"Yes" side and the canonical pick-string DROPS the side token. So an `evSide:"Under"`
("No") edge cannot be represented unambiguously — surface it and the card reads "Yes"
while using "No" odds (misrepresentation). Both the VALUE rail and the recommended rail
**skip no-line props unless the edge side is "Over"**. Any new surface that renders
no-line props from evSide must apply the same guard.

**How to apply:** new EV-driven prop field → add it server-side in props.ts; only mirror
it onto the client-facing types, never derive it client-side. Restart the api-server
workflow after route edits (no watcher). Chat prompt must keep ev/evSide/fairProb/edge in
the NEVER-EXPOSE-INTERNAL-NAMES list.
