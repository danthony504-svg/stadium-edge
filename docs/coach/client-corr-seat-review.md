# Client review pack — correlation-aware single-event seating

**Final client SHA:** `376eceab8d15f893bd1a280da36154a265c3fd2e`  
**PR:** https://github.com/danthony504-svg/stadium-edge/pull/740  
**Base:** `cursor/football-unit-port-def8` (functional engine tip `ddeb4733…`)

This pack is **client-only**. No deploy, merge, OTA publish, or native build.

---

## What changed

1. `seatSingleEventTicket` subtracts shared `parlayCorrelationPenalty` from `rankScore` (soft demotion). Hard gates unchanged: participant, ladder, `SINGLE_EVENT_CAPS`, family/alt prefs.
2. Shared `parlayCorrelationPenalty` adds Pass-TD↔receiver soft bump **+12** (on top of same-game prop **+5**; prop↔GL still **+7**). Not a hard reject — valid same-game combos remain seatable.
3. Caps / ladders / count ceilings are **not** described as correlation modeling.
4. `parlayImplied` / `parlayAmerican` documented as independence-assumed book odds products — **not** dependence-adjusted joint probability.

---

## Before / after seven-leg proof (unit)

Artifact: `artifacts/api-server/test/fixtures/sea-den-7leg-correlation-before-after.json`

| | Before (`correlationAware: false`) | After (`correlationAware: true`) |
|--|--|--|
| 1 | Seahawks +1.5 | Seahawks +1.5 |
| 2 | Sam Darnold Over 1.5 Pass TDs | Sam Darnold Over 1.5 Pass TDs |
| 3–5 | JSN Rec / Horton Rec / Holani Rush | Holani Rush / JSN Rec / Horton Rec (order may shift) |
| 6 | **Rashid Shaheed Anytime TD** | **Nik Bonitto Over 0.5 Sacks** |
| 7 | Nik Bonitto Over 0.5 Sacks | Rashid Shaheed Anytime TD |

**Influence:** with Darnold Pass TDs + receivers + Seahawks spread on the ticket, Shaheed’s soft penalty (**39**) exceeds Sacks (**27**) by the Pass-TD↔receiver bump — Sacks seats earlier. **No hard reject.**

---

## Displayed ticket probability / confidence / EV

| Surface | What it shows | Dependence-adjusted? |
|---------|---------------|----------------------|
| Slip `combinedOdds` (`parlayAmerican`) | Product of per-leg decimal odds | **No** — payout math under independence |
| Slip `parlayImplied` | Product of per-leg book implied probs | **No** — same independence product |
| Coach card `confidencePct` / `edgePct` | Per-leg Final AI | **No** ticket-level joint model |
| Caps / distinct ladders | Exposure / identity gates | **Not correlation modeling** |

Do **not** present the odds product as a Pass-TD↔receiver joint / copula probability.

---

## Tests + export (this SHA)

| Check | Result |
|-------|--------|
| `singleEventSeating.correlation.test.ts` + seating suite | **PASS** |
| `parlayCorrelationScore` Pass-TD bump | **PASS** |
| Isolated pipeline `8 leg broncos` / spreads-ML / cancel | **PASS** — fixture `coach-pipeline-cancel-isolated.json` `reviewedSha=376eceab…` |
| iOS preview **export** (`expo export --platform ios --clear`) | **PASS** — `preview-ios-export-proof.json`: full SHA embedded in HBC; **not published** |

IPA baseline unchanged: `057c9f0ddd42e9309146cc6eb8d3b68f089b4e82` / EAS `9155c37b…` / runtime `1.1.0`.

---

## Out of scope

- Preview/production OTA publish  
- Native rebuild  
- Render API redeploy (see server pack)  
- Flipping `NCAAF_GAME_LINE_SIM_VALIDATED` / unblocking periods  
