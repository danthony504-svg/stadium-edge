# Launch-asset reconciliation — `40f5b9f4` tip vs stale `afb30bde` label

**Correction (2026-10-16):** Device was running update **`01a1430d-37ee-747a-be37-c296473cff9f`** (republish of `d405e8b6` / `40f5b9f4` JS). The **`afb30bde` string was a stale secondary label**, not proof of a different tip. Do **not** infer “wrong tip applied” from that label alone.

---

## Authoritative running identity

| Signal | Source | Value for republish tip |
|--------|--------|-------------------------|
| `Updates.updateId` | expo-updates (runtime) | `01a1430d-37ee-747a-be37-c296473cff9f` |
| Launch `fileSHA256` | EAS manifest `launchAsset.hash` | `_RzFHXl4PChEDcOIoyZUiwmDB18rXBNhVq_PUyg277M` |
| Matches PASS tip `01a14121` | same hash | **Yes** |
| Matches slip tip `01a140e5` (`afb30bde` publish) | hash `TZuiYbt…` | **No** |

Artifact: `/opt/cursor/artifacts/launch-asset-hash-reconciliation.json`.

---

## Where the stale `afb30bde` label comes from

Traced against baked env / manifest / persisted state:

| Candidate source | Result |
|------------------|--------|
| **Baked JS env `EXPO_PUBLIC_GIT_COMMIT`** | **Primary.** Device attestation **“Commit hash (running JS)”** reads `process.env.EXPO_PUBLIC_GIT_COMMIT` (`lib/otaDebug.ts`), inlined by Metro at **export** time. `publish-preview-ota.sh` sets `EXPO_PUBLIC_GIT_COMMIT="${EXPO_PUBLIC_GIT_COMMIT:-$FULL}"` — if a prior shell export left `EXPO_PUBLIC_GIT_COMMIT=afb30bde…`, a later `40f5b9f4` export **reuses that stale value** even when `git rev-parse` / EAS `--message` say `40f5b9f4`. Republish **reuses the same launch asset**, so the stale bake survives on `01a1430d`. |
| **EAS manifest metadata** | **Not the label.** `01a1430d` manifest `metadata` is only `{ updateGroup, branchName }`; serialized manifest contains **neither** `afb30bde` nor `40f5b9f4`. Channel tip **message** is the republish string (`…@ 40f5b9f4…`), not `afb30bde`. |
| **Persisted AsyncStorage** | **Not the label.** Persisted OTA keys track ready/failed-launch **update ids**, not git commit / deploy message (`otaBannerTrace`, `otaFailedLaunch`). |
| **Native IPA bake** | **Not `afb30bde`.** Embedded `main.jsbundle` (Build 79) contains `not-baked` for the unset commit path; no `afb30bde` string. |

### How to read Device attestation going forward

| Field | Trust for tip identity? |
|-------|-------------------------|
| `Updates.updateId` | **Yes** — authoritative |
| Launch-asset hash (server) | **Yes** — content identity |
| EAS update / channel **message** | Descriptive only |
| `commitHash` / `deployMessage` (baked `EXPO_PUBLIC_*`) | **Secondary** — can lag if env was stale at export |

---

## Hash table (unchanged facts)

| Label | Git (publish record) | Update ID | Group | Launch `fileSHA256` | Export HBC |
|-------|----------------------|-----------|-------|---------------------|------------|
| Slip OTA | `afb30bde18208404d49df247653ed350c77d0aa1` | `01a140e5-…` | `eb2cc7d7-…` | `TZuiYbtcmQAxm0wqL0ZCuVIXKjw5mZb-Iw6Ei27sC3Y` | `entry-efc28f375d270ed4b2495bb0b7c60d35.hbc` |
| Home-shortcuts PASS | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` | `01a14121-…` | `d405e8b6-…` | `_RzFHXl4PChEDcOIoyZUiwmDB18rXBNhVq_PUyg277M` | `entry-baa93d88e0ae82a94b0a33dac53abdd8.hbc` |
| Republish | message `@ 40f5b9f4` (bake may still show stale commitHash) | `01a1430d-…` | `2d980f30-…` | `_RzFHXl4…` (same as PASS) | same asset |
| Failed Path A | `c859c1ce…` | `01a142e1-…` | `af92adaa-…` | `OS4PejuGj0QksztEcIF8yUXYqlb306ctN-G6EUx6gaE` | distinct |

---

## Verdict (corrected)

| Claim | Result |
|-------|--------|
| `01a1430d` was the running tip | **Yes** (updateId) |
| `01a1430d` JS === `40f5b9f4` / `01a14121` | **Yes** (launch hash) |
| `afb30bde` on attestation meant tip was `01a140e5` | **No** — stale **baked** `EXPO_PUBLIC_GIT_COMMIT` (or deploy message), not tip identity |
| Next preview export of `03dd1116` | Must force `EXPO_PUBLIC_GIT_COMMIT=<full SHA>` and unset any prior value before Metro export |
