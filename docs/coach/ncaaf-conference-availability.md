# Official conference availability research

The existing opt-in NCAAF research pipeline captures public Big Ten, Big 12, ACC and SEC football availability reports after its current-odds collection. Each collection slot can attempt at most eight public requests: one current-report and one archive request per conference. These calls use no Odds API credits or new credentials. A durable attempt claim prevents retries in the same slot; failures are recorded without blocking existing forecasts or settlement checks. The existing advisory lock, child-process deadlines and research scheduler remain in force.

`node scripts/ncaaf-conference-availability.mjs` is plan-only. Explicit `--execute` captures data; `--capture-slot <ISO timestamp>` shares the pipeline's attempt budget. Existing production database identity is checked. Raw responses are compressed losslessly with SHA256, request-start and full-receipt timestamps. Conference capture and binding keys are separate from the ESPN injury archive and immutable forecast journal. Nothing rewrites saved predictions or backdates evidence.

## Exact event binding

Current published reports identify a pair of teams but do not themselves expose an ESPN ID or kickoff. Their conference archive supplies source event-day labels. A binding requires reciprocal team/opponent archive rows, one source date within seven days after publication, and one pregame ESPN event with the same two teams and that date in America/New_York (the existing scoreboard date convention). Report names must exactly normalize to source team names/display names and ESPN identity aliases. No fuzzy matching is used. ESPN home/away IDs, kickoff and the raw scoreboard hash must match the existing live-input target. Ambiguous dates, duplicate events, missing teams, invalid source hashes, future publications/receipts, started games and stale captures are excluded.

Source wall-clock publication times use their declared CT/ET/MT/PT zone with date-specific daylight saving offsets. Receipt time remains the evidence availability boundary, regardless of the source's earlier publication label. Exempt and unrecognized statuses remain unknown; missing players or teams do not become available/healthy.

## Remaining limitations

Bindings are research sidecars, not injury adjustments or a release approval. They are not injected into the v2 forecast model, and do not change its version or historical evidence. Conference coverage is partial and report counts are not independent validation games. The provider has no demonstrated blanket coverage of all NCAAF teams. Prior-season forecasts, holdout/calibration requirements and human release review remain outstanding. New evidence collected after an original forecast cannot retroactively qualify that forecast.

## Sources

- SEC: https://www.secsports.com/fbreports
- Big Ten: https://bigten.org/fb/availability-reports/
- Big 12: https://big12sports.com/sports/2025/8/14/FBreporting.aspx
- ACC: https://theacc.com/sports/2025/8/28/availability-reporting-football.aspx

Each official page embeds the public HD Intelligence report application. Only its observed public report/archive routes are used; no authenticated/staff endpoints or credentials are accessed. Raw reports stay in research storage and must not be committed to GitHub.
