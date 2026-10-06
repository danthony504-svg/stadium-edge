# PR #620 — final validation gates

**Branch:** `cursor/coach-saints-10leg-copy-fix-def8` · **PR:** #620 (base `main`)  
**No deploy / merge / OTA yet. No perf changes.**

## Gate results

| Gate | Result |
|------|--------|
| 10 leg Saints → final 7, copy says 7, composition 4 main + 3 ALT | **PASS** (unit + prior live audit) |
| full 10/10 → copy says 10, composition matches | **PASS** |
| 5/10 shortfall → copy says 5 | **PASS** |
| ALT-only / mixed counts match delivered ticket | **PASS** |
| no stale `staged.breakdown` pool counts in final Coach copy | **PASS** |
| Saints matchup scope unchanged | **PASS** (`coachAskTeamScope` tests 12–16) |
| no threshold / qualification / sim / correlation / diversity / dedupe / top-up behavior change | **PASS** (diff only note wiring + copy helpers; `ticketStaging` tests 50–67 unchanged) |
| Coach QA | **13596 / 13596 PASS**, failed 0 (main baseline; unexpected P0/P1=0) |
| TypeScript new errors | **0** (fixed duplicate `TicketStagingBreakdown` import; remaining scanner noise pre-existing) |

### Live board note
Earlier live run on this slate (same fix): `final=7`, note led with “7 qualified picks…”, composition `4 main + 3 alt`, all ATL@NO.  
Re-check at final-validation time: Saints matchup **off board** (`oddsGameCount=0`) → honest miss note — scope behavior correct, not a copy regression.

## Unit evidence (`fullBoardMarketCopy.test.ts` + related)

```
67 tests / 67 pass
- 10 leg Saints → final 7 copy says 7 with correct 4 main + 3 ALT
- 5/10 shortfall → copy says 5
- full 10/10 ticket → copy describes 10 and composition matches final
- ALT-only ticket composition matches delivered ticket
- mixed ticket: stale staged 3+1 cannot appear when final is 7
- no stale staged.breakdown pool counts in final Coach delivery note
- Saints team-scope suite PASS
- ticketStaging suite PASS (no staging math edits)
```

## MERGE READY

**PR #620 copy fix: YES**

**Phase 2.4 performance PR (#619): YES** (prior final validation; Option C A≡C + gates; OTA-only; NFL 7→6 separate)

## Safest merge / deployment order (when approved)

1. **Merge #620 → `main`** first (user-facing correctness; isolated from perf).
2. **Publish OTA** for #620. **Render: not required.**
3. **Merge #619** (Phase 2.4) after its base (`cursor/ota-recovery-path-def8`) is integrated / rebased as needed onto the post-#620 line.
4. **Publish OTA** for #619. **Render: not required.**

Both PRs are **OTA-only** mobile client changes. Neither needs Render for their production blast radius.
