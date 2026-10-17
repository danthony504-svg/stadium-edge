# FINAL_EVAL ML archive — secret injection mismatch

**Status:** `STOPPED_SECRET_INJECTION_MISMATCH` · **Credits:** **0** · **FINAL_EVAL scored:** false  
**TUNING retrieval repeated:** false · No purchase / deploy / OTA / unlock

## Environment ID (exact)

| Field | Value |
|-------|-------|
| `environmentPublicId` | `8c5427d9-a490-11f1-a7d1-d6b4613131ce` |
| `environmentVersionPublicId` | `f60179da-c844-11f1-bd9f-22db05ab6f0c` |
| Dashboard | https://cursor.com/dashboard/cloud-agents/environments/e/8c5427d9-a490-11f1-a7d1-d6b4613131ce |

Same environment ID as the successful TUNING closes run.

## Secret configuration mismatch

| Check | This run (warm_fork) | Required for FINAL_EVAL pull |
|-------|----------------------|------------------------------|
| `CLOUD_AGENT_ALL_SECRET_NAMES` | `EXPO_TOKEN` | must include `ODDS_API_KEY` |
| `CLOUD_AGENT_INJECTED_SECRET_NAMES` | `EXPO_TOKEN` | must include `ODDS_API_KEY` |
| `process.env.ODDS_API_KEY` | **ABSENT** (len=0) | **PRESENT** (value never printed) |

## Pod / boot mismatch vs TUNING success

| | This run | TUNING success (`cursor/ncaaf-tuning-closes-3645`) |
|--|----------|-----------------------------------------------------|
| bcId | `bc-01a140e2-c331-7d27-9d8f-4d9938928b51` | `bc-01a1471c-a008-7787-a77d-4ba59e943645` |
| Name | Preview ios ota publication | **API KEY** |
| Status | RUNNING | IDLE |
| warmFork | **warm_fork** | **cold** |
| buildId | `bld-20261015-df8348a8-…` | `bld-20261016-74f31a60-…` |
| Odds pull | blocked | completed TUNING closes (3280 credits / cap 4500; matched 413) |

**Diagnosis:** Environment ID matches, but this pod is a long-lived **warm_fork** that only injected `EXPO_TOKEN` at boot. The TUNING archive was pulled on a later **cold** boot agent. Follow-ups here cannot re-inject secrets or jump into the IDLE API KEY agent.

## What not to do

- Do **not** re-request retrieval approval (already authorized 2100+2100≤4200).
- Do **not** repeat TUNING retrieval.
- Do **not** score FINAL_EVAL / deploy / OTA / unlock.

## Unblock

1. Resume on idle agent https://cursor.com/agents/bc-01a1471c-a008-7787-a77d-4ba59e943645 **or** start a **new cold** agent on env `8c5427d9-…` with `ODDS_API_KEY` in Secrets.  
2. Confirm `ODDS_API_KEY_set=true` without printing the value.  
3. Run `NCAAF_FINAL_EVAL_PULL=1 python3 artifacts/api-server/scripts/ncaafCleanFinalEvalMlArchivePull.py` (skip TUNING).
