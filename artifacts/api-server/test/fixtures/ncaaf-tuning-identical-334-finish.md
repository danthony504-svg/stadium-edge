# TUNING finish: identical 334-game cohort (no further tuning)

**Stamp unchanged:** `ncaaf-team-strength-v0-research` · drive locked · FINAL_EVAL untouched · gate false · no paid Odds · no deploy/OTA · no new model  

**Restoration close-out:** [`ncaaf-restoration-attempt-closed-334.md`](./ncaaf-restoration-attempt-closed-334.md) · **Next inputs (proposal only):** [`ncaaf-team-strength-next-inputs-proposal.md`](./ncaaf-team-strength-next-inputs-proposal.md)

Classification fix **preserved**. FBS–FCS = **unsupported scope** (Coach withhold) — not a validation pass.

## 1. Identical cohort (n=334) — all models, ML + ATS

Same event IDs for every model (games where verified team-strength produced a rated prediction).

### `identical_334` (n=334)

| Model | scored | ML Brier | Δ vs mkt | M3 | ATS n | ATS Brier | S2 | margin bias |
|-------|-------:|---------:|---------:|:--:|------:|----------:|:--:|------------:|
| `locked_drive_teamMean` | 334 | 0.2267 | 0.0500 | false | 326 | 0.2734 | false | 0.9 |
| `ts_full_before_legacyHeuristic` | 334 | 0.1955 | 0.0189 | true | 326 | 0.2549 | false | -2.6 |
| `ts_full_after_verifiedIds` | 334 | 0.2002 | 0.0235 | false | 326 | 0.2571 | false | -2.5 |

### `identical_334` × Week 1 (n=47)

| Model | scored | ML Brier | Δ vs mkt | M3 | ATS n | ATS Brier | S2 | margin bias |
|-------|-------:|---------:|---------:|:--:|------:|----------:|:--:|------------:|
| `locked_drive_teamMean` | 47 | 0.2326 | 0.0955 | false | 47 | 0.2523 | false | -2.6 |
| `ts_full_before_legacyHeuristic` | 47 | 0.2082 | 0.0711 | false | 47 | 0.2400 | true | -3.5 |
| `ts_full_after_verifiedIds` | 47 | 0.2089 | 0.0718 | false | 47 | 0.2412 | true | -3.3 |

### `identical_334` × 14+ favorites (n=94)

| Model | scored | ML Brier | Δ vs mkt | M3 | ATS n | ATS Brier | S2 | margin bias |
|-------|-------:|---------:|---------:|:--:|------:|----------:|:--:|------------:|
| `locked_drive_teamMean` | 94 | 0.1688 | 0.0947 | false | 94 | 0.2921 | false | -6.9 |
| `ts_full_before_legacyHeuristic` | 94 | 0.1270 | 0.0529 | false | 94 | 0.2650 | false | -6.6 |
| `ts_full_after_verifiedIds` | 94 | 0.1322 | 0.0581 | false | 94 | 0.2636 | false | -6.6 |

## 2. Exclusions (87) by reason

| Reason | n | Coach action | Notes |
|--------|--:|:------------:|-------|
| `fbs_fcs_unsupported_scope` | 85 | **withhold** | Unsupported scope — not a model miss |
| `unrated_fbs_side` | 2 | **withhold** | FBS–FBS but no rating yet (e.g. transition / pre-first FBS–FBS) |

Total exclusions: **87** (fair cohort 421 − identical 334).

### Exclusion inventory

