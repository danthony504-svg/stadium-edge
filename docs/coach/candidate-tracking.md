# Coach per-candidate diagnostics

Prepared implementation; not deployed or published through OTA.

Each shared mobile Coach build uses one request ID for aggregate reliability and
candidate events. The existing audit observer is decorated without changing its
quality, identity, simulation or seating decisions. Game-line simulation and
request-market observations join the existing prop observations. Staging reports
actual quality reason codes and recommendation/rare-count gates; terminal
seating reports its existing constraint reasons.

`POST /api/reliability/coach-candidates` validates bounded diagnostic chunks and
writes structured `[coach-candidates]` backend logs. Search Render logs by
`candidateTracking.requestId`, order by `chunkIndex`, and require all
`totalChunks` before treating a report as complete. These are client-reported
observations, not independently verified predictions or validated model results.
No Telegram/push, database migrations, provider refreshes, simulation reruns or
release-gate changes are included.

Rows identify a candidate's sport, event/athlete IDs, market, side/line/price and
book; game lines also carry a normalized selection and matchup label. Player
names, prompts, injury records, raw provider payloads and error messages are not
sent. Final dispositions distinguish selected, excluded, evaluated-but-not-
selected, incomplete evaluation, and never evaluated. Terminal status preserves
completed, timed-out, cancelled or error. Never infer a quality rejection from a
missing simulation or a candidate that was not evaluated.

Limits: 1,000 retained candidate rows, first plus latest seven transitions per row,
25 rows per chunk, 4-second per-upload timeout, no retries. Final selections have
retention priority. `omittedObservations` and per-row `omittedTransitions` expose
truncation. Rate-limited/network-failed uploads may contain only some chunks.
Reporting is scheduled after terminal build processing and never awaited by
Coach. Existing test/CI reporting gate prevents live diagnostic uploads.

Coverage is explicitly `observed_pipeline_candidates`, not every market available
from every bookmaker. A graded candidate omitted without an observed rejection
remains evaluated-not-selected; ranking or correlation causes are never guessed.
Some early-return helpers do not expose every intermediate gate. Diagnostic
coverage is not evidence that missing-prop recovery or speed issues are fixed.

Release requires the backend deployment plus the mobile bundle update. A
historical ticket cannot acquire per-candidate evidence retroactively.
