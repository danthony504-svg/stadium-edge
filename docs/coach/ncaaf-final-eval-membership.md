# FINAL_EVAL membership (Phase B) — free ESPN, unscored

**Generated:** 2026-10-17T12:17:20.694Z  
**Paid retrieval:** false · **FINAL_EVAL scored:** false  
**Spreads:** blocked · voice paused · gate false

## Membership rules (locked before scoring)

| Split | Rule |
|-------|------|
| TUNING | kickoff &lt; 2025-10-15T00:00:00Z |
| FINAL_EVAL 2025 | season=2025 ∧ kickoff ≥ 2025-10-15T00:00:00Z |
| FINAL_EVAL 2026 | season=2026 RS ∧ completed |
| Scope | Verified FBS–FBS only for later ML scoring |

## Counts

| Item | n |
|------|--:|
| ESPN events fetched | 401 |
| **Included** | **132** |
| Excluded | 269 |
| Included completed | 132 |

### Exclusions

```json
{
  "fbs_fcs_or_non_fbs_unsupported_scope": 127,
  "2026_not_completed": 142
}
```

## Coverage limitations

- Membership from ESPN **week** scoreboards (seasontype=2, weeks 8–15 / 2026 w1–15).  
- Verified FBS–FBS filter uses season-specific ESPN ID tables — included n may be **below** a full FBS slate if IDs lag. Enrich with date-walk before acceptance scoring if needed.  
- 2026 incomplete games excluded (`2026_not_completed`).  
- **No Odds closes** joined · **not scored**.

## Causal state (pre-kickoff only)

Pre-kickoff ratings only: seed 2024 FBS–FBS → update chronologically through TUNING + any FINAL_EVAL games with kickoff < target kickoff. Never use target game sealedOutcome in predict. Never use FINAL_EVAL outcomes for α/param selection (α frozen at 1.15).

1. Seed: phase-e 2024 (n=871)  
2. Walk TUNING 2025 w1–7 (n=471)  
3. Walk included FINAL_EVAL by kickoff — update **after** predict using sealed outcomes for carry-forward only  
4. **Do not** use sealed outcomes for α/param selection (α=1.15 frozen)  
5. **Do not** run M1–M4 on FINAL_EVAL this turn  

## Fixtures

- `ncaaf-final-eval-membership.json` — full membership + exclusions  
- `ncaaf-final-eval-membership-games.json` — included games with `outcomeSealed=true`  
