# Device steps — fetch preview OTA + attest before timing

**Intended tip:** commit `24d3f800`  
**Required running update ID:** `01a13c45-995d-7494-b9a5-35f07e96e47d`  
**Do not** infer install success from EAS Insights adoption counts.

## Numbered steps

1. Install / open the **preview-build78** Ad Hoc IPA (EAS build `9155c37b-…`, binary commit `057c9f0d`) on UDID `00008150-001968CA2280401C`.
2. Confirm the binary channel is **preview** (IPA inspect already verified `channel=preview`).
3. **Force an OTA fetch:** fully quit the app (swipe away), wait ~5 seconds, cold-launch again. Repeat once so Expo Updates can download + apply the tip.
4. If a restart / “Update ready” banner appears, accept / restart so the pending tip becomes the running bundle.
5. Open **Device attestation** (any of):
   - Menu (☰) → **Device attestation**, or
   - Home → tap **Device attestation** strip, or
   - Account → read the **OtaRunningIdentity** block, or
   - Deep link: `stadium-mobile://ota-debug`
6. On the attestation screen, read **`Updates.updateId`** (full UUID).
7. **Gate:** proceed only if  
   `Updates.updateId` **equals** `01a13c45-995d-7494-b9a5-35f07e96e47d`  
   and `isEmbeddedLaunch` is **false**, and the deploy / commit line mentions **`24d3f800`**.
8. If the ID differs, Copy report → paste the updateId + commit lines, then retry steps 3–7 (or reinstall IPA and fetch again). **Do not time Coach until the ID matches.**
9. Only after step 7 passes: send **`7 leg college`** and record wall time from Send → final rendered note (early-exit Phase E copy expected; not a graded ticket).

## Separate report tracks (do not conflate)

| Track | Status until you measure |
|-------|---------------------------|
| A. Early-exit behavior verified on device | **Pending your attestation + timed ask** |
| B. College simulation validation (Phase E) | 2026-10-14 E2a PASS withdrawn (unit mismatch). `ppg-per-drive-v1` 10k holdout is E2a FAIL; E2b/E4/E6 still open — **not** restore-ready |
| C. Valid college picks returned end-to-end | **Not claimed** — P0 still armed; needs E2b+E4+E6+E2E |
