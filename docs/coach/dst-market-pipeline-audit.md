# D/ST market pipeline audit

**Date:** 2026-10-15  
**Scope:** Audit only — no code changes, no OTA, no gate/speed changes.  
**Sports:** NFL primary; NCAAF / NBA / NHL / others for equivalents.  
**Categories:** sacks, tackles, assists, tackles + assists, kicking points, defensive interceptions, team total specials.

Status legend: **supported** · **unavailable from provider** · **missing data/model** · **deliberately blocked**

---

## Shared NFL wiring

| Layer | Location | Behavior |
|-------|----------|----------|
| D/ST allowlist | `api-server/.../props.ts` `MARKETS_DST_BY_SPORT.nfl` | `player_kicking_points`, `player_tackles_assists`, `player_solo_tackles`, `player_defensive_interceptions` — **NFL only**, isolated `props-dst:` batch |
| Client D/ST set | `stadium-mobile/lib/footballDstProps.ts` | Same four keys; `FOOTBALL_DST_PROP_SIM_CAP = 8`; **excludes** `player_sacks` |
| Core sacks | `MARKETS_BY_SPORT.nfl` | `player_sacks` in base batch (not DST batch) |
| Alt ladders | `ALT_MARKETS_*` | **No** D/ST or sack alt keys fetched |
| Yes/No ingest | `props.ts` ingest | `yes`→Over, `no`→Under — only if posted on a fetched key with a point |
| Board candidacy | `boardPropSimExpansion.ts` `isRealisticBoardPropCandidate` | Requires `isProp`, finite odds, **non-null `propLine`**, `propSide`, sim-supported market |
| Deep-sim cap | `boardPropSimExpansion.ts` | D/ST rows hard-capped at 8 per candidate set (scan-speed / budget) |
| Skill rank | `boardScanPropDelivery.ts` | Sacks rank **3**; D/ST four rank **1** / family `null` (fill after classic skill) |
| Recovery board | `coachFootballPropsOnlyRecovery.ts` | Includes `player_sacks`; **omits** the four DST keys |
| Ask locks | `explicitMarketLock.ts` | `fb_sacks` → `player_sacks`; `fb_pass_ints` → `player_pass_interceptions` only; **no** locks for tackles / kicking / defensive INTs |

---

## 1. Sacks

### 1a. Sack totals O/U — `player_sacks`

| Stage | Finding |
|-------|---------|
| Provider | Odds API `player_sacks` (NFL core allowlist) |
| Ingestion | Fetched in base props batch; merged into prop pool |
| Stat / history | `SACK` / `SACKS` (`propStatValue.ts` / `propStats.ts`) |
| Simulation | Discrete count market; MC via `gameValueForMarket`; fails `no_history` / `stat_mapping_failed` when ESPN log lacks sack samples |
| Grading | Ledger StatMuse path if log resolves “Sacks”; chat notes sack may be absent from history |
| Coach scan | **Enters** when posted with line+odds: seatable NFL, skill family `sack`, recovery-eligible, **not** DST-capped |
| Why qualify / fail | Qualify: sim grade + staging quality bar. Fail: missing history → no sim grade; NCAAF never fetched |
| **Status** | **supported** (NFL). NCAAF: **deliberately blocked** — not in `MARKETS_BY_SPORT.ncaaf`; seating `nonSeatableFamilies: sacks`; Opp Shift returns null for ncaaf sacks |

### 1b. “To record a sack” (Yes/No)

| Stage | Finding |
|-------|---------|
| Provider | **No** distinct key (`player_to_record_a_sack` etc.) anywhere in allowlists |
| Closest shape | O/U on `player_sacks` (often 0.5) |
| Ingest | Yes/No outcomes only fold if books post Yes/No **on** `player_sacks` |
| Board gate | Null-line Yes/No **fails** `isRealisticBoardPropCandidate` (requires `propLine`) |
| **Status** | **unavailable from provider** as a distinct market. Practical path = Over 0.5 sack totals |

**Other sports:** NBA/NHL/MLB/soccer — N/A (no sack markets).

---

## 2. Tackles

| Stage | Finding |
|-------|---------|
| Provider | Fetched: `player_solo_tackles` (DST batch). **Not** fetched: bare `player_tackles` (UI label exists in legacy ParlayBuilder only) |
| Ingestion | NFL `props-dst` batch only |
| Stat / history | `soloTackles` / `SOLO` |
| Simulation | Discrete; subject to DST sim cap 8 |
| Grading | “Solo Tackles” — not combo-blocked |
| Coach scan | Seatable NFL; skill rank 1 / family null; **no** ask-lock; **not** on recovery board |
| Why qualify / fail | Must clear posted line + sim + quality bar while competing at lowest skill priority and within 8-row DST cap |
| **Status** | **supported** as solo tackles (NFL). Bare total-tackles key: **unavailable from provider** (not requested). NCAAF: **unavailable** (DST NFL-only) |

---

## 3. Assists (defensive)

| Stage | Finding |
|-------|---------|
| Provider | **No** football defensive-assists-only Odds API key in any allowlist |
| Combo only | Assists appear only inside `player_tackles_assists` |
| NBA / NHL | `player_assists` is a **different family** (basketball/hockey AST) — supported there |
| Ask lock | `nba_assists` locks `player_assists` only; “assists” never locks football D/ST |
| Opp Shift risk | Fallback `/assists?/` can mis-tag `player_tackles_assists` as basketball assists; board ranking explicitly checks D/ST **before** assists |
| **Status** | Football defensive assists alone: **unavailable from provider**. NBA/NHL assists: **supported** (separate chain) |

