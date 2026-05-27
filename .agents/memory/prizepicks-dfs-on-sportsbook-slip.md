---
name: PrizePicks DFS on a sportsbook slip
description: What it takes to safely mix DFS pick'em lines (no per-leg American odds) into a sportsbook-style parlay surface without fabricating prices.
---

# Rule

When a parlay slip can host legs from **two different product types** — sportsbook (per-leg American odds) and DFS pick'em (line-only, flat payout, e.g. PrizePicks) — you cannot just give the DFS legs a placeholder American price. Every helper that derives from `odds` will silently fabricate output. Carry a real `odds: null` + `priceSource` tag through end-to-end and gate every derived path.

**Why:** PrizePicks' API exposes real lines (`line_score`, `stat_type`, player, team) but never a per-leg American price — the product is parlay-only flat payout. Inventing −110/−113 to keep the math happy violates the project's "never fabricate" invariant and produces UI ("market implies 53%", "heavy favorite at −250") that lies about where the line came from.

# How to apply

The fragile surfaces — every one of these silently produces nonsense from a null/NaN price unless explicitly gated:

1. **Odds helpers (`americanToDecimal`, `impliedProb`, `formatOdds`)** — null-safe at the top: return multiplicative identities (1) for math, a human label ("PP line") for display. This is necessary but **not sufficient** — math identities are silent no-ops, which is the trap.
2. **Confidence/reasoning generators** — must short-circuit on `odds == null` and return a source-aware sentence + a fixed baseline. If they fall through to `impliedProb(null) * 100`, your null-safe identity makes a DFS leg look like 100% implied probability and inflates parlay-wide confidence.
3. **Point buying/selling (`canBuyPoints`, `buyPoints`, `sellPoints`)** — must refuse null odds outright. Otherwise they happily run `decimalToAmerican(americanToDecimal(null) * factor)` and **fabricate a sportsbook price** for a DFS line. Direct invariant breach.
4. **PICK-line serialization/parsing** — message pins, snapshots, and any "re-hydrate slip from chat message" path use a regex like `([+-]?\d+)` for the odds cell. Extend it to `([+-]?\d+|<your DFS marker>)` and re-attach `priceSource` on parse, or DFS legs silently vanish on round-trip.
5. **Combined-odds footers** — `calculateParlay` over a mixed slip returns a number that excludes DFS legs (because of the identity-1 multiplier). The number is honest *only if* the footer says so. Always split the count: "Combined odds (N book legs): ..." + "_M of N legs are DFS lines, not included in combined odds._" Don't show a single combined number across both products without that disclosure.

# Catch list when adding a new line-only source

- [ ] Helpers null-safe (math: identity; display: human label)
- [ ] Confidence & reasoning short-circuit on `odds == null` (don't fall through to implied-prob math)
- [ ] Point buy/sell refuses null odds
- [ ] All PICK regex parsers accept the non-numeric marker AND restore `priceSource` on the parsed pick
- [ ] Every combined-odds surface labels how many legs contribute
- [ ] Dedup key includes line, not just player+stat (alternate lines for same player are distinct projections)
