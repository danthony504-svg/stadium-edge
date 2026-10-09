# Live Odds API smoke — merged #657 + #658

**Verdict: PASS**  
**Blocker: none**  
**Tip:** `b5c9e800` (#658) on `a68aebac` (#657)  
**Domain:** `stadium-edge.onrender.com` (real Odds API best-price path)  
**Do not merge further changes / deploy Render / publish Expo OTA until this report is reviewed.**

## Scope

1. NFL, NCAAF, NBA, WNBA, MLB, NHL where live provider markets were available  
2. Alternate + milestone props keep sportsbook, eventId, athleteId, marketKey, side, line, numeric odds through Coach seating  
3. RealPropEntry vs PrizePicks traced separately  
4. Under prices independently supplied (never inferred from Over)  
5. Coach 7 / 8 / 15 on real multi-game slate  
6. Funnel counts + rejection reasons  
7. P0 / correlation / qualification / player-prop caps / post-lean fill unchanged  
8. `propSimBatchLimitForLegs` test failure diagnosis (no cap change)

## Live pool availability (full-board best-price)

| Sport | Bettable games | Pool | Alts | Milestones | Unders (own price+book) | Provenance OK |
|-------|----------------|------|------|------------|-------------------------|---------------|
| NFL   | 0              | 0    | —    | —          | —                       | —             |
| NCAAF | 48             | 1606 | 1140 | 479        | 119 / 119               | 1383          |
| NBA   | 0              | 0    | —    | —          | —                       | —             |
| WNBA  | 2              | 801  | 341  | 87         | 205 / 205               | 783           |
| MLB   | 0              | 0    | —    | —          | —                       | —             |
| NHL   | 6              | 800  | 318  | 264        | 145 / 145               | 800           |

Multi-sport Coach slate used for seating: **56** bettable odds games, **9434** full-board prop rows, teamIdMap size **2474**.

Pool rows missing `propLine` only are **yes/no markets** (Anytime TD, Double-Double) — not priced O/U ladders. They are not #658 defects; seating still requires a finite line for Over/Under props.

## Under independence

- Combined pool Unders: **919 / 919** with own `sportsbook` + American odds  
- Two-way samples show provider-posted Under books/prices (often different books than Over)  
- `underNeverInferred: true` — Under never fabricated from Over

## RealPropEntry vs PrizePicks

| Path | Live result | Seating impact |
|------|-------------|----------------|
| **Odds API → PropPoolEntry → ParsedPick** | NCAAF / WNBA / NHL pools populated with sportsbook, eventId, athleteId, marketKey, side, line, odds | Seated props all provenance-complete |
| **RealPropEntry (AI-lean)** | Code path stamps `eventId=null` / `sportsbook=null` by design | Fail-closed: stripped unless full-board pool enriches first. No live lean-only seats observed in this smoke |
| **PrizePicks** | `n=0` for NCAAF / WNBA / NHL sample games; NFL/NBA/MLB had no bettable odds game in window | No PrizePicks lines available → **zero** legitimate PP picks rejected for missing American odds in this window. If PP returned lines without American prices, provenance would strip them (documented fail-closed) |

## Coach 7 / 8 / 15 seating (full-board scan)

| Ask | Available | Simulated | Qualified | Seated | Props | Alt | Milestone | Under | Prov fail | Caps |
|-----|-----------|-----------|-----------|--------|-------|-----|-----------|-------|-----------|------|
| 7   | 9434      | 500       | 1909      | **7**  | 4     | 1   | 1         | 2     | 0         | ≤2 props/game, ≤2 legs/game |
| 8   | 9434      | 500       | 1910      | **8**  | 4     | 1   | 1         | 1     | 0         | ≤2 props/game, ≤2 legs/game |
| 15  | 9434      | 700       | 1967      | **15** | 8     | 3   | 3         | 3     | 0         | ≤2 props/game, ≤2 legs/game |

Sports on tickets: NCAAF + NHL (+ WNBA on 8/15). All seated props retained sportsbook, eventId, athleteId, propMarketKey, side, line, and numeric odds. Post-scan recheck stripped **0**.

### Example seated props (provenance intact)

- Mitch Marner **Under 1.5 Assists** — BetRivers, eventId `a46280b9…`, athleteId `3899937`, alt/milestone, odds **-435**  
- Mackenzie Alleyne **Over 16.5 Rec Yds** — FanDuel, eventId `82b83ec8…`, athleteId `5228149`, odds **-114**  
- Chelsea Gray **Over 9.5 Points** (alt/milestone) — DraftKings, eventId `3a63e90f…`, athleteId `2529122`, odds **-210**

### Rejection reasons (not provenance)

Dominant gate: `no_sim_grade` (~8780–8927) — “No simulation result (10k MC not complete)” on game/alt totals and other unscored lines. These are sim-coverage rejects, **not** missing-provenance rejects. Football prop provenance strips at seating: **0**.

## Policy unchanged

| Knob | Value |
|------|-------|
| `maxPropsPerGame(7/8/15)` | 2 / 2 / 2 |
| `maxLegsPerGame(7/8/15)` | 2 / 2 / 2 |
| P0 / correlation / qualification | unchanged on tip |
| Post-lean fill | unchanged on tip |

## `propSimBatchLimitForLegs` diagnosis

- **Implementation:** `Math.min(48, Math.max(20, 12 + n * 2))` → n=3 → **20**, n=15 → **42**  
- **Test** (`propSelection.test.ts`) expects **18** for n=3  
- **Verdict: STALE_TEST_EXPECTATION only** — not a production seating defect  
- Cap **not** changed (needs approval)

## Release recommendation

**PASS for production release of #657 + #658** on live Odds API boards where props exist (NCAAF / WNBA / NHL in this window).  

Non-blockers for this smoke:

- NFL / NBA / MLB had **no bettable props** in the 48h window (events may exist later)  
- PrizePicks returned empty (no PP seating proof this window)  
- Stale unit-test expectation for `propSimBatchLimitForLegs(3)` (fix test separately; do not lower floor without approval)

Artifact JSON: `scripts/liveOddsSmoke657658Summary.json`
