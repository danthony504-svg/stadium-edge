# E4 — Historical pregame injury / QB availability

**Rule:** missing injury records are **not** “no injuries.” `injuryKnown` stays `null` until a documented historical source fills it.

## Provider verification (docs only — no new key requested)

| Provider | Historical pregame injury/QB? | Documented coverage / access |
|----------|-------------------------------|------------------------------|
| **ESPN** public site/core APIs | **No** for holdout archive | Live `.../college-football/injuries` is current-season only (`?dates=` ignored). Core season/athlete injury URLs 404. Event summaries lack an `injuries` block. |
| **CollegeFootballData (CFBD)** | **No** | [Data availability](https://api.collegefootballdata.com/data-availability) (verified 2026-09-03) lists games, PPA, betting lines, weather, etc. — **no injury data family**. Do not request `CFBD_API_KEY` for E4. |
| **The Odds API** | **No** | Historical odds/scores only; no injury endpoints. |
| **SportsDataIO CFB** | **Yes (documented)** | [Historical Data Integration Guide](https://sportsdata.io/help/historical-data-integration-guide): *“Players Feeds > Injuries: Historical injury data lives inside box scores, as a snapshot of each player's status at game start.”* Mid-week practice designations are **not** retained. Live `InjuredPlayers` is **current-only**. |

### SportsDataIO — what to use

- **Endpoints:** Box Scores Final by date/week, e.g.  
  `GET https://api.sportsdata.io/v3/cfb/stats/json/BoxScoresFinal/{date}`  
  `GET https://api.sportsdata.io/v3/cfb/stats/json/BoxScoresByWeekFinal/{season}/{week}`  
  ([NCAA Football API docs](https://sportsdata.io/developers/api-documentation/ncaa-football))
- **Fields:** `PlayerGame.InjuryStatus` / `InjuryBodyPart` / `InjuryStartDate` / `InjuryNotes` — data dictionary marks injury fields **from 2018**.
- **Access:** Production API key with **Vault / prior-season** enabled for CFB stats (contact SportsDataIO if Vault is off). Replay is **not** a historical injury archive.
- **E4 derivation:** For each holdout game, read game-start `PlayerGame` rows; set `injuryKnown=true` when any injury status is present for that game’s players; set `qbOut=true` when a QB has status Out/Doubtful (define threshold in the join script). Games with **no box-score injury payload** stay `injuryKnown=null` (unknown), never `false` by omission.

## What not to do

- Do not set `injuryKnown=false` because ESPN/CFBD returned nothing.
- Do not request another API key until SportsDataIO Vault CFB box scores are confirmed as the chosen source (or a manually frozen licensed CSV is supplied).
- Do not flip `NCAAF_GAME_LINE_SIM_VALIDATED` on E4 alone.
