# Forward-observed NCAAF result history

Run `node scripts/ncaaf-capture-history.mjs` for a plan without network/database calls. In the existing Render API shell, add `--execute` to capture the current season, or `--season YYYY --execute` to select an earlier season. The collector uses the existing DATABASE_URL only; no Odds API credential or paid odds requests are involved.

The bounded plan covers August 1 through today (or December 31 for an older season), at most 153 sequential ESPN date requests, with a 15-second timeout and no retries. A database-name check, advisory lock and same-day cache prevent concurrent duplicate imports. Successful daily raw captures survive a later request failure. Re-running the same day resumes cached dates. Re-run on another day to observe subsequent finals or corrections; old evidence is preserved.

Daily keys are `research:ncaaf:history-day:<season>:<requested-date>:captured:<capture-date>`. A successful full batch also writes `research:ncaaf:history-summary:<season>:<capture-minute>`. Original responses, request/receipt timestamps and SHA-256 hashes are retained. Summary games carry their source response hash; raw rows are revalidated before summary assembly. Repeated identical outcomes deduplicate using the earliest real observation. Conflicting scores/identities stop summary creation, rather than selecting a convenient result.

Only unique, completed non-tied games with numeric team/event identities, consistent period numbers and full quarter/OT sums become normalized rows. Regulation scores are sums of quarters 1–4. Overtime rows require a tied regulation score and non-tied full-game result. Live/incomplete/contradictory results are excluded; nothing is inferred from a missing linescore.

## Time semantics

ESPN's captured scoreboard does not provide a verified final-whistle timestamp. Each row therefore declares `completionTimeKind: observed_complete_upper_bound`, `actualCompletedAt: null` and `completedAt: receivedAt`. The completedAt value is an upper bound: the source had already declared the game complete when received. It is not an asserted actual completion time. `observedAt` is also the full-response receipt time. It can support inputs for a later forecast, never a forecast earlier than this capture. Do not backdate observedAt to kickoff or a guessed game duration.

## Limits and downstream use

Coverage is `reported_events_only_unverified`, not a claim of every FBS game; an ESPN response can omit events. Season tags are `ncaa-football-season-YYYY-unverified`, with rulesetCompatibilityVerified false. Do not relabel seasons as compatible merely to reach the overtime sample floor. Neither the collector nor its summary certifies historical availability, ruleset compatibility, candidate calibration or NCAAF release.

The summary's `games` array is shaped for the existing research forecast input. It still requires independent provenance/ruleset review and sufficient per-team/OT evidence. A new observation of old results is available now, not retroactively in that old season. Current quotes must be refreshed if the original capture has expired. This script does not generate forecasts, enable a cron, change Coach, publish OTA, or unlock NCAAF.