| eventId | week | matchup | subs | reason |
|--------|-----:|---------|------|--------|
| 401760371 | 1 | UNLV Rebels vs Idaho State Bengals | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762790 | 1 | Bowling Green Falcons vs Lafayette Leopards | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761588 | 1 | UL Monroe Warhawks vs Saint Francis Red Flash | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752674 | 1 | Missouri Tigers vs Central Arkansas Bears | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754517 | 1 | Duke Blue Devils vs Elon Phoenix | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756876 | 1 | Oklahoma State Cowboys vs UT Martin Skyhawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756852 | 1 | Houston Cougars vs Stephen F. Austin Lumberjacks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760357 | 1 | San Diego State Aztecs vs Stony Brook Seawolves | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762432 | 1 | Army Black Knights vs Tarleton State Texans | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401766898 | 1 | Florida International Panthers vs Bethune-Cookman Wildcats | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754520 | 1 | Pittsburgh Panthers vs Duquesne Dukes | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762792 | 1 | Kent State Golden Flashes vs Merrimack Warriors | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754518 | 1 | Boston College Eagles vs Fordham Rams | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756878 | 1 | West Virginia Mountaineers vs Robert Morris Colonials | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757167 | 1 | UConn Huskies vs Central Connecticut Blue Devils | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754519 | 1 | Louisville Cardinals vs Eastern Kentucky Colonels | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756853 | 1 | Iowa State Cyclones vs South Dakota Coyotes | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760359 | 1 | Air Force Falcons vs Bucknell Bison | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762793 | 1 | Northern Illinois Huskies vs Holy Cross Crusaders | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752804 | 1 | Oregon Ducks vs Montana State Bobcats | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757220 | 1 | Liberty Flames vs Maine Black Bears | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762433 | 1 | Memphis Tigers vs Chattanooga Mocs | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752675 | 1 | Oklahoma Sooners vs Illinois State Redbirds | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761590 | 1 | James Madison Dukes vs Weber State Wildcats | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752668 | 1 | Florida Gators vs Long Island University Sharks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756855 | 1 | Kansas State Wildcats vs North Dakota Fighting Hawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757222 | 1 | Middle Tennessee Blue Raiders vs Austin Peay Governors | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757226 | 1 | Western Kentucky Hilltoppers vs North Alabama Lions | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761591 | 1 | Arkansas State Red Wolves vs Southeast Missouri State Redhawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761593 | 1 | South Alabama Jaguars vs Morgan State Bears | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761595 | 1 | Troy Trojans vs Nicholls Colonels | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752798 | 1 | USC Trojans vs Missouri State Bears | fbs/fbs | `unrated_fbs_side` |
| 401756877 | 1 | Texas Tech Red Raiders vs Arkansas-Pine Bluff Golden Lions | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757221 | 1 | Louisiana Tech Bulldogs vs SE Louisiana Lions | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762435 | 1 | North Texas Mean Green vs Lamar Cardinals | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762457 | 1 | Tulsa Golden Hurricane vs Abilene Christian Wildcats | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757223 | 1 | New Mexico State Aggies vs Bryant Bulldogs | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752947 | 1 | Washington State Cougars vs Idaho Vandals | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756850 | 1 | Arizona State Sun Devils vs Northern Arizona Lumberjacks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752817 | 2 | Northwestern Wildcats vs Western Illinois Leathernecks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760363 | 2 | Boise State Broncos vs Eastern Washington Eagles | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762462 | 2 | Temple Owls vs Howard Bison | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760366 | 2 | New Mexico Lobos vs Idaho State Bengals | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752692 | 2 | Tennessee Volunteers vs East Tennessee State Buccaneers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752815 | 2 | Ohio State Buckeyes vs Grambling Tigers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756881 | 2 | Colorado Buffaloes vs Delaware Blue Hens | fbs/fbs | `unrated_fbs_side` |
| 401761596 | 2 | App State Mountaineers vs Lindenwood Lions | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760367 | 2 | Wyoming Cowboys vs Northern Iowa Panthers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754620 | 2 | Wake Forest Demon Deacons vs Western Carolina Catamounts | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760365 | 2 | Nevada Wolf Pack vs Sacramento State Hornets | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761602 | 2 | Southern Miss Golden Eagles vs Jackson State Tigers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762816 | 2 | Massachusetts Minutemen vs Bryant Bulldogs | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761599 | 2 | Old Dominion Monarchs vs North Carolina Central Eagles | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762459 | 2 | East Carolina Pirates vs Campbell Fighting Camels | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762460 | 2 | Florida Atlantic Owls vs Florida A&M Rattlers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762795 | 2 | Eastern Michigan Eagles vs Long Island University Sharks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752819 | 2 | Purdue Boilermakers vs Southern Illinois Salukis | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761597 | 2 | Coastal Carolina Chanticleers vs Charleston Southern Buccaneers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761600 | 2 | Louisiana Ragin' Cajuns vs McNeese Cowboys | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757231 | 2 | UTEP Miners vs UT Martin Skyhawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401756879 | 2 | Arizona Wildcats vs Weber State Wildcats | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752821 | 2 | Washington Huskies vs UC Davis Aggies | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752838 | 3 | Maryland Terrapins vs Towson Tigers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754619 | 3 | Virginia Cavaliers vs William & Mary Tribe | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762818 | 3 | Ball State Cardinals vs New Hampshire Wildcats | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752833 | 3 | Rutgers Scarlet Knights vs Norfolk State Spartans | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752834 | 3 | Michigan State Spartans vs Youngstown State Penguins | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401754639 | 3 | North Carolina Tar Heels vs Richmond Spiders | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762467 | 3 | UTSA Roadrunners vs Incarnate Word Cardinals | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762819 | 3 | Toledo Rockets vs Morgan State Bears | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401752701 | 3 | Mississippi State Bulldogs vs Alcorn State Braves | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757235 | 3 | Kennesaw State Owls vs Merrimack Warriors | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761606 | 3 | Marshall Thundering Herd vs Eastern Kentucky Colonels | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762464 | 3 | Charlotte 49ers vs Monmouth Hawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761605 | 3 | Georgia State Panthers vs Murray State Racers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762466 | 3 | Rice Owls vs Prairie View A&M Panthers | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762470 | 4 | South Florida Bulls vs South Carolina State Bulldogs | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762822 | 4 | Central Michigan Chippewas vs Wagner Seahawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762823 | 4 | Ohio Bobcats vs Gardner-Webb Runnin' Bulldogs | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760375 | 4 | San José State Spartans vs Idaho Vandals | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762821 | 4 | Akron Zips vs Duquesne Dukes | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401757265 | 4 | Missouri State Bears vs UT Martin Skyhawks | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761609 | 4 | Georgia Southern Eagles vs Maine Black Bears | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401760377 | 4 | Utah State Aggies vs McNeese Cowboys | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401761612 | 4 | Texas State Bobcats vs Nicholls Colonels | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762827 | 5 | Miami (OH) RedHawks vs Lindenwood Lions | fbs/fcs | `fbs_fcs_unsupported_scope` |
| 401762828 | 5 | Western Michigan Broncos vs Rhode Island Rams | fbs/fcs | `fbs_fcs_unsupported_scope` |

