# Coach readiness — 23 October 2026

## Regression repairs

- Direct-OpenAI prompts now omit unrelated analytical sections even below the size cap. Core request and provider-authority rules survive; the Replit prompt is unchanged.
- MLB rows with supplied athlete IDs and complete team-side context no longer fetch both rosters just to restamp that same context. Missing identity/side data still resolves through the existing providers. Other sports retain roster position enrichment, including correcting supplied stale NFL positions.
- The API team resolver accepts the same nullable provider names as the mobile resolver; the parity assertion remains in place.
- Thin tennis evidence remains below the existing 15% gate. Tests now cover both rejection of thin data and acceptance when the existing threshold is met. No eligibility threshold was lowered.
- The live WNBA diagnostic is explicit (`pnpm --dir artifacts/api-server test:live:wnba`) rather than an uncontrolled network dependency in every unit run. HTTP/protocol failures fail the probe; an empty board or absence of priced prop sides is reported as skipped/unavailable, never a certification of live coverage.

## NCAAF evidence audit

Production research status was inspected on this date. There are 28 archived 2023/2024 odds snapshots and four injury snapshots. No frozen forward forecasts or scored forward forecasts exist. The last processed pipeline report contains 403 completed 2026 history games, including 16 overtime games, and 31 matched upcoming events whose forecasts were withheld for insufficient candidate evidence.

These are research counts, not eligible holdout counts. The archive currently cannot establish a passing release holdout:

| Requirement | Evidence gap / next action |
| --- | --- |
| Candidate overtime sample | 16 of the existing 30 required qualifying games; collect or independently verify additional same-ruleset evidence without pooling incompatible seasons |
| Independent holdout | At least 500 settled independent games across two seasons; zero saved forward forecasts are currently available |
| Pregame inputs | Authenticate forecast, input cutoff, quote and injury timestamps before kickoff; retrieval today cannot recreate historical availability |
| Exact closing-line comparison | Weekly archived prices are not automatically verified closing quotes; bind exact book/market/line and both prices |
| Model quality | Score frozen probabilities with pushes excluded; demonstrate Brier performance no worse than the verified market baseline |
| Injuries and matchup effects | Keep absent injury teams unknown; verify conservative behavior and calibrate opponent/venue effects |
| Review and rollout | Independent source/ruleset review, explicit human signoff and staged rollout remain required |

Historical odds can support market/outcome research. They cannot supply missing historical candidate forecasts or injury observation times. The installed pipeline continues forward collection, but does not automatically declare the release eligible. The 52% / C+ floor and football early-period restrictions remain unchanged.

## Verification scope

The full API suite passed before publication (719 passing, zero failing, 12 skipped). The live WNBA probe was run separately: games existed, but no priced player-prop sides were returned in the scanned sample, so live prop qualification was unavailable. Full premium Coach speed still requires a real authenticated session; the earlier 3.18-second result measured only the public locked preview.

No OTA is included in these backend/test changes. Passing automated tests alone does not lift the NCAAF gate.

## Isolated unlock-path test

The production flag was replaced only in an in-memory test bundle; no runtime flag, app setting, or OTA was changed. The test found that the old mobile market-support classifier would permit NCAAF quarter/half sides after that flag was flipped. NCAAF period markets now remain unsupported independently of the full-game-side gate, including `cfb`/college-football aliases and provider underscore keys. Full-game and period totals remain blocked by their separate scoring-model gate.

The regression exercises both locked and test-only-open states. It checks the positive acceptance branch using explicitly synthetic 500-row/two-season fixtures and asserted verification options, then rejects undersized, single-season, unverified, postgame and worse-than-market variants. Synthetic fixtures prove control flow only; they are not independent validation data or a release approval.

Validation: 89 targeted NCAAF/mobile market-support tests pass; the full API suite passes 720 tests, with zero failures and 12 skipped. API typecheck and build pass. Production NCAAF eligibility remains false and no OTA is included.
