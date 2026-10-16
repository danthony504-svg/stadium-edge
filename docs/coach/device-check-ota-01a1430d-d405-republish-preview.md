# Device check — preview republish of known-good `d405e8b6` → `01a1430d`

**Published:** 2026-10-16  
**Channel:** `preview` only  
**Action:** `eas update:republish --group d405e8b6-edf6-45d3-a8a6-d977ea97d2f4 --platform ios`  
**Production:** untouched (embedded `4a0960e4…`); `.ota-production-freeze` **armed**  
**Native build / server deploy / merge:** none

---

## Pre-republish verification (passed)

| Gate | Expected | Observed |
|------|----------|----------|
| Full group ID | `d405e8b6-edf6-45d3-a8a6-d977ea97d2f4` | **Match** |
| Source JS | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` | **Match** (publish log + message `…40f5b9f4…`) |
| Platform | `ios` | **Match** |
| Runtime | `1.1.0` | **Match** |
| Branch | `preview` | **Match** |
| Kind | JS tip (not embedded rollback) | **Match** (`isRollBackToEmbedded: false`) |
| Prior device result | Hot Picks + Easy Money **PASS** | `device-check-ota-01a14121-hot-picks.md` |

---

## New tip identity (after republish)

| Field | Value |
|-------|--------|
| **New iOS update ID** | `01a1430d-37ee-747a-be37-c296473cff9f` |
| **New update group** | `2d980f30-223d-4cca-8654-48929301d4af` |
| Source group (republished) | `d405e8b6-edf6-45d3-a8a6-d977ea97d2f4` |
| Source update | `01a14121-a602-751f-b218-724db14536d6` |
| Source commit | `40f5b9f4747df2b99c98c4c08d26f276e2e07d16` |
| Runtime / platform / branch | `1.1.0` / `ios` / `preview` |
| Launch asset SHA256 | `_RzFHXl4PChEDcOIoyZUiwmDB18rXBNhVq_PUyg277M` (same as source) |
| Message | `PREVIEW republish known-good d405e8b6 @ 40f5b9f4 (runtime 1.1.0) — af92adaa known-bad; prod freeze armed` |

---

## Preserved known-bad + crash artifacts

| Item | ID / path | Status |
|------|-----------|--------|
| Failed tip | `c859c1ce` / update `01a142e1…` / group **`af92adaa-9a40-44ab-b13a-dfd6d8315061`** | **Known-bad — do not republish** |
| IPS pair | `/opt/cursor/artifacts/ips-2026-10-15/StadiumEdge-2026-10-15-232030_5287.ips`, `…232044_5384.ips` | Preserved |
| Symbolication | `/opt/cursor/artifacts/ips-2026-10-15/symbolication-build79.json` | Preserved |
| FAIL docs | `docs/coach/preview-c859c1ce-crash-fail-2026-10-15.md` | Preserved |

---

## On next successful device boot — export Expo error / recovery logs

This republished tip **already includes** Device attestation (`/ota-debug`) with `Updates.readLogEntriesAsync` + **Copy full report**. Do this **immediately** after the tip applies and the app reaches Home (before unrelated relaunches):

1. Confirm running update is `01a1430d-37ee-747a-be37-c296473cff9f` (Home strip or Menu → Device attestation).
2. Open **Menu → Device attestation** (or tap the Home attestation strip).
3. Wait for **expo-updates native logs** to finish loading.
4. Tap **Copy** (full attestation report) and paste into a follow-up note / PR comment.
5. In the paste, search for (first hits win):
   - `Fatal error:`
   - `Fatal exception:`
   - `ErrorRecovery fatal exception:`
   - `AppController markFailedLaunchForUpdate`
   - `Cannot find native module`
6. Optional parallel: if the container still has `Library/Application Support/expo-error.log`, export that file too (native `consumeErrorLog` may already have deleted it after a prior successful boot — native log paste is then the source of truth).

**Do not** run live check/fetch/reload probes until the native-log paste is saved.

---

## Device validation checklist (after log export)

| Check | Result |
|-------|--------|
| Tip `01a1430d` applied | _pending device_ |
| Cold launch ×2, no ErrorRecovery | _pending_ |
| Hot Picks | _pending_ (expected PASS — same JS as `01a14121`) |
| Easy Money | _pending_ |
| Fatal / markFailedLaunch paste captured | _pending_ |
