# Device test — PR #736 Build78 fixpack

## Intended preview tip (verify BEFORE college timing)

| Field | Value |
|-------|--------|
| Tip commit | see latest Preview OTA message (must include SHA) |
| Full iOS update ID | from EAS publish log / `eas update:list --branch preview` |
| Channel | `preview` |
| Native IPA | EAS build `9155c37b-0297-45a7-98fe-ea3f38bea6a9` (`057c9f0d`) |
| UDID | `00008150-001968CA2280401C` |

**Gate:** On-device `Updates.updateId` must match the tip iOS update ID and deploy message SHA before measuring `7 leg college`. EAS Insights installs=0 ⇒ tip not adopted.

## Two separate tracks (do not conflate)

### A) Early-exit UX (blocked markets)

- Ask-level: bare college / NCAAF `gameLinesOnly` while Phase E armed → prompt Phase E note (no 90s sim wait).
- Board-level: `gameLinesOnly` + every posted candidate fails `p0UnvalidatedSimDecision` → skip slate MC (`P0_UNVALIDATED_MARKETS`). NFL/NHL with open sides still sim.
- **Does not** mean college game-line picks work.

### B) College game-line picks (NOT fixed)

- `NCAAF_GAME_LINE_SIM_VALIDATED = false` until Phase E (seeded E2a PASS on 20241015; 2026-10-14 PASS withdrawn; E2b/E4 insufficient, E6 open).
- Do not claim college picks fixed until E2E returns valid simulated NCAAF sides.

## Checklist

1. Cold launch ×2 → confirm `updateId` + commit SHA.
2. Time early-exit ask `7 leg college` (expect Phase E copy, not quality-bar hang).
3. Smoke `6 leg nfl` / `6 leg nhl` / `6 leg nba` / `6 leg mlb` (must still scan; no false early exit).
4. Optional: `7 leg college football player props` (eligible sims — separate from game-line restore).

## Attestation before timing

See `docs/device-test-preview-ota-24d3f800.md` for numbered OTA fetch + Device attestation steps.
Required running update ID: `01a13c45-995d-7494-b9a5-35f07e96e47d` (commit `24d3f800` tip; tip SHA may advance — always match the published iOS update ID in that doc / latest Preview OTA message).
Do not infer install from EAS adoption counts.
