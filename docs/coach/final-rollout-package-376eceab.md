# Final rollout package — approval only (no execution)

## Exact SHAs

| Role | Full SHA |
|------|----------|
| **Final client (export verified)** | `afb30bde18208404d49df247653ed350c77d0aa1` |
| Correlation seating functional tip (ancestor) | `376eceab8d15f893bd1a280da36154a265c3fd2e` |
| **Server (drive engine + period seal)** | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` |
| Live Render today | `cf6c0f699e6f3dd573ade95514af79b05c8a54c1` |
| Existing IPA | `057c9f0ddd42e9309146cc6eb8d3b68f089b4e82` · EAS `9155c37b-0297-45a7-98fe-ea3f38bea6a9` · runtime `1.1.0` · channel `preview` |

**PR:** https://github.com/danthony504-svg/stadium-edge/pull/740

Client `afb30bde…` = `376eceab…` + constrained-slot verification + slip label honesty (`Estimated combined odds` / `Independence-based implied probability`).

---

## Slip probability labels (in exported client)

| UI label | Source | Meaning |
|----------|--------|---------|
| **Estimated combined odds** | `parlayAmerican(leg odds)` | Product of individual leg prices. **Actual sportsbook pricing may differ, especially for same-game tickets.** |
| **Independence-based implied probability** | `parlayImplied(leg odds)` | Product of per-leg book implied probs under independence. **Not** an estimated joint / dependence-adjusted win probability. |

Helper copy on the slip states both facts. Estimated joint hit probability is **not shipped**.

### Export result (this exact client SHA)

Artifact: `artifacts/api-server/test/fixtures/preview-ios-export-proof.json`

| Check | Result |
|-------|--------|
| Command | `pnpm exec expo export --platform ios --clear` |
| `EXPO_PUBLIC_GIT_COMMIT` | `afb30bde18208404d49df247653ed350c77d0aa1` |
| Full SHA in HBC | **yes** |
| “Estimated combined odds” in HBC | **yes** |
| “Independence-based implied probability” in HBC | **yes** |
| Sportsbook-may-differ copy in HBC | **yes** |
| Old “Implied win prob” | **absent** |
| Published OTA / native build | **no** |
| **PASS** | **true** |

Bundle: `/tmp/preview-ios-export-afb30bde` · sha256 `34c0d6d95a70def402c34706ba9212752febb416297770a007e265aa734a1c14`

---

## Correlation verification (retained)

- Constrained-slot membership change @ `376eceab…` lineage: Shaheed → Sacks under last prop seat (`sea-den-constrained-slot-membership.json`).
- Seven-leg: `ORDER_ONLY_NOT_MEMBERSHIP` (maxProps=6 fits both; no better alternatives outside pool).
- Caps/ladders ≠ correlation modeling.

---

## Server vs live

- **No api-server delta since `ddeb4733…`** for the correlation/client-label work.
- Live `cf6c0f69…` **still lacks** `ppg-per-drive-v1` and period seal → **server deploy of `ddeb4733…` is still required**.

---

## Approval-only sequence (do not execute)

1. **Server first:** Redeploy Render **`stadium-edge`** (`https://stadium-edge.onrender.com`) at `ddeb4733348b98d7112748edc19c7e06fc6fc99a`. Confirm `/api/healthz` `deploymentSha` matches.
2. **Client second:** Preview-channel OTA only of **`afb30bde18208404d49df247653ed350c77d0aa1`** onto existing IPA `9155c37b…` / `057c9f0d…` / runtime `1.1.0`. No native rebuild.
3. Keep **`.ota-production-freeze` armed**. NCAAF game lines + unsupported periods stay **blocked**.

### Production API impact (explicit)

The shared Render service serves **preview and production** IPAs. Deploying `ddeb4733…` changes game-outcome responses for **production users** as well. That is intentional server-first order and is **not** an Expo production OTA; production OTA remains frozen.

---

## Passed checks

| Check | Status |
|-------|--------|
| Constrained-slot membership | PASS |
| Seven-leg order + limitation label | PASS |
| Slip label unit lock | PASS |
| Isolated pipeline/cancel @ `376eceab…` | PASS |
| iOS export @ `afb30bde…` with SHA + new labels in HBC | PASS |
| Production OTA | frozen |
| NCAAF / unsupported periods | blocked |

---

## Gate

- [ ] Approve Render `stadium-edge` deploy of `ddeb4733…` (affects production API users)
- [ ] Approve preview OTA of `afb30bde…` on existing IPA only
- [ ] Keep production OTA frozen; NCAAF/periods fail-closed

**No execution until explicitly approved.**
