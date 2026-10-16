# Production release inventory — tip `929bfbfe`

**Runtime:** `1.1.0` · **Target binary:** App Store Build 78 (channel `production`)  
**Method:** forced-SHA export → `eas update --skip-bundler --input-dir dist` · **iOS only**  
**Authorized:** production OTA for this tip (freeze lift for this release only).

---

## Full SHA

`929bfbfe6847e1488c4c75824373811d1fe22e8c`

---

## Included (JS OTA — completed on this branch)

| Area | Tip / note |
|------|------------|
| Passkey startup guard | `hasClerkExpoPasskeysNative` before `@clerk/expo/passkeys` (Build 78/79 absent-module safe) |
| OTA apply hardenings | Embedded-rollback / safer reload path retained from corrected candidate |
| Home shortcuts → Coach | Hot Picks / Easy Money / Best Value / Longshots → Coach |
| Explicit `ticketStyle` | `balanced` / `safe` / `value` / `longshot` through launch → build |
| All-sports Home asks | No Home sport pill in shortcut asks/params |
| Best Value seating | Positive-EV style narrow among qualified |
| Longshots plus-money floor | American odds ≥ +100 (handicap ≠ odds) |
| Longshots after substitution | Style belt on top-up / lean / inject / terminal delivered odds (`929bfbfe`) |

Preview validation tip: `01a144ad` / group `15c261b9…` (same SHA bake lineage).

---

## Explicitly unchanged (preserved)

- Shared qualification / sim / correlation / sport-specific gates  
- Honest shortfall (no unqualified chalk padding)  
- No server API / Render deploy  
- No native / EAS rebuild  
- No merge to `main`

---

## Unverified / residual risk

| Item | Status |
|------|--------|
| App Store Build 78 cold-launch ×N on **this** production tip | Not yet device-attested on production channel (preview IPA Build 79 exercised related tips) |
| Original Build 78 IPS fatal text (Oct 14) | Still unrecovered; this tip addresses known ClerkExpoPasskeys fatal class |
| Subscriptions / StoreKit | Native-only — not part of this OTA |
| Server-side Coach scoring changes | None in this tip |

---

## Requires server or native change (out of scope)

- New TestFlight / App Store binary  
- Clerk native `ClerkExpoPasskeys` module  
- Backend / Render deploy  
- `runtimeVersion` bump  

---

## Rollback target (pre-publish production tip)

| Field | Value |
|-------|--------|
| Group | `4a0960e4-10e8-4ac8-a77d-3c37891942c2` |
| Message | Emergency rollback to embedded bundle |
| Runtime | `1.1.0` |
