# Coach ticket assembly and follow-up recovery

Observed Oct 21, 2026: the 83.9s run had a last logged simulation response at 21:44:11Z and fulfillment at 21:45:05Z; the 201.7s run had a last logged simulation response at 21:45:58Z and fulfillment at 21:49:04Z. These gaps identify a period needing client investigation; server logs alone do not prove the device spent the entire gap assembling tickets.

A synthetic 9-leg assembly benchmark with recent-ticket memory reproduced avoidable CPU cost. Previously each recent-leg tie comparison rescanned the full candidate pool, rechecking eligibility and recomputing fingerprints. Compute the best edge per player once per seating step, retaining the top two player groups so excluding the current player gives the same best alternative. Build this lookup lazily and discard it when the seating step changes. Keep all candidate tickets, correlation constraints and qualification gates.

On this development host, identical 200-candidate inputs selected identical ordered picks: 3125ms before, 817ms after. Identical 600-candidate inputs selected identical ordered picks: 6696ms before, 2663ms after. Synthetic CPU measurements are not end-to-end phone timings or a guarantee of 15–30s delivery.

Follow-ups containing new/again/another/no/exclude preserve the most recent explicit league and props intent. Current explicit league and market changes win; mixed-sport resets and unrelated topics stop inheritance. City abbreviations in exclusions (including ATL) use the named league and exclude its complete matchup before prop fetching and again at delivery. Ambiguous city exclusions never establish a league; city labels match full city tokens rather than abbreviation substrings (CHI must not match Michigan). Existing thresholds and provenance requirements remain unchanged.

An all-new request with no fresh candidates now returns an honest shortfall rather than replaying the stale pool. Existing combination fixtures now carry the exact-market simulation provenance required by production. The original fixtures had three failures on both old and new assembly code; adding valid fixture evidence makes the original six behavior tests pass in both implementations.

Validation: 83 focused tests pass covering assembly, follow-up scope, team and sport constraints, correlation, quality, provenance and builder integration; mobile TypeScript check passes against the main-based builder integration.

Release via the established reviewed OTA workflow after GitHub checks. A Render deploy alone cannot deliver these mobile TypeScript changes. Phone acceptance: repeat the screenshot sequence (NBA all-new props, NBA no ATL, then new no ATL); inspect 15–30s target, complete league/exclusion adherence, genuine 10k provenance, no repeats on all-new, and truthful shortfalls. The remaining actual-device delay and event identity rejection remain unproven until retest. NCAAF game-pick validation stays locked.
