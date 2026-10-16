# Server review pack — correlation seating turn

**Client tip (this turn):** `376eceab8d15f893bd1a280da36154a265c3fd2e`  
**Engine functional tip (unchanged):** `ddeb4733348b98d7112748edc19c7e06fc6fc99a` (`ppg-per-drive-v1`)  
**Live Render today:** `https://stadium-edge.onrender.com` · `deploymentSha=cf6c0f699e6f3dd573ade95514af79b05c8a54c1`

## Server delta this turn

**None since `ddeb4733348b98d7112748edc19c7e06fc6fc99a`.** Correlation-aware `seatSingleEventTicket` and the Pass-TD↔receiver soft bump are **client** (`artifacts/stadium-mobile`) only. Isolated pipeline tests rewrote simulate traffic to a local tip-SHA sim (`:8787`); they did not change production API code.

### Vs live `cf6c0f699e6f3dd573ade95514af79b05c8a54c1`

Live **does not** contain `footballDriveMatchup.ts` or `gameOutcomePayload.ts`. Corrected **`ppg-per-drive-v1`** drive engine and **period seal** are therefore **not** on production API yet — they still require a Render deploy of server tip **`ddeb4733…`** (or later with that api-server tree).

## Shared Render impact (explicit)

| Fact | Detail |
|------|--------|
| Sole API | Preview + production IPAs both use `EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com` |
| If API redeployed later | **All** clients (including production IPA users) receive new `/sports/simulate/game-outcome` bodies |
| `.ota-production-freeze` | Blocks Expo **production OTA only** — does **not** block Render redeploy |
| This turn | **No** Render deploy, **no** merge to `main`, **no** production OTA |

When a future approval asks for server-first rollout of `ppg-per-drive-v1`, treat Render `stadium-edge` redeploy as production-user-affecting API traffic even though it is not an Expo production publish.

## Server readiness retained from prior tip

| Marker | Status |
|--------|--------|
| `FOOTBALL_DRIVE_ENGINE_VERSION = "ppg-per-drive-v1"` | On functional tip `ddeb4733…` |
| Engine stamp on game-outcome | Required by new clients |
| `NCAAF_GAME_LINE_SIM_VALIDATED` | Still `false` (client fail-closed) |
| Unsupported period seal | Still armed |

## Not executed

- Render deploy hook / dashboard deploy  
- Merge to `main`  
- Production or preview OTA publish  
- Native IPA rebuild  
