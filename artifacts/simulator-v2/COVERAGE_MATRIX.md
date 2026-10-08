# Simulator V2 — Market Coverage Matrix

Status codes used below:

| Code | Meaning |
|------|---------|
| **Y** | Supported / available today |
| **P** | Partial (subset of markets, leagues, or books) |
| **V1** | Production Coach uses V1 only |
| **V2s** | V2 shadow settle allowed (serve still off) |
| **N** | Not supported — fail closed |
| **D** | Designed / planned, not implemented |
| **?** | Unknown / needs provider probe |
| **Legal** | Blocked on provider permission / retention policy |

Dimensions (per sport × market family):

1. **Provider** — Odds API (or Bovada) lists the market  
2. **Normalize** — App/API normalization keeps mains + alts  
3. **SimMap** — Reliable stat/simulation mapping exists  
4. **Settle** — V2 settlement rule registered  
5. **Qualify** — Coach qualification can grade (V1 path today)  
6. **Hist** — Historical outcomes for chrono OOS  
7. **Calib** — Chrono OOS calibration status  
8. **Prod** — Production readiness (`sport:family` accepted + serve)

Machine-readable source: `src/models/coverageMatrix.ts`.

## Scoring / team markets

| Sport | Family | Provider | Normalize | SimMap | Settle | Qualify | Hist | Calib | Prod |
|-------|--------|----------|-----------|--------|--------|---------|------|-------|------|
| nfl | ml/spread/total/team_total | Y | Y | Y (V2 joint) | V2s | V1 | Y | P (B correct) | N |
| nfl | period ml/spread/total | Y | Y | Y (V2 joint) | V2s | V1* | Y | P | N |
| ncaaf | ml/spread/total/team_total | Y | Y | Y (V2 joint) | V2s | V1 | Y | P | N |
| ncaaf | period | Y | Y | Y (V2 joint) | V2s | V1* | Y | P | N |
| nhl | ml/spread/total/team_total | Y | Y | V1 frac | N | V1 | Y | N | N |
| nhl | period p1–p3 | Y | Y | V1 frac | N | V1 | P | N | N |
| nba | ml/spread/total/team_total | Y | Y | V1 | N | V1 | Y | N | N |
| nba | period q/h | Y | Y | V1 | N | V1 | P | N | N |
| wnba | game + period | Y | Y | V1 | N | V1 | P | N | N |
| ncaab | game (+ halves) | Y | Y | V1 | N | V1 | P | N | N |
| mlb | ml/spread/total/team_total | Y | Y | V1 | N | V1 | Y | N | N |
| mlb | f5 / i1 | Y | Y | V1 | N | V1 | P | N | N |
| soccer | ml/spread/total + specials | Y (multi-league) | Y | V1 FG; periods unsupported | N | V1 FG | P | N | N |
| tennis | ml / match totals | Y (dynamic keys) | Y | name-only V1 | N | V1 | P | N | N |
| ufc/mma | ml / rounds / method | Y | Y | name-only / fight sim V1 | N | V1 | P | N | N |
| boxing | ml / rounds / method | ? | N | N | N | N | N | N | N |
| tabletennis | ml | P (Bovada) | P | name-only | N | P | N | N | N |
| cricket | ml / totals | P | P | N | N | N | N | N | N |
| golf | outrights | Y | Y | N (not game MC) | N | P | P | N | N |

\*Period qualification remains under existing P0 / fail-closed rules; PR #649 HOLD — do not enable unvalidated period spreads.

## Player props (mains + alternates)

| Sport | Family | Provider | Normalize | SimMap | Settle | Qualify | Hist | Calib | Prod | Notes |
|-------|--------|----------|-----------|--------|--------|---------|------|-------|------|-------|
| nfl | player_prop | Y (+ alt, QH, DST, extended) | Y | V1 prop sim | N | V1 | P | N | N | Phase C priority |
| ncaaf | player_prop | Y (+ alt/QH; thinner alts) | Y | V1 limited | N | V1 | P | N | N | Phase C; team-lean risk |
| nhl | player_prop | Y (+ alts: pts/ast/sog) | Y | V1 | N | V1 | P | N | N | Parallel P1a |
| nba | player_prop | Y (+ rich alts, Q1) | Y | V1 | N | V1 | P | N | N | Parallel P1b |
| wnba | player_prop | Y (+ alts; Q1 pts only) | Y | V1 | N | V1 | P | N | N | Own gates |
| ncaab | player_prop | Y (+ alts; no QH) | Y | V1 limited | N | V1 | P | N | N | Own gates |
| mlb | player_prop | Y (+ alts) | Y | V1 | N | V1 | P | N | N | Parallel P1c |
| soccer | player_prop | P (often WC-only) | P | P | N | P | N | N | N | Fail closed off-catalog |
| tennis | player_prop | N/P | N | N | N | N | N | N | N | Block until feed+map |
| ufc/mma | fight stats / rounds | P | P | V1 fight | N | P | N | N | N | Combat stream |
| boxing | props | N | N | N | N | N | N | N | N | Backlog |

### Alt-prop integrity checklist (every prop-capable sport)

- [ ] Odds `_alternate` keys fetched in separate batch (422 isolation)
- [ ] Normalize strips `_alternate` into same (player, stat) ladder
- [ ] SimMap grades every rung from joint draws
- [ ] Settlement registers ladder, not main-only
- [ ] Qualification / ticket assembly does not drop alts that have sim grades
- [ ] Coverage matrix row flips SimMap/Settle/Qualify only after tests green

## Production readiness summary

| Sport | Nearest prod candidate | Blockers |
|-------|------------------------|----------|
| nfl/ncaaf scoring | Phase B correct holdout | ECE/period slices; allowlist empty by policy |
| nfl/ncaaf props | Phase C | Joint prop tensor + calib |
| nhl / nba / mlb | Parallel scaffolds | No V2 generative model yet |
| All others | Later | Model + hist + calib + legal CL archive optional |

**No row may show Prod=Y without independent gate pass + human approval.**
