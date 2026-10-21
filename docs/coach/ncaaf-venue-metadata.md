# 2024 venue metadata sidecar

Research only. No production imports, archive updates, predictions, or gate changes.

After deployment, from artifacts/api-server, export the original 2024 snapshots if /tmp was cleared:

```sh
umask 077
psql "$CFBD_HISTORY_DATABASE_URL" -v ON_ERROR_STOP=1 -At -c "SELECT payload FROM cfbd_history_archives WHERE season=2024 ORDER BY week;" > /tmp/cfbd-research-2024.jsonl
node dist/ncaafVenueMetadata.mjs /tmp/cfbd-research-2024.jsonl /tmp/cfbd-venue-2024.json
```

One bounded 20-second CFBD games request, no retries. CFBD_API_KEY stays in the environment. Output creation is exclusive (existing files are not overwritten), mode 0600. Retain this sidecar outside ephemeral /tmp before redeploying if needed; database source snapshots remain unchanged.

Match event, season, week, home/away IDs and kickoff. Missing or mismatched events are reported and excluded. Conflicting source events fail. Missing neutral-site status remains null; never infer home advantage from designated home identity or missing venue ID. Current provider metadata is retrospective, not proof it was available before kickoff. Raw response and input hashes identify the collection. Only 2024 archived games are matched; no 2025 evaluation or parameter selection.

Review coverage before building a venue model. Collection does not establish predictive improvement or probability calibration, ROI, or production readiness.
