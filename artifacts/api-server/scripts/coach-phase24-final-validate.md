# Phase 2.4 final validation

## 5× warm 5-leg

| run | Coach wall | max loop delay | propSim | dist CPU | qualified | final |
|-----|------------|----------------|---------|----------|-----------|-------|
| warm5-1 | 14840 | 4628 | 678 | 0 | 118 | 5 |
| warm5-2 | 15183 | 4595 | 571 | 0 | 118 | 5 |
| warm5-3 | 14915 | 4571 | 828 | 0 | 118 | 5 |
| warm5-4 | 14975 | 4545 | 600 | 7 | 118 | 5 |
| warm5-5 | 16175 | 4570 | 1564 | 8 | 121 | 5 |

### Aggregates (min / median / mean / P95 / max)

- Coach wall: {"n":5,"min":14840,"median":14975,"mean":15218,"p95":16175,"max":16175}
- max loop delay: {"n":5,"min":4545,"median":4571,"mean":4582,"p95":4628,"max":4628}
- propSim: {"n":5,"min":571,"median":678,"mean":848,"p95":1564,"max":1564}
- dist CPU: {"n":5,"min":0,"median":0,"mean":3,"p95":8,"max":8}

## NFL 7→6 funnel

```
requested=7
available={"propPoolSize":916,"oddsGameCount":1,"gameEntryCount":1}
simulated={"gameSimsLoaded":1,"gameLegsScored":808,"propSimEvaluated":35,"propLegsScored":7}
qualified={"scoredBeforeStage":23}
correlation/diversity=staging_correlation_diversity_or_per_game_cap
staged/final=6
seventhQualifiedExisted=true
```

Board produced enough qualified candidates (scoredBeforeStage ≥ 7) but staging could only place 6 without violating per-game / correlation / prop-mix / diversity caps. A legitimate 7th qualified candidate existed in the pool but was excluded by staging policy — not by empty board or lowered thresholds.
