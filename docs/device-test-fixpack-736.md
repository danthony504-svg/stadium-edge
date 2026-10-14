# Device-test prep — PR #736 / commit `6f7d4178`

**Goal:** Run fixpack commit `6f7d4178dc382332bff87f46984875dabb0d521e` on your iPhone without exposing production users.

**Constraints honored:** production OTA freeze stays armed; no merge; no production publish; no build started from this prep (you approve before any EAS build).

---

## Why a separate test binary is required

| Fact | Implication |
|------|-------------|
| Build 78 / App Store binaries bake `expo-channel-name: **production**` (`app.json` → `updates.requestHeaders`) | They only fetch OTAs from the **production** channel |
| `.ota-production-freeze` blocks every production publish route | We must not put `6f7d4178` on production |
| Publishing `6f7d4178` to production would reach all production users | Forbidden |
| `eas.json` `preview` / `preview-ota` bake channel **preview** | Those binaries fetch preview OTAs only |

**Conclusion:** You cannot load this tip onto existing Build 78 without a production OTA. A **preview-channel binary** (or a development client + Metro) is required. This prep does **not** start that build — approve it explicitly when ready.

Device startup + full Coach scan speed remain **UNVERIFIED** until you measure them on device.

---

## Recommended route (preview binary + preview OTA)

### A. One-time: build a preview-channel iOS binary

When you approve a build (not started by this agent):

```bash
cd artifacts/stadium-mobile
# Internal install (ad hoc / internal distribution):
eas build --profile preview --platform ios --non-interactive

# OR TestFlight-style (store distribution) with OTA banner env:
eas build --profile preview-ota --platform ios --non-interactive
# then: eas submit --platform ios --latest   # internal TestFlight
```

Install that build on your iPhone (QR / TestFlight). Confirm it is **not** the production Build 78 channel binary.

Sanity on embedded preview JS before any OTA:

1. Cold launch ×2 — no ErrorRecovery / boot loop  
2. Email/password sign-in still works (passkey CTA may be hidden if native module absent)  
3. Open Coach once  

### B. Publish fixpack JS to **preview only** (from `6f7d4178`)

```bash
git fetch origin cursor/build78-fixpack-def8
git checkout 6f7d4178dc382332bff87f46984875dabb0d521e
cd artifacts/stadium-mobile
EXPO_TOKEN=… bash scripts/publish-preview-ota.sh \
  'PR736 fixpack 6f7d4178 device test — preview only'
```

Confirm:

```bash
pnpm exec eas channel:view preview --non-interactive
# Expect tip message containing 6f7d4178 / PR736; channel must be preview
```

Production channel must still show the frozen tip (or embedded rollback) — do **not** run any `publish-production-ota` / force / heal / republish script.

### C. Apply the tip on the preview binary

1. Force-quit Stadium Edge  
2. Re-open (OTA check on load) — or Menu → OTA Diagnostics → check / Restart if banner shows  
3. Banner should identify running → downloaded ids (or Recovery copy only for rollback) — never “Discover + Coach fixes”  
4. After Restart: confirm you are on the new tip (Diagnostics / attestation / short update id)  
5. Cold launch ×2 again — **record startup result** (this is the device PASS/FAIL for startup)

### D. College Coach checks (stay on college — do not switch sports)

NCAAF game lines are **intentionally P0 fail-closed** (see investigation below). Bare `"7 leg college"` is correctly sport-scoped but will **shortfall empty** until college game-line sims are recalibrated. Test both:

| Ask | Expected |
|-----|----------|
| `7 leg college` | NCAAF-only scope; clarification note OK; **shortfall / no MLB·NHL·NFL**; may be 0 legs (P0) |
| `7 leg college football player props` or `7 leg college receiving yards` | Still NCAAF-locked; **usable props** if books post them; no pro-sport fill |
| Contaminated expectation | Ticket sports ⊆ `{ncaaf}` only |

Also re-check: passkeys fail-soft (no crash), Ohtani dual-unders blocked if MLB props appear in a mixed ask later, rollback banner copy if you stage a preview rollback.

### E. Measure full Coach scan (required for speed verification)

On the preview tip, for an identical college ask twice (same wording, same slate window):

1. Note wall-clock from send → terminal ticket/note  
2. Capture any on-screen / Diagnostics stage timings if available  
3. Record: simulation, seating/correlation, final selection, ticket paint  

Until those device numbers exist, scan speed stays **UNVERIFIED**.

---

## Alternate route (no OTA): development client + Metro

If you prefer not to publish any OTA:

```bash
eas build --profile development --platform ios   # approve before starting
# install dev client, then from artifacts/stadium-mobile on 6f7d4178:
npx expo start --dev-client
```

JS is served from Metro on that commit; production users never see it. Still a **separate native binary** from Build 78.

---

## NCAAF P0 investigation (why college game lines do not seat)

### What is blocked

`coachP0UnvalidatedTotals.ts`:

- `P0_UNVALIDATED_NCAAF_GAME_LINE_SPORTS = {"ncaaf"}` → spreads / ML / alt / period **sides** reject with `unvalidated_ncaaf_game_line_simulation`
- NCAAF team totals + FG/period totals also fail-closed under scoring-engine P0 (`nfl`/`ncaaf`/`nhl`)
- **NCAAF player props remain open**

### Why (product reason in code)

Comment in that module: nfl-drive TD/FG rate caps make cover probs insensitive to offense/QB shocks; matchup defense packs never enter score draws. Until P1 recalibration, simulation-derived grades for those markets are fail-closed — shortfall instead of inventing.

Proof test: `coachCollegeMarketMix.proof.test.ts` → `"proof: bare college shortfalls when NCAAF game lines are P0 fail-closed"` expects **0** seated legs.

### Interaction with `"7 leg college"`

1. `wantsGameLinesOnlyAsk` → bare college / NCAAF without named player props ⇒ `gameLinesOnly: true` (no prop pool)  
2. Hard sport lock ⇒ NCAAF only (fixpack)  
3. Every NCAAF game line fails `p0UnvalidatedSimDecision` ⇒ nothing qualifies  

So a correctly scoped college ask can still return an **honest empty shortfall**. That is not a sport-leak bug; it is the P0 + gameLinesOnly collision. Usable college tickets today require an ask that allows NCAAF player props (yards / player props / etc.) while remaining college-locked.

### What this prep does **not** do

- Does not lift P0  
- Does not publish production OTA  
- Does not start an EAS build  
- Does not merge #736  

---

## Quick reference

| Item | Value |
|------|--------|
| Commit under test | `6f7d4178dc382332bff87f46984875dabb0d521e` |
| Branch | `cursor/build78-fixpack-def8` |
| PR | https://github.com/danthony504-svg/stadium-edge/pull/736 |
| Runtime | `1.1.0` |
| Test channel | `preview` |
| Production freeze | **armed** (`.ota-production-freeze`) |
| Publish script | `artifacts/stadium-mobile/scripts/publish-preview-ota.sh` |
| Build profiles | `preview` (internal) / `preview-ota` (store + OTA banner env) |
