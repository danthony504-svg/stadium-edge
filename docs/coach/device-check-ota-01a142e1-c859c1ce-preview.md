# Device check — preview OTA `01a142e1` (release `c859c1ce`)

**Published:** 2026-10-16  
**Channel:** `preview` only (production untouched; freeze armed)  
**Runtime:** `1.1.0`  
**Update group:** `af92adaa-9a40-44ab-b13a-dfd6d8315061`  
**iOS update ID:** `01a142e1-23e0-772e-beb5-bf03df51e982`  
**JS tip:** `c859c1ce73ae64182a996a2751b4f831d601ba8d`  
**Intended binary:** `preview-build78` IPA EAS `9155c37b` (no ClerkExpoPasskeys) — **Build 78–equivalent stand-in, not App Store Build 78**  
**Binary difference + pre-lift path:** [`build78-vs-preview-build78-validation-path.md`](./build78-vs-preview-build78-validation-path.md)  
**This check does not authorize:** new EAS build, production OTA, freeze lift.

## Agent environment result

| Check | Result |
|-------|--------|
| Preview publish | **PASS** (bundle exported + uploaded) |
| Production channel moved? | **No** — still embedded rollback `4a0960e4…` |
| Cold launch ×3 on Build 78 / preview-build78 | **UNVERIFIED** — no iOS device/Simulator in Cloud Agent |
| Hot Picks on this tip | **UNVERIFIED** (device) |
| Easy Money on this tip | **UNVERIFIED** (device) |
| No ErrorRecovery loop | **UNVERIFIED** (device) |

## Human follow-up — Path A only (pre-freeze-lift)

Use the **existing** `preview-build78` IPA `9155c37b` (no rebuild). Do **not** use App Store Build 78 (cannot see preview). Do **not** use a plain preview IPA with passkeys linked.

1. Confirm update `01a142e1…` / tip `c859c1ce` applied  
2. Cold launch ×3 — no ErrorRecovery / SIGABRT loop  
3. Hot Picks → Coach auto-send  
4. Easy Money → Coach auto-send  
5. Record PASS/FAIL here  

App Store Build 78 + `c859c1ce` stays **UNVERIFIED** until a later **owner-authorized** production OTA after freeze lift (Path C — not authorized by this check).
