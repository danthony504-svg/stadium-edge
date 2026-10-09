# Pre-publish GO — #657 + #658 (controlled production OTA)

**Decision: GO**  
**Do not publish until explicit approval.**  
**No native build. No simulation-model changes. No Render deploy required.**

## 1. Publish tip contains both merge SHAs

| Item | Value |
|------|-------|
| Production publish tip (`origin/main`) | `b5c9e80013432cffe4541db7f31614298fe520e5` |
| #657 merge | `a68aebac21b12a8f4bd50490b6656d2041160e8c` — **ancestor of tip** |
| #658 merge | `b5c9e80013432cffe4541db7f31614298fe520e5` — **is tip** |
| Last force-OTA tip | `7b252d0f` (Slice A #655) |

## 2. Expo production channel + runtime 1.1.0

From `artifacts/stadium-mobile/app.json` on tip:

- `expo.version`: **1.1.0**
- `expo.runtimeVersion`: **1.1.0**
- `expo.updates.requestHeaders.expo-channel-name`: **production**
- `.ota-production-freeze`: **absent** (OTA allowed)

`force-production-ota.sh` / `eas update --channel production` publish against `app.json` runtime **1.1.0** (not the stale `RUNTIME_VERSION` default in `publish-production-ota.sh`).

## 3. Scope — no unrelated / Sim V2 / cap / P0 / correlation changes

Files in `7b252d0f..origin/main` under `artifacts/stadium-mobile/`:

- #657: `boardPropSimExpansion.ts` (+ test) — taken-Set dedupe for milestone ladder seats  
- #658: `propProviderProvenance.ts` (+ test), `api.ts` threading, `boardMarketScanner` enforce, `propSelection` / `pickScoreContext` / `PickCard`, loss-trace JSON  
- Also on tip (related milestone path, landed after last OTA): **#656** `coachMilestoneLines.ts`, `boardPropSimExpansion` milestone fill, `ticketStaging` shortfall prop seating  

**Confirmed absent from ship range:**

- Simulator V2 paths  
- `parlayCorrelationScore.ts` / `maxPropsPerGame` / `maxLegsPerGame` edits  
- `mlLeanEnforcement.ts` / P0 gate edits  
- `postLeanFinalFill.ts` edits  
- `app.json` runtime / native config edits  

Live tip still: `maxPropsPerGame(7|8|15)=2`, `maxLegsPerGame(7)=2`.

## 4. Production Render compatibility + fail-closed

- Domain: `stadium-edge.onrender.com`  
- Full-board Odds API path returns `overBook` / `underBook` / `athleteId` / event id; client stamps per-side `sportsbook` + `eventId`  
- Live re-probe: Under sample Kienholz Under 1.5 Pass TDs @ **-119 BetOnline.ag** vs Over @ **+100 FanDuel** (independent)  
- `enforceSeatedPropProviderProvenance` strips incomplete props (missing sportsbook / eventId / athleteId / marketKey / side / line / odds) — confirmed with injected fake missing sportsbook  
- Yes/no markets (Anytime TD) missing only `propLine` fail closed as designed  

No Render redeploy required for this OTA (client-side provenance enforcement + field threading).

## 5. 7 / 8 / 15 independence (live smoke tickets)

| Ask | Seated | Distinct games | Dup ladder keys | Same athlete+market multi-line | Caps |
|-----|--------|----------------|-----------------|--------------------------------|------|
| 7   | 7      | 6              | **0**           | **none**                       | ≤2 props/game, ≤2 legs/game |
| 8   | 8      | 8              | **0**           | **none**                       | 1 prop/game, 1 leg/game |
| 15  | 15     | 14             | **0**           | **none**                       | ≤2 props/game, ≤2 legs/game |

Seating runs `dedupePicksByMarketLadder` before delivery. No repeated ladder outcomes or same-player same-market filler. Same-game prop pairs (e.g. Marner assists + Karlsson/Eichel other markets) stay within `maxPropsPerGame=2` with distinct athletes/markets.

## 6. Unverified in this window (document, non-blocking for GO)

| Coverage | Status |
|----------|--------|
| NFL live-provider props | **Unverified** — 0 bettable props in smoke window |
| NBA live-provider props | **Unverified** — 0 bettable props |
| MLB live-provider props | **Unverified** — 0 bettable props |
| PrizePicks path | **Unverified** — 0 lines on sampled NCAAF/WNBA/NHL games |

Verified live: **NCAAF, WNBA, NHL** full-board best-price + Coach seating provenance.

---

## Exact OTA publish command (awaiting approval — do not run)

**Preferred (matches #655 force-publish pattern):** on `main` at `b5c9e800`, bump the trigger file and push:

```bash
# cwd: repo root, branch main @ b5c9e800
printf '%s\n' "Coach #657+#658 provenance/milestone OTA — merge b5c9e80013432cffe4541db7f31614298fe520e5 $(date -u +%Y-%m-%dT%H:%MZ)" \
  > artifacts/stadium-mobile/.ota-force-publish
git add artifacts/stadium-mobile/.ota-force-publish
git commit -m "chore(ota): force production publish for #657+#658 [force-only]"
git push origin main
```

That triggers **Force production OTA** (`.github/workflows/force-production-ota.yml`), which runs:

```bash
cd artifacts/stadium-mobile
bash scripts/force-production-ota.sh "Force latest Stadium Edge UI <github.sha> <stamp>"
# → pnpm exec eas update \
#      --channel production \
#      --platform ios \
#      --environment production \
#      --message "..." \
#      --non-interactive
```

**Expected scope:** JS-only iOS OTA on **production** channel, **runtimeVersion 1.1.0**, tip `b5c9e800` (#658) including #657 + related #656 milestone fill. No native build, no Render deploy, no Simulator V2, no cap/P0/correlation/sim-model changes.

**Manual equivalent** (if not using the trigger file):

```bash
cd artifacts/stadium-mobile
EXPO_TOKEN=*** EXPO_PUBLIC_DOMAIN=stadium-edge.onrender.com \
  bash scripts/force-production-ota.sh \
  "Coach #657+#658 OTA b5c9e800 $(date -u +%Y-%m-%dT%H:%MZ)"
```
