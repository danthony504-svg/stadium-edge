# Device check — OTA `01a14121` Longshots

**Recorded:** 2026-10-15  
**Channel:** `preview`  
**Runtime:** `1.1.0`  
**Update group:** `d405e8b6-edf6-45d3-a8a6-d977ea97d2f4`  
**iOS update ID:** `01a14121-a602-751f-b218-724db14536d6`  
**Published commit (OTA JS):** `40f5b9f4747df2b99c98c4c08d26f276e2e07d16`

## Longshots

| Step | Result |
|------|--------|
| Home → Longshots navigation | **PASS** |
| MLB sport selection | **PASS** |
| Honest empty state (no MLB steals) | **PASS** |

## Follow-on (code after this OTA — not yet published)

Scan / “Steals Found Today” totals are board-wide while a sport pill is selected. Tip after `6cca6f4f` labels those counts **Across all sports** (and scopes the sport row to the selected league).

## Still unverified on this device

| Check | Status |
|-------|--------|
| Best Value → value-ranked view | **Unverified** (fix landing this tip) |
| Easy Money | **Unverified** |
| Timing instrumentation | **Unverified** |
