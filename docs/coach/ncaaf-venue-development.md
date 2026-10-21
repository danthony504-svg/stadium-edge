# 2024 venue development experiment

Offline expected-score research only. No Coach registration or readiness changes.

Fit earlier-known non-OT 2024 scores as league mean + team offense + opponent defense + venue coefficient. Venue feature is +0.5 for home and -0.5 for away, or zero for both at a neutral site; coefficient therefore expresses a margin effect. Fit jointly with team effects using fixed ridge=4, venue ridge=4 and 100 deterministic sweeps. These settings are experimental, not tuned or validated. No hand-picked fixed home advantage.

Both models train only on games with known neutral status and kickoff +24h strictly earlier than target kickoff. The lag is an unverified completion proxy. Require three earlier qualifying games per target team. Missing metadata excludes games from both arms; unknown neutral flags never imply home. Input metadata must match 2024 event, teams and kickoff; duplicate entries fail. Target scores never enter training. Out-of-range score means are rejected rather than clipped. Both arms use identical evaluation games; each bookmaker/metric comparison pairs available lines independently.

After deployment, export archived input and the saved metadata (query requires exactly one stored metadata report; do not silently choose among later collections):

```sh
umask 077
psql "$CFBD_HISTORY_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "SELECT payload FROM cfbd_history_archives WHERE season=2024 ORDER BY week;" > /tmp/cfbd-research-2024.jsonl
psql "$CFBD_HISTORY_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "SELECT (SELECT payload FROM cfbd_venue_metadata_archives);" > /tmp/cfbd-venue-2024.json
node dist/ncaafVenueDevelopment.mjs /tmp/cfbd-research-2024.jsonl /tmp/cfbd-venue-2024.json
```

Reports paired counts, exclusions, expected total/margin MAE and stored bookmaker reference for opponentOnly and opponentWithVenue. No probability, simulations or ROI claim. Retrospective metadata and score revision availability are unverified; odds are not verified pregame/closing. Non-OT selection bias persists; no injuries included. No 2025 fitting or evaluation. Earlier 2025 baseline inspection means future independent shadow evaluation is needed even after development improvements. No acceptance threshold or production unlock is implied.
