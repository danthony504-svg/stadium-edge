# Coach player props research audit (2026-10-25)

**Scope:** What actually reaches Monte Carlo hit% → grade floors → Coach seating.  
**Non-goals this PR:** OTA publish, unvalidated model enablement, notifications, NCAAF release-gate changes.

## Path (all sports with props)

`The Odds API props catalog` → `POST /sports/simulate/props` (`runPropSims` / `buildProjectionMean`, deep=10k) → mobile provenance (`exact_market_10k`) → floors (52% / C+ / +EV) → ticket staging / correlation caps → Coach selection.

Fetched or cached data that never enters this path is marked **partial / missing / shadow_only**, not connected.

## Checklist (10 priorities)

| # | Area | Status | Source → normalize → sim → grade → Coach | Provider / licensing |
|---|---|---|---|---|
| 1 | Playing opportunity | **partial** | ESPN gamelog → Opp Shift channels + enrich `minutesTrend` → MC usage only (minutes stripped from propsim shape) → holistic minutes → seat | ESPN public logs |
| 2 | Injuries | **connected** | ESPN injuries → OUT null-row + injury weights + Opp Shift redistribute → MC / availability → seat | ESPN injuries |
| 3 | Opponent defense / pace | **partial** | StatMuse pace (NBA/WNBA) + vs-opp; `defenseIndexByFamily` accepted but Coach seating does not send (Stage-4 **shadow_only**) | StatMuse; internal defense packs |
| 4 | Role changes | **partial** | Prepared MLB/soccer lineups gate nonstarters; NFL depth prepared but unused for availability; no snap-share upgrade model | ESPN lineups/depth |
| 5 | Prices | **connected** | Odds API stamps book/side/line/odds/`sourceUpdatedAt` → seating identity (not MC features) | The Odds API (paid) |
| 6 | Game environment | **missing** | Spread/total/blowout/script not on `PropSimulationContext` | Odds API game lines |
| 7 | Advanced matchups | **partial** | vs-opp + QB←WR coupling connected; coverage/assignments unavailable; depth evidence-only | ESPN depth |
| 8 | Rest / venue / weather | **partial** | Venue shift connected; rest/travel missing; prepared OpenWeather now **shadow-mapped** for MLB (default not applied to MC) | OpenWeatherMap key; ESPN venue |
| 9 | Prop-specific volume | **partial** | Labels → `propStatValue` / channels when present; routes/RZ/GL often empty; first-TD blocked without scoring order | ESPN stats |
| 10 | Correlation / uncertainty | **partial** | Ticket correlation + same-game caps; shared-draw fingerprint; no joint SGP draw / calibrated uncertainty | — |

## Code verification vs predictive validation

### Code verification (this PR — safe for subscribers)

- Inventory attached on `/sports/simulate/props` as `propsResearch` + `weatherResearch` (truthful shortfalls).
- MLB prepared weather resolved through `resolvePropSimWeatherImpact` — **default leaves `weatherImpact` null**.
- Holdout opt-in only: `applyPreparedWeatherImpact=true`.
- Pregame archive enqueue after deep sims (`research:props:pregame:*` fingerprint + exact book/market/side/line/odds/timestamp + hit%).
- Minutes holdout helper (`toPropSimHistoryShapeWithMinutesHoldout`) — production `toPropSimHistoryShape` unchanged.
- Coach slate in-process path uses the same weather resolver (still off by default).
- Floors preserved: 10k deep, 52%/C+, +EV, football period bans, alternate lines, NCAAF gates untouched.

### Predictive validation (separate holdout — **not enabled**)

| Candidate | Why gated | How to evaluate |
|---|---|---|
| Apply prepared MLB `weatherImpact` | Changes hit% | Holdout games with `applyPreparedWeatherImpact=true`; compare calibration vs control |
| Attach `minutesTrend` to propsim shape | Changes NBA/WNBA means | Holdout via `propMinutesHoldout` overlay vs production shape |
| Seat `defenseIndexByFamily` | Changes matchup mult | Keep Stage-4 shadow until acceptance; then mobile pass-through |
| Spread/total/blowout script | No MC fields yet | Design + holdout before any mean multiplier |
| Coverage / defender assignments | No verified provider contract | Do not invent |

## Latency

| Measurement | Result |
|---|---|
| Prior Coach warm 5-leg (phase-24 baseline, unchanged path) | ~14.3–16.2s wall (`coach-phase24-final-validate.md`) |
| Research helpers microbench (2000× weather resolve + inventory) | &lt;250ms total in unit test → **&lt;0.15ms/request** class overhead |
| Archive | `setImmediate` after `res.json` — not on Coach critical path |
| Candidate limits | None added |

Cold/warm Coach E2E against live slate still depends on odds/history I/O; this PR does not add candidate caps and keeps research work off the await path.

## Backend vs mobile / OTA

| Change | Surface | OTA needed? |
|---|---|---|
| Weather shadow + inventory + archive + holdout helpers | api-server | **No** |
| Defense index seating / client `weatherImpact` pass-through | stadium-mobile | Yes (not done) |
| Grade floors / period bans / provenance | stadium-mobile (existing) | N/A this PR |

**No OTA published. No notifications. No unvalidated model enabled.**
