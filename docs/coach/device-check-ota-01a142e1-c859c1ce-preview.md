# Device check — preview OTA `01a142e1` (release `c859c1ce`)

**Published:** 2026-10-16  
**Channel:** `preview` only (production untouched; freeze armed)  
**Runtime:** `1.1.0`  
**Update group:** `af92adaa-9a40-44ab-b13a-dfd6d8315061`  
**iOS update ID:** `01a142e1-23e0-772e-beb5-bf03df51e982`  
**JS tip:** `c859c1ce73ae64182a996a2751b4f831d601ba8d`  
**Intended binary:** `preview-build78` IPA EAS `9155c37b` (no ClerkExpoPasskeys) — **not** App Store Build 78

## Agent environment result

| Check | Result |
|-------|--------|
| Preview publish | **PASS** (bundle exported + uploaded) |
| Production channel moved? | **No** — still embedded rollback `4a0960e4…` |
| Cold launch ×3 on Build 78 / preview-build78 | **UNVERIFIED** — no iOS device/Simulator in Cloud Agent |
| Hot Picks on this tip | **UNVERIFIED** (device) |
| Easy Money on this tip | **UNVERIFIED** (device) |
| No ErrorRecovery loop | **UNVERIFIED** (device) |

## Human follow-up (required for Build 78–equivalent attestation)

On **preview-build78** only:

1. Cold launch ×3 after update applies  
2. Hot Picks → Coach auto-send  
3. Easy Money → Coach auto-send  
4. Confirm no ErrorRecovery / SIGABRT loop  

Do **not** publish this tip to production until freeze lift criteria are met.