---

## 4. Tackles + Assists — `player_tackles_assists`

| Stage | Finding |
|-------|---------|
| Provider | Odds API D/ST key; NFL DST batch |
| Ingestion | Isolated DST fetch; no `_alternate` in ALT allowlists (alt suffix would still count as DST if ever posted, but is **not fetched**) |
| Stat / history | `totalTackles` / `TOT` (combined tackle total — not separate assist column) |
| Simulation | Discrete; DST-capped |
| Grading | Label “Tackles + Assists” contains `+` → ledger **`ungraded` / “combo market”** (`grade.ts`) — settlement fail-closed |
| Coach scan | Seatable; rank 1; no ask-lock; not on recovery list |
| Why qualify / fail | Can MC-grade and stage if history maps; ticket ledger may still leave it ungraded after the game |
| **Status** | **supported** for ingest/sim/Coach candidacy (NFL); settlement ledger **missing reliable grade path** (combo block). NCAAF: not fetched |

---

## 5. Kicking points — `player_kicking_points`

| Stage | Finding |
|-------|---------|
| Provider | DST batch; distinct from extended-main `player_field_goals` |
| Ingestion | NFL DST only; no kicking-points alt key (FG has `player_field_goals_alternate`) |
| Stat / history | Prefer `kickingPoints` / `totalKickingPoints`; else exact FG×3+XP when both present |
| Simulation | Discrete; DST-capped |
| Grading | Not combo-blocked; StatMuse if “Kicking Points” resolves |
| Coach scan | Seatable; skill rank below FG (`skillPropRank`); DST cap applies |
| Why qualify / fail | Same as other DST: low priority + cap + history/sim gates |
| **Status** | **supported** (NFL). NCAAF: not in DST allowlist. Other sports: N/A |

---

## 6. Defensive interceptions — `player_defensive_interceptions`

| Stage | Finding |
|-------|---------|
| Provider | DST key — **distinct** from QB `player_pass_interceptions` (NFL+NCAAF core) |
| Labels | “Defensive INTs” vs “Pass INTs” |
| Stat / history | Both map ESPN `interceptions`; differentiated by **whose** game log (defender vs passer) |
| Ask lock | `fb_pass_ints` regex `interceptions?|ints?` → **pass** ints only — ask “interceptions” does **not** lock defensive INT |
| Simulation | Discrete; DST-capped |
| Grading | Not combo-blocked |
| Coach scan | Seatable; rank 1; no dedicated defensive-INT ask lock |
| Why qualify / fail | DST priority/cap; needs defensive log samples for sim |
| **Status** | **supported** (NFL defensive). QB pass-INT **supported** separately (core NFL+NCAAF). Cross-sport D/ST: N/A |

---

## 7. Team total specials (D/ST team totals)

| Stage | Finding |
|-------|---------|
| Provider keys wired | `team_totals` / `alternate_team_totals` / period variants — **team points** O/U, not team sacks/tackles/INT |
| Discovery | Humanized “Team Total”; sim model `teamTotal` |
| D/ST team props | No `team_sacks`, team tackles, or DST fantasy team keys in props or odds allowlists |
| Coach | Score team totals enter game-line scan paths; true D/ST team specials never ingested |
| **Status** | Score team totals: **supported**. True D/ST team specials: **unavailable from provider** / not wired |

---

## Cross-sport equivalents

| Sport | Market | Status |
|-------|--------|--------|
| **NCAAF** | Sacks / DST four | **Deliberately blocked / not fetched** — seating marks `sacks` non-seatable; DST map only when `includeSacks` (NFL) |
| **NBA / WNBA / NCAAB** | Assists | **supported** `player_assists` — not football defensive assists |
| **NHL** | Assists | **supported** `player_assists` → `A`; sacks/tackles/kicking N/A |
| **MLB** | — | No D/ST analogues |
| **Soccer** | Cards / tackles in defense feed only | Not player prop markets; cards non-seatable in Opp Shift |

---

## Coach eligibility — does it enter the scan?

| Market | Enters board scan? | Why |
|--------|--------------------|-----|
| `player_sacks` (NFL) | **Yes** | Core fetch + seatable + skill family; needs line/odds/sim grade |
| Sack Yes/No (null line) | **No** | Missing `propLine` → not a realistic board candidate |
| DST four (NFL) | **Conditionally** | Fetched + seatable, but ≤8 deep-sim, lowest skill rank, no recovery board, no ask-locks; fail if history unmapped → no sim grade |
| Same on NCAAF | **No** | Not in provider allowlists; sacks explicitly non-seatable |
| Team D/ST specials | **No** | Not posted/fetched; only score `team_totals` |

Allowlist membership alone is **not** enough: board candidacy still requires posted line + odds + sim support, then quality staging; DST additionally loses to skill props on rank and is hard-capped for scan budget.

---

## Deliberate design (preserve)

- Isolated DST Odds API batch so one bad key cannot 422 skill mains.
- `FOOTBALL_DST_PROP_SIM_CAP = 8` — protects Coach delivery budget / scan speed.
- D/ST skill rank below yards/TDs/sacks — quality mix preference, not an accidental omission.
- NCAAF sacks/DST omitted — seating + Opp Shift fail-closed.
- No gate weakening recommended in this audit turn.
