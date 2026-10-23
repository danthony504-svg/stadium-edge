# NCAAF evidence and release audit

## Findings

The October 23 production inventory contains 28 historical odds snapshots (14
from 2023 and 14 from 2024, totaling 1,989 event rows), eight forward-observed
injury snapshots, five live-input snapshots, and no forecast or settlement
records. Event rows are not independent games and are not saved forecasts.
All injury observations were collected on October 23, 2026 and report only
three teams. These observations cannot establish historical injury availability
for 2023/2024, and absent teams must remain unknown.

The latest 2026 history summary contains 408 unique games and 16 structurally
consistent overtime results. All 32 matched upcoming events have at least six
prior games per team. The existing repair compared 64 team schedules and filled
all 330 distinct completed events discovered in that scope. It does not prove
whole-league completeness.

A separate bounded read-only comparison fetched the ESPN core 2026 regular-season
group-80 team directory and all 148 returned team schedules. All 148 requests
passed team/season identity checks. They contained 517 distinct completed events
and 17 overtime candidates. One overtime candidate was absent from the production
summary: public ESPN event 401862694. Its detailed box score independently passed
the existing history normalizer: regulation 28–28, final 41–43, three extra periods.
This recovers one candidate, not fourteen. The directory is a provider population,
not independent certification of NCAA membership or complete source coverage.

Raw database archives and source-response dumps are deliberately excluded from
this repository. Counts above are a dated audit, not a permanently current status.

## Recovery

`scripts/ncaaf-recover-overtime.mjs` accepts at most 32 unique numeric event IDs.
Default execution is plan-only. Explicit execution refetches the detailed source,
requires a completed and internally consistent overtime result, records the actual
receipt time and original bytes/hash, and adds an immutable research summary.
It takes the existing history-repair advisory lock, uses a production database-name
guard, preserves first observations and rejects score conflicts. Source and summary
writes are atomic. It makes no paid odds request and changes no production gate.

```sh
node scripts/ncaaf-recover-overtime.mjs --season 2026 --events 401862694
# In the authorized Render service environment, after verifying the source:
node scripts/ncaaf-recover-overtime.mjs --season 2026 --events 401862694 --execute
```

After execution, read back the newest history summary and its referenced raw
capture. Confirm 409 unique games and 17 overtime results if no other writer has
added records. Re-running the same event must make no source request or new summary.
This is not a release or a calibration pass.

## Rules review

Primary references:

- NCAA 2026 rule book, Rule 3-1-3:
  https://ncaaorg.s3.amazonaws.com/championships/sports/football/rules/PRMFB_RulesBook.pdf
- Approved 2026 changes:
  https://ncaaorg.s3.amazonaws.com/championships/sports/football/rules/2026PRMFB_2026RuleChanges.pdf
- Approved 2025 overtime timeout change:
  https://www.ncaa.org/news/media-center-changes-to-injury-timeouts-approved-in-football/

The 2026 book requires two-point tries after second-overtime touchdowns and
alternating two-point plays beginning in the third period. Its third-and-later
timeout allocation reflects the 2025 change. The 2026 changes also affect targeting,
offensive pass interference, replay and fair-catch kicks. No blanket cross-season
distribution compatibility is established by these documents. Do not relabel
2023/2024 archives as compatible to reach an evidence threshold. A separately
versioned and reviewed transfer study is required before pooling seasons.

## Acceptance sequence and estimate

1. Recover and read back the missing current-season OT result.
2. Establish compatible additional OT evidence without backdating observations.
3. Save real pregame forecasts with original quotes, source references and a fixed
   model version. The 30-record OT minimum is only an input gate.
4. Match saved probabilities to source-confirmed final outcomes; exclude pushes.
5. Run independent acceptance with at least 500 settled games across two seasons,
   genuine pregame evidence and an independently verified market baseline. Record
   Brier scores, source/ruleset review, injury handling and sign-off.
6. Only after acceptance, wire the approved model into both API and mobile request
   paths and perform end-to-end Coach/device checks before promoting an OTA.

There is no evidence-backed release date. Recovering a single OT game cannot
unlock forecast recording, and the existing odds-only archives do not satisfy the
historical injury/prediction requirements. Scheduled collectors are not an
automatic release mechanism. A later date can be estimated only after either an
authentic qualifying historical dataset is secured or a prospective collection
plan has a measured eligible-game rate. Do not imply a same-day unlock or that
production integration will occur automatically after collection.
