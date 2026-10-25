# NCAAF owned research archive

Use existing production Postgres app_kv research namespaces as the authoritative archive. Do not copy records into an unconnected database or relabel old forecasts.

The public read-only `/api/research/ncaaf/ledger` report inventories prospective forecast metadata by frozen model and season. Its counts are NOT authenticated acceptance counts. The frozen registry is verified before cohort grouping; development/protocol-excluded games, old model versions and post-kickoff writes are excluded. Repeated market/bookmaker rows count once per game. Settlement links are explicitly not outcome verification. A 10,000-row inspection cap is reported, never hidden. No athlete records or raw source responses are returned.

Existing collectors preserve odds, availability, participation, opponent/venue history, source hashes and database-clock pregame timestamps. Existing final attachment and adjusted journal workers remain authoritative. The first frozen model and old forecasts must remain unchanged.

Next work: collect complete future holdout contexts; authenticate exact market/line/probability and source records; bind verified finals and push handling; evaluate probability calibration and market baseline on a separate holdout. Authentic prior-season pregame evidence must be obtained or accumulated prospectively. Historical scores alone do not satisfy the two-season requirement.

Acceptance remains 500 independent qualifying games across two seasons plus injury/usage, opponent/venue, overtime and release review. This report cannot enable Coach, approve a model or change quality floors. It adds no work to Coach requests. No database migration is necessary for this reporting phase; deploy the backend only after review/checks.
