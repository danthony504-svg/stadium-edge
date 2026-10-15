# Final rollout package (approval only — no execution)

**Verification tip (client functional):** `376eceab8d15f893bd1a280da36154a265c3fd2e`  
**Server functional tip (drive engine + period seal):** `ddeb4733348b98d7112748edc19c7e06fc6fc99a`  
**Live Render today:** `cf6c0f699e6f3dd573ade95514af79b05c8a54c1`  
**IPA (existing):** `057c9f0ddd42e9309146cc6eb8d3b68f089b4e82` / EAS `9155c37b-0297-45a7-98fe-ea3f38bea6a9` / runtime `1.1.0` / channel `preview`  
**PR:** https://github.com/danthony504-svg/stadium-edge/pull/740

Do **not** deploy, merge, publish OTA, or start a native build until explicitly approved.

---

## 1. Correlation verification at `376eceab…`

### Constrained-slot membership (correlation changes who is on the ticket)

Artifact: `artifacts/api-server/test/fixtures/sea-den-constrained-slot-membership.json`

| | Detail |
|--|--------|
| Setup | Existing: Seahawks +1.5, Darnold Pass TDs, JSN Rec Yds, Horton Receptions. Target 5 → `maxProps=4` → **one** prop seat left. Pool omits Holani so only Shaheed vs Sacks contest. |
| Before (corr off) | Membership includes **Shaheed Anytime TD**; excludes Sacks |
| After (corr on) | Membership includes **Nik Bonitto Over 0.5 Sacks**; excludes Shaheed |
| Qualified? | Both candidates pass ladder/participant/cap hard gates |
| Demotion | Soft only — Shaheed penalty **34** (eff 44) vs Sacks **22** (eff 54); Pass-TD↔receiver bump ≥12 |
| Not correlation | Count caps / ladders / participants (hard gates) |

### Seven-leg ticket limitation (`ORDER_ONLY_NOT_MEMBERSHIP`)

Under `SINGLE_EVENT_CAPS[8].maxProps=6`, Seahawks + Darnold + receivers still leave room for **both** Shaheed and Sacks on a seven-leg window. Correlation **reorders** them; it does **not** drop either for lack of a better-qualified alternative outside that pool. Label: **all seven remain because no better-qualified alternatives exist in-pool under that prop ceiling** — membership proof is the constrained-slot test above, not the seven-leg order proof.

### Displayed probability honesty

| Quantity | Source | Meaning |
|----------|--------|---------|
| Combined odds | `parlayAmerican(leg odds)` → slip “Combined odds” | Bookmaker parlay price (decimal product) |
| Combined book implied | `parlayImplied(leg odds)` → slip label **“Combined book implied”** (was “Implied win prob”) | Product of per-leg book implied probs under **independence** |
| Estimated joint hit probability | **None shipped** | No Pass-TD↔receiver joint / copula / sim co-hit model |
| Per-leg confidence / edge | Coach cards `confidencePct` / `edgePct` | Per-leg Final AI — not ticket joint |

`parlayImplied` must **not** be presented as a dependence-adjusted chance of winning. UI label + code comments updated accordingly.

---

## 2. “No server delta” — since which SHA?

| Claim | Meaning |
|-------|---------|
| **No server delta in the correlation turn** | Client-only since **`ddeb4733348b98d7112748edc19c7e06fc6fc99a`** (last tip that carried api-server drive-engine + period-seal code). `376eceab…` seating/corr is `stadium-mobile` only. |
| **Vs live API `cf6c0f69…`** | Large server gap remains. Live **lacks** `footballDriveMatchup.ts` / `gameOutcomePayload.ts` entirely — **no** `ppg-per-drive-v1`, **no** period seal. |

**Corrected drive engine + period seal still require deployment** of server tip **`ddeb4733…`** (or later containing that api-server tree) to Render `stadium-edge`. Client tip `376eceab…` alone does not put those on the API.

---

## 3. Exact SHAs for a future server-first → preview-OTA

| Step | Target | SHA |
|------|--------|-----|
| A. API (server-first) | Render **`stadium-edge`** `https://stadium-edge.onrender.com` | `ddeb4733348b98d7112748edc19c7e06fc6fc99a` minimum for engine+seal; prefer branch that also has client `376eceab…` if deploying one ref |
| B. Preview OTA | Expo channel **`preview` only**, existing IPA | Client checkout at **`376eceab8d15f893bd1a280da36154a265c3fd2e`** (or later commit that contains it + UI implied label) |
| C. Device | IPA `9155c37b…` / `057c9f0d…` / runtime `1.1.0` | No new native build |

### Production API impact (explicit)

Redeploying Render `stadium-edge` changes `/sports/simulate/game-outcome` for **all** clients — preview **and** production IPA users — because they share one API. That is **not** blocked by `.ota-production-freeze` (freeze = Expo production OTA only). Old production clients ignore `engineVersion` but will receive corrected `ppg-per-drive-v1` draws and sealed period payloads once the server tip is live.

---

## 4. Passed checks (at `376eceab…` + follow-up docs/UI)

| Check | Result |
|-------|--------|
| Constrained-slot membership test | **PASS** |
| Seven-leg order + `ORDER_ONLY_NOT_MEMBERSHIP` label | **PASS** |
| Pass-TD↔receiver soft bump unit | **PASS** |
| Isolated pipeline/cancel (`coach-pipeline-cancel-isolated.json`) | **PASS** @ `376eceab…` |
| iOS `expo export` with full SHA in HBC | **PASS** @ `376eceab…` (not published) |
| Slip label not “Implied win prob” | Fixed → “Combined book implied” |
| NCAAF game lines / unsupported periods | Still blocked |
| Production OTA | Still frozen |

---

## 5. Approval gate (no execution)

- [ ] Approve Render `stadium-edge` deploy of server tip `ddeb4733…` (production-user-affecting API)
- [ ] Approve preview-channel OTA of client `376eceab…`+ (existing IPA only)
- [ ] Keep `.ota-production-freeze` armed
- [ ] Keep NCAAF / unsupported periods fail-closed

**Do not execute until explicitly approved.**
