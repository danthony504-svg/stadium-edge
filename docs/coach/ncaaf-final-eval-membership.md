# FINAL_EVAL membership — reconciled to complete ESPN date schedule

**Generated:** 2026-10-17T13:11:13.742Z  
**Paid retrieval:** false · **FINAL_EVAL scored:** false · model performance **not** inspected  
**E1 frozen** · injuries inactive · NCAAF blocked · voice paused · spreads blocked

## Predefined date windows

| Window | Dates |
|--------|-------|
| FINAL_EVAL 2025 | 2025-10-15 … 2025-12-15 (kickoff ≥ 2025-10-15T00:00:00Z) |
| FINAL_EVAL 2026 | 2026-08-23 … 2026-10-17 (completed RS only) |

## Membership rules (structural — not outcome-tuned)

| Rule | Detail |
|------|--------|
| TUNING | kickoff &lt; 2025-10-15T00:00:00Z |
| FBS scope | verified FBS–FBS for inclusion |
| 2025 | in window; inclusion **not** based on final score |
| 2026 | completed required for membership only |

## Schedule reconcile (week-board → date walk)

| Item | n |
|------|--:|
| Dates probed | 118 |
| Schedule events | 938 |
| Prior week-board included | 132 |
| **Date-walk included** | **408** |
| Newly found vs prior | 276 |
| No longer included | 0 |
| Excluded (structural) | 530 |

### Exclusion counts

```json
{
  "fbs_fcs_or_non_fbs_unsupported_scope": 478,
  "2026_not_completed": 52
}
```

### Newly found (sample ≤25)

| eventId | kickoff | matchup |
|---------|---------|---------|
| 401757283 | 2025-10-15T23:00Z | Delaware Blue Hens @ Jacksonville State Gamecocks |
| 401757284 | 2025-10-15T23:00Z | UTEP Miners @ Sam Houston Bearkats |
| 401762486 | 2025-10-16T23:30Z | Tulsa Golden Hurricane @ East Carolina Pirates |
| 401760396 | 2025-10-18T01:00Z | San José State Spartans @ Utah State Aggies |
| 401754371 | 2025-10-18T02:30Z | North Carolina Tar Heels @ California Golden Bears |
| 401752873 | 2025-10-18T16:00Z | Washington Huskies @ Michigan Wolverines |
| 401754569 | 2025-10-18T16:00Z | UConn Huskies @ Boston College Eagles |
| 401756925 | 2025-10-18T16:00Z | Arizona Wildcats @ Houston Cougars |
| 401756927 | 2025-10-18T16:00Z | Baylor Bears @ TCU Horned Frogs |
| 401762488 | 2025-10-18T16:00Z | Army Black Knights @ Tulane Green Wave |
| 401762839 | 2025-10-18T16:00Z | Central Michigan Chippewas @ Bowling Green Falcons |
| 401762841 | 2025-10-18T16:00Z | Eastern Michigan Eagles @ Miami (OH) RedHawks |
| 401756928 | 2025-10-18T17:00Z | West Virginia Mountaineers @ UCF Knights |
| 401762842 | 2025-10-18T18:00Z | Kent State Golden Flashes @ Toledo Rockets |
| 401762840 | 2025-10-18T18:30Z | Buffalo Bulls @ Massachusetts Minutemen |
| 401752874 | 2025-10-18T19:00Z | Purdue Boilermakers @ Northwestern Wildcats |
| 401761633 | 2025-10-18T19:00Z | Troy Trojans @ UL Monroe Warhawks |
| 401754565 | 2025-10-18T19:30Z | SMU Mustangs @ Clemson Tigers |
| 401760392 | 2025-10-18T19:30Z | Wyoming Cowboys @ Air Force Falcons |
| 401760393 | 2025-10-18T19:30Z | UNLV Rebels @ Boise State Broncos |
| 401761629 | 2025-10-18T19:30Z | Coastal Carolina Chanticleers @ App State Mountaineers |
| 401761631 | 2025-10-18T19:30Z | Old Dominion Monarchs @ James Madison Dukes |
| 401761632 | 2025-10-18T19:30Z | Texas State Bobcats @ Marshall Thundering Herd |
| 401762489 | 2025-10-18T19:30Z | Temple Owls @ Charlotte 49ers |
| 401762838 | 2025-10-18T19:30Z | Akron Zips @ Ball State Cardinals |

### Documented missing / dropped vs prior week membership

- none

**Note:** Membership refreshed to the date-complete schedule using structural rules only. No M1–M4 / Brier / CLV numbers consulted.

## Causal state

Seed 2024 → chronological TUNING updates → FINAL_EVAL predict with pre-kickoff state only; sealedOutcome for carry-forward after predict; α=1.15 frozen; no selection on FINAL_EVAL outcomes · Scoring: **NOT RUN**
