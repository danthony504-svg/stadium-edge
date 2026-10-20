# Coach play-calling study

Initial implementation: observational, shadow mode only. No grade, confidence,
probability, EV, selection threshold or quote changes. These are team opportunity
profiles, not a causal attribution to an identified head coach or coordinator.

## Implemented

- NFL/NCAAF: reuse ID-bound completed-game play-by-play. Count classified rushes
  and pass attempts across the field and on first/second down, separately from
  the existing red-zone touchdown opportunity counts. Sacks are not included in
  the pass-attempt denominator. Kneels, spikes, penalties and no-plays stay excluded.
- NBA/WNBA/NCAAB: completed team box scores, minutes per observed appearance,
  field-goal-attempt share and three-point-attempt share. These do not claim
  possession usage, touches, rotations, pick-and-roll or isolation charting.
- Three distinct completed games minimum, latest five, 180-day maximum age.
  Reject partial team minutes, missing stat columns, duplicate athletes and
  mismatched event/team identities. Missing data is unavailable, never zero.
- Compact shared snapshots expire after six hours. Per-profile source event IDs,
  sport/team/player IDs, fingerprint, observation time and missing capabilities
  remain attached. Existing football snapshots without the new call counts
  remain usable for baseline TD logic but not the new study until refreshed.
- Worker collection: opt in with COACH_TENDENCY_STUDY_ENABLED=1. Unique slate
  teams, maximum 12 per job and two teams concurrently; each provider call has
  a six-second timeout. No collector is called by the study GET endpoint.
- Prepared game context includes cache-only home/away study profiles when
  available. Cache reads have a 40ms ceiling and fail open to absent context.
- GET /api/sports/coaching-study?sport=nba&teamId=2 returns shadow_ready or
  unavailable and explicitly reports affectsPickGrades:false.

## Activation and validation still required

Deploy API and worker code together to the test environment. Enable only the
study flag there, run the existing slate worker, inspect profile coverage and
verify request/provider counts. A client OTA alone cannot activate collection.
No production configuration, native build or OTA is changed by this PR.

Before ranking changes, archive dated profiles and baseline predictions, join
only games completed before the prediction timestamp, and compare untouched
baseline with tendency candidates on held-out chronological games. Evaluate
Brier score, log loss and calibration by sport/market/odds range; include data
coverage, sample uncertainty, latency and correlation. A current descriptive
snapshot alone is not a backtest and proves no improvement in accuracy.

Further inputs: identified coach/coordinator tenure, neutral score/down/distance
football tendencies, personnel/formations, routes, pressure/coverage, basketball
play-type tracking and substitution stints. Provider entitlement and identity
mapping must be verified before ingest. Coach changes require tenure boundaries;
never combine coaching staffs and label the result a coach-specific tendency.

Reference definitions: https://www.nba.com/stats/help/glossary and
https://nflreadr.nflverse.com/articles/dictionary_pbp.html . NBA Synergy play-type
categories are separate from box-score opportunity measures.
