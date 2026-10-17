# TUNING venue recovery sidecar

**Generated:** 2026-10-17T11:33:09.686112+00:00  
**Source:** free ESPN site scoreboard v2 (by date) + summary fallback for 2 missing events  
**Join:** `eventId` + `season`  
**Original fixtures:** untouched (`ncaaf-tuning-2025-w1-7-games.json`)

## Rules

- **Neutral** only when ESPN `competition.neutralSite === true`
- **Home stadium** only when ESPN `competition.neutralSite === false`
- **Unknown** if event missing or `neutralSite` absent/non-boolean
- Do **not** infer neutral from missing fields or team order

## Counts

| Category | n |
|----------|--:|
| TUNING games | 471 |
| Recovered (home+neutral) | 471 |
| Unresolved | 0 |
| Home stadium (`neutralSite=false`) | 465 |
| Neutral (`neutralSite=true`) | 6 |
| Neutral domestic | 5 |
| Neutral international | 1 |
| Any international venue | 1 |
| Has venueId | 471 |

Sidecar: `ncaaf-tuning-2025-w1-7-games.venue-tags.json`

International neutral example: event `401756846` Aviva Stadium (Dublin, Ireland).
