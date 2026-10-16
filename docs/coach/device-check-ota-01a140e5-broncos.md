# Device rendering check — OTA `01a140e5-3c7a-70d1-8968-af35752d0c59`

**Recorded:** 2026-10-15  
**Channel:** `preview`  
**Runtime:** `1.1.0`  
**Update group:** `eb2cc7d7-ca2f-41fb-b008-5186b55a0dcd`  
**iOS update ID:** `01a140e5-3c7a-70d1-8968-af35752d0c59`  
**Published commit (OTA JS):** `afb30bde18208404d49df247653ed350c77d0aa1`  
**API (unchanged):** `ddeb4733348b98d7112748edc19c7e06fc6fc99a` @ `stadium-edge.onrender.com`

## Ask

`8 leg broncos`

## Observed on device

| Check | Result |
|-------|--------|
| Terminal ticket rendered | Yes |
| Delivered legs | **7** (shortfall vs 8) |
| Visible null-note / `joinCoachNoteParts` exception | **None** |
| Timing instrumentation | **Unverified** |
| Cancellation / abort path | **Unverified** |

Honest shortfall copy is expected when fewer than 8 team-scoped legs clear quality gates; production OTA remained frozen.

## Follow-ons (not part of this OTA)

- Keyboard-down chevron + composer gap fix  
- Strict `"players only"` franchise-player filter  

Those land on tip `511975facd869c9e8e39a2c9d3d83b8e4fe29d52` (and later) — **not** yet published to preview.
