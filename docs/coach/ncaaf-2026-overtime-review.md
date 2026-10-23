# NCAAF overtime rules review: collection is not calibration

Reviewed the NCAA's official **2026 Football Rules and Interpretations**, Rule 3-1-3 (printed FR-52/53), and its 2026 change notice on October 23, 2026.

Sources:

- https://www.ncaa.org/championships/playing-rules/football-playing-rules/
- https://ncaaorg.s3.amazonaws.com/championships/sports/football/rules/PRMFB_RulesBook.pdf
- Rulebook SHA-256: `2a9e63b038b6efc70ad846487f33fdda175993c2229c911c3e06291ec74a9dd5`
- https://ncaaorg.s3.amazonaws.com/championships/sports/football/rules/2026PRMFB_2026RuleChanges.pdf

The 2026 system uses possession series beginning at the opponent's 25-yard line for the first two extra periods, subject to penalties. Touchdowns in the second extra period require a two-point attempt. From the third extra period, series become two-point tries from the three-yard line. The timeout allowance changes after the second extra period. The 2026 change notice does not list a change to Rule 3-1-3.

These rules do not establish that empirical score increments from different seasons are statistically interchangeable. They also do not validate the current research model, which resolves simulated regulation ties by sampling paired observed OT increments rather than simulating possession decisions. Do not pool seasons or flip compatibility flags simply to reach thirty observations.

The current-season collection uses an explicitly unverified season tag. Detailed summary period ordering, source scope, sample sufficiency, injury conservatism, opponent/venue effects and out-of-sample calibration still need review. More data is useful for forward research; it is not an independent multi-season pregame forecast holdout. The existing release gate remains closed. This review authorizes no model release and changes no gate.
