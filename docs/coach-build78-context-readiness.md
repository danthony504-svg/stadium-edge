# Build 78 Coach context update — release preparation

Status: implemented and verified locally; not published or deployed. Base main: `5743970` (verified against origin/main). This is the first context batch, not completion of every proposed predictive feature.

## Included

- Idle mobile context preparation yields to foreground Coach builds and reuses existing requests/caches.
- The server prepares upcoming event summaries, provider-listed starter flags and game-time forecasts. The existing games response carries available prepared context; the app does not add another foreground request.
- Public game requests can queue preparation after sending their response. The queue is deduplicated, runs one sport at a time, and never runs ticket simulations. Individual provider requests time out after four seconds; each sport pass stops starting games after eight seconds.
- A separate authenticated `POST /api/prebuild/context` refreshes stored upcoming event references without fetching odds, prop boards or simulations. Full prebuild still discovers schedules and prepares source histories.
- Exact sport, event, kickoff and home/away IDs bind every snapshot. Two-minute source expiry is preserved through cache reads and JSON transport. Doubleheaders require a matching kickoff when looking up simulation context. Completed/live events cannot establish a pregame lineup. Conflicting starter flags cannot establish a complete lineup.
- Starter-dependent MLB batting and soccer props are excluded only when the provider supplies a complete lineup and explicitly lists that athlete as a reserve. The shared simulation runner and final mobile delivery both enforce this. Basketball reserves remain eligible; missing flags never become a claimed starting lineup. No minutes restrictions or depth-chart rankings are invented.
- Outdoor forecast collection covers MLB, NFL, NCAAF, soccer and tennis when a verified location is available. Tennis uses its actual tournament-city feed, not player nationality. Known stadium coordinates require the actual venue name to match. City-level forecasts are labelled as such; ambiguous city results stay unavailable.
- Forecast selection uses the slot nearest kickoff (within 90 minutes), preserving missing readings and the forecast fetch time. Five-minute forecast freshness is checked independently of the lineup snapshot. Venue/roof uncertainty suppresses application of outdoor weather; a retractable-roof registry flag is not treated as a live closed-roof confirmation.
- Football Under weather direction is reversed once. Baseball wind speed alone no longer creates a directional advantage. Soccer/tennis weather context is collected without invented probability weights; those sport/market models still need validation.
- Grounded workload and injury changes from the preceding commit remain included: roster positions, actual opportunity statistics, warm histories for absent players, and exclusion of players reported out. Existing home/away and opponent-matchup shifts remain intact. Quality floors, exact-market provenance, real odds and request deadlines remain in place.

## Validation

- Required release reliability script passes: six groups, 372 checks total (includes its filtered seven-test group).
- Additional selected API context/history/workload/distribution suites: 65 checks pass.
- Selected mobile context/weather/grounding/cache/quality/provenance suites: 45 checks pass.
- Cached context attachment measured p95 under 1 ms locally with zero provider calls on reads. The shared-cache read has a 40 ms foreground timeout. These are local checks, not a demonstrated full-device 15–30 second SLA.
- API production bundle and iOS Expo export succeed. No native dependencies, runtime version, bundle ID or build-number changes are included. Runtime remains 1.1.0, compatible with the existing Build 78 runtime; the existing source build-number value is not a request for a new native build.
- Project typechecks retain the same pre-existing 110 API / 290 mobile diagnostics, with no new diagnostics against the recorded base. Wider base failures documented in `coach-fast-context-test.md` remain unresolved; do not describe the entire repository as clean.

## Preview and release requirements

1. Push/open the review branch after GitHub upload authorization. The earlier push was blocked by automatic approval review; no workaround was used.
2. Deploy the backend changes to an isolated preview server. The current preview OTA configuration uses the production API, so an OTA alone will not activate this backend behavior.
3. Configure `OPENWEATHER_API_KEY`, `PREBUILD_CRON_KEY` (or existing fallback `NOTIFY_CRON_KEY`) and the shared cache for that server. Run the full prebuild on its existing schedule; run the lightweight context refresh every minute. The test runner supports `COACH_CONTEXT_ONLY=1` plus `COACH_TEST_API_URL` and `COACH_TEST_PREBUILD_KEY`; it rejects known production destinations.
4. Verify actual provider coverage on upcoming games. Unannounced lineups, missing venue/roof information and unvalidated weather effects stay unavailable. Advanced pitch-arsenal/coverage/pressure feeds, projected minutes/limits, rest/travel models, calibration and joint-ticket improvements from the larger proposal are not completed by this batch.
5. Run representative 2/4/8/15-leg requests on a real iPhone. Confirm completion within the 15–30 second target where the board permits, truthful quality shortfalls, foreground/background transitions and no delayed rendering.
6. Record successful Build 78-compatible TestFlight cold launches and confirm current release controls before the production OTA. No production publish, freeze bypass, main merge, new native build or device installation has been performed here.