## 3. Coach withhold confirmation

- Research helper: `ncaafTeamStrengthMatchupSupport` → `coachAction: "withhold"` for FBS–FCS, unknown, and unrated FBS sides.
- Message helper: `ncaafTeamStrengthWithholdMessage` (explicit unsupported-scope copy).
- **Not live-wired** (NCAAF remains blocked / gate false). Policy is encoded so Coach withholds the same cases once/if research path is considered.
- Example FBS–FCS copy: “College team-strength does not support FBS–FCS matchups — withholding that leg (unsupported scope, not a model miss).”

## 4. Readiness (by market × supported scope)

| Scope | Market | Model | Metric | Pass? | Ready? |
|-------|--------|-------|--------|:-----:|:------:|
| supported FBS–FBS (identical 334) | ML | drive | Δ=0.0500 M3=false | false | **no** |
| supported FBS–FBS (identical 334) | ML | ts_after | Δ=0.0235 M3=false | false | **no** |
| supported FBS–FBS (identical 334) | ATS | drive | Brier=0.2734 S2=false | false | **no** |
| supported FBS–FBS (identical 334) | ATS | ts_after | Brier=0.2571 S2=false | false | **no** |
| **unsupported FBS–FCS** | ML/ATS | team-strength | n=85, scored=0 | n/a | **withhold** (not a pass/fail) |

Legacy `ts_before` on identical 334 is reported above for comparison only — polluted classification; **not** an acceptance path.

## 5. Context slices (not the identical-334 primary table)

- `all_fair` n=421 · drive ML Δ=0.0520 · ts_after scored=334/excl=87
- `fbs_fbs` n=336 · drive ML Δ=0.0502 · ts_after scored=334/excl=2
- `fbs_fcs` n=85 · drive ML Δ=0.0591 · ts_after scored=0/excl=85
- `week1` n=86 · drive ML Δ=0.0816 · ts_after scored=47/excl=39
- `large_14plus` n=167 · drive ML Δ=0.0773 · ts_after scored=94/excl=73

## Conclusion

- Comparison finished **without further tuning**.
- Classification fix + regressions preserved.
- Gate flip: **false**. FINAL_EVAL: **UNTOUCHED**. NCAAF blocked. No paid Odds / deploy / OTA.

## Repro
```bash
cd artifacts/api-server
NCAAF_TUNING_SIMS=1000 NCAAF_TEAM_STRENGTH_RESEARCH=1 node --import ./test/register-hooks.mjs ./scripts/ncaafTuningSubdivisionFixCompare.ts
```