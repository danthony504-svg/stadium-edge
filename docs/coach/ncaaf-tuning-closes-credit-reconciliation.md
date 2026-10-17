# TUNING closes credit reconciliation — 3560 vs 3280

**Retrieval agent:** `bc-01a1471c-a008-7787-a77d-4ba59e943645` (“API KEY”)  
**Branch:** `cursor/ncaaf-tuning-closes-3645`  
**Archive:** `ncaaf-tuning-2025-w1-7-closing-lines.json` · `generatedAt` 2026-10-17T00:04:47Z  

## Numbers

| Source | Credits | How derived |
|--------|--------:|-------------|
| **Authoritative session spend** | **3 560** | Free `/v4/sports` remaining: **3 808 289** (pre) − **3 804 729** (post) |
| Script ledger `creditsSpent` | **3 280** | `NCAAF_E2B_CREDITS_ALREADY_SPENT=20` + **163** HTTP × 20 |
| Dry-run base (plan only) | 3 540 | 177 buckets × 20 (not actual spend) |
| Hard cap | 4 500 | Authorized; under-cap either way |

## Same retrieval — not two pulls

1. Historical access confirmed with first planned request (20 credits).  
2. E2b TUNING batch started; **first process interrupted** after charging ~**280** credits of snapshots into `/opt/cursor/artifacts/ncaaf-e2b-close-snapshots/`.  
3. **Second process** resumed with the same cap; reused those caches (no re-charge) → ledger **3 280**.  
4. Odds account remaining-Δ still shows the interrupted work → **3 560**.

`aliasRematch.paidHttp = 0` afterward — rematch was cache-only.

## Cross-agent provenance

| Role | bcId | Branch |
|------|------|--------|
| Retrieval + archive vendor | `bc-01a1471c-a008-7787-a77d-4ba59e943645` | `cursor/ncaaf-tuning-closes-3645` |
| Cache-only analysis continuation | `bc-01a140e2-c331-7d27-9d8f-4d9938928b51` | `cursor/ncaaf-tuning-cache-analysis-8b51` |

No additional paid retrieval on the analysis agent.
