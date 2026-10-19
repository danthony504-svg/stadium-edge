# Coach football scoring-opportunity context

NFL and NCAAF now share an ID-bound completed-game ESPN play-by-play adapter. This supplies a bounded pre-simulation touchdown adjustment; it does not lift grades or confidence floors.

## Inputs actually used

- Opponent red-zone rushing/passing TD plays divided by matching rush/pass opportunities, compared with the offense's observed baseline. Both rates shrink toward their pooled observed baseline with 20 plays of prior weight.
- A player's red-zone rush/target mix selects the relevant defensive channels.
- Recent goal-line carry-share or rushing-share trends, and receiving target-share trends, relative to that player's own five-game baseline.
- Exact passer→receiver red-zone target counts are retained in diagnostics. They are not a claim about the upcoming starting QB or a charted pass into the end zone.
- Carries and targets inside the 10 and 5, quarterback red-zone rushes and explicitly described scrambles are collected. Not every collected field is an independent multiplier.

The adapter uses athlete/team IDs, not player-name matching. It excludes duplicate plays, no plays, penalties, kneels, spikes, conversions, returns and unsupported types. Complete pagination, at least 30 recognized scrimmage plays per game, three completed games per team, ten relevant red-zone opportunities per team and five relevant player opportunities are required. Unknown evidence leaves the old baseline intact. First-scorer and early-period markets remain unsupported here.

## Model integration

The adjustment is limited to 0.94–1.06. It changes the projection before the shared simulation draw. For anytime TD it remains inside the existing combined 0.90–1.10 cap. Fresh and cached context paths use the same signal. Snapshot/athlete/market fingerprints invalidate distribution reuse when evidence changes; alternate rungs and opposite sides continue to share one draw. Every ticket still needs existing exact-market provenance, positive edge/EV, 52% confidence and C+ grade.

## Speed and warming

The existing slate worker warms up to 12 football teams off the user request path. Requests read the in-memory summaries and may enqueue a background warm; they never await PBP downloads. Collectors coalesce by sport/team, run at concurrency two and queue at most 48 teams. Summaries expire after six hours; failures back off ten minutes and log baseline retention. Shared Redis is reused when configured; otherwise each API instance warms its own memory. No new scheduler or deployment secret is required. Mobile code and OTA are unchanged.

## Live verification

October 19, 2026: five complete games loaded for San Francisco (NFL), Washington (NFL) and LSU (NCAAF). Cold collection took approximately 7.4s, 3.7s and 6.7s respectively in one environment; those fetches run off the ticket path.

Example from that captured data: George Kittle had six RZ targets, all linked to QB ID 4361741, in five games. The matchup signal was 1.040. Christian McCaffrey had eight carries inside the five; his rush/receiving mix yielded 0.962 against the same opponent. These are evidence adjustments, not recommendations, probability-point additions or proven accuracy gains. A QB with too few relevant scoring opportunities received no signal.

## Limits

The source does not reliably chart whether the pass itself was targeted into the end zone. Red-zone TD plays per attempt are not red-zone drive conversion percentages. Designed runs and sneaks are not inferred from ordinary rushing text. QB→receiver counts do not automatically identify the next starter. Unknown/missing fields are never synthesized. This implementation applies football-specific semantics to NFL/NCAAF; other sports retain their existing models.

Validation: six new regression tests plus the 483-test release suite pass (489 total); an additional 29 cache/opportunity/wiring tests pass. API bundle builds. Full API typecheck remains blocked by existing repository diagnostics; it is not reported as passing. This is implemented evidence handling, not a backtested guarantee of improved prediction accuracy.
