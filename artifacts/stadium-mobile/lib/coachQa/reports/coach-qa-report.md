# AI COACH QA REPORT

Generated: 2026-10-05T17:40:07.594Z
Seed: 6092026

## Summary

| Metric | Count |
|---|---|
| Total tests | 13596 |
| Passed | 13309 |
| Failed | 287 |
| Warnings | 96 |

## By category

| Category | Passed | Failed | Warnings |
|---|---|---|---|
| data_quality | 5 | 0 | 1 |
| date_sport_team | 2 | 32 | 0 |
| failure_injection | 17 | 0 | 13 |
| fuzz_parser | 500 | 0 | 0 |
| fuzz_sequential | 4671 | 0 | 0 |
| mapping | 9 | 0 | 0 |
| market_coverage | 420 | 30 | 82 |
| parser | 6780 | 56 | 0 |
| performance | 66 | 0 | 0 |
| pipeline_counts | 8 | 0 | 0 |
| provider_integrity | 10 | 0 | 0 |
| recovery_alt | 3 | 0 | 0 |
| sequential | 794 | 0 | 0 |
| state_leak | 0 | 169 | 0 |
| ticket_construction | 24 | 0 | 0 |

## Ranked findings

### 1. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg SOCCER no Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 2. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg SOCCER not Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 3. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 SOCCER picks without the Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 4. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg SOCCER tonight no Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 5. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg SOCCER no Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 6. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg SOCCER not Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 7. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 SOCCER picks without the Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 8. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg SOCCER tonight no Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 9. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg SOCCER no Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 10. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg SOCCER not Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 11. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 SOCCER picks without the Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 12. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg SOCCER tonight no Chelsea"`
- **Expected:** excluded contains chelsea
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 13. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg NCAAF no Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 14. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg NCAAF not Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 15. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 NCAAF picks without the Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 16. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg NCAAF tonight no Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 17. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg NCAAF no Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 18. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg NCAAF not Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 19. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 NCAAF picks without the Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 20. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg NCAAF tonight no Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 21. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg NCAAF no Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 22. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg NCAAF not Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 23. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 NCAAF picks without the Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 24. [P1] Expected team exclusion missing

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg NCAAF tonight no Ohio State"`
- **Expected:** excluded contains ohio state
- **Actual:** excluded=[]
- **Stage:** excludedTeamScopesFromText
- **Likely file:** `lib/coachAskTeamScope.ts`
- **Production affected:** YES

### 25. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg longest completion"`
- **Expected:** keys include player_pass_longest_completion
- **Actual:** keys=["player_pass_completions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 26. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg longest completion"`
- **Expected:** keys include player_pass_longest_completion
- **Actual:** keys=["player_pass_completions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 27. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg longest completion"`
- **Expected:** keys include player_pass_longest_completion
- **Actual:** keys=["player_pass_completions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 28. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"10 leg longest completion"`
- **Expected:** keys include player_pass_longest_completion
- **Actual:** keys=["player_pass_completions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 29. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"5 leg longest reception"`
- **Expected:** keys include player_reception_longest
- **Actual:** keys=["player_receptions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 30. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"6 leg longest reception"`
- **Expected:** keys include player_reception_longest
- **Actual:** keys=["player_receptions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 31. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"8 leg longest reception"`
- **Expected:** keys include player_reception_longest
- **Actual:** keys=["player_receptions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 32. [P1] Market lock family mismatch

- **Category:** date_sport_team
- **Prompt/sequence:** `"10 leg longest reception"`
- **Expected:** keys include player_reception_longest
- **Actual:** keys=["player_receptions"]
- **Stage:** allowedMarketKeys
- **Likely file:** `lib/explicitMarketLock.ts`
- **Production affected:** YES

### 33. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg player props","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg player props]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 34. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["4 leg soccer","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[4 leg soccer]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 35. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["9 leg nfl props","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[9 leg nfl props]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 36. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 37. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5-leg MLB","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5-leg MLB]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 38. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb tonight","6 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb tonight]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 39. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb today","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb today]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 40. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5-leg MLB today","7 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5-leg MLB today]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 41. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb tomorrow","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb tomorrow]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 42. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5-leg MLB tomorrow","7 leg tomorrow"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5-leg MLB tomorrow]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 43. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb player props","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb player props]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 44. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb moneylines","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb moneylines]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 45. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb spreads","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb spreads]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 46. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb team totals","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb team totals]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 47. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb over","6 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb over]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 48. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb under","7 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb under]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 49. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb alternate","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb alternate]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 50. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["5 leg mlb alt lines","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[5 leg mlb alt lines]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 51. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6-leg MLB","6 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6-leg MLB]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 52. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb tonight","7 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb tonight]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 53. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6-leg MLB tonight","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6-leg MLB tonight]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 54. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb today","7 leg tomorrow"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb today]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 55. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6-leg MLB today","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6-leg MLB today]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 56. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb tomorrow","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb tomorrow]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 57. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6-leg MLB tomorrow","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6-leg MLB tomorrow]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 58. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb player props","6 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb player props]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 59. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb moneylines","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb moneylines]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 60. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb totals","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb totals]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 61. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb team totals","7 leg tomorrow"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb team totals]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 62. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb over","7 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb over]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 63. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb under","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb under]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 64. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["6 leg mlb alternate","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[6 leg mlb alternate]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 65. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 66. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7-leg MLB","7 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7-leg MLB]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 67. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb tonight","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb tonight]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 68. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7-leg MLB tonight","7 leg tomorrow"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7-leg MLB tonight]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 69. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb today","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb today]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 70. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7-leg MLB today","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7-leg MLB today]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 71. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7-leg MLB tomorrow","6 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7-leg MLB tomorrow]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 72. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb player props","7 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb player props]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 73. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb spreads","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb spreads]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 74. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb totals","7 leg tomorrow"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb totals]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 75. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb team totals","5 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb team totals]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 76. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb over","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb over]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 77. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb under","5 leg NFL"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb under]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 78. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["7 leg mlb alt lines","7 leg today"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[7 leg mlb alt lines]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 79. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["8 leg mlb","7 leg tomorrow"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[8 leg mlb]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

### 80. [P1] propsOnly leaked from prior turn onto follow-up

- **Category:** state_leak
- **Prompt/sequence:** `["8-leg MLB","10 leg"]`
- **Expected:** propsOnly=false (current text alone)
- **Actual:** propsOnly=true via threadWantsPropsOnly priors=[8-leg MLB]
- **Stage:** threadWantsPropsOnly
- **Likely file:** `lib/slate.ts#threadWantsPropsOnly → coachAskMarketFilter.ts`
- **Production affected:** YES

_… 221 additional findings truncated in markdown (see JSON)._

## Sequential / fuzz

- Sequential checks: 1872
- Stale-leak failures: 169
- Fuzz cases: 5262
- Fuzz failures: 91

## Sport × market × request-type matrix (sample)

| Sport | Market family | Request type | Status |
|---|---|---|---|
| mlb | mlb_strikeouts | explicit_lock | PASS |
| mlb | mlb_home_runs | explicit_lock | PASS |
| mlb | mlb_hits_runs_rbis | explicit_lock | PASS |
| mlb | mlb_stolen_bases | explicit_lock | PASS |
| mlb | mlb_total_bases | explicit_lock | PASS |
| mlb | mlb_rbis | explicit_lock | PASS |
| mlb | mlb_hits | explicit_lock | PASS |
| mlb | mlb_runs | explicit_lock | PASS |
| mlb | fb_pass_yds | explicit_lock | PASS |
| mlb | fb_rush_yds | explicit_lock | PASS |
| mlb | fb_rec_yds | explicit_lock | PASS |
| mlb | fb_completions | explicit_lock | PASS |
| mlb | fb_pass_attempts | explicit_lock | PASS |
| mlb | fb_rush_attempts | explicit_lock | PASS |
| mlb | fb_receptions | explicit_lock | PASS |
| mlb | fb_sacks | explicit_lock | PASS |
| mlb | fb_pass_ints | explicit_lock | PASS |
| mlb | fb_longest_completion | explicit_lock | PASS |
| mlb | fb_longest_reception | explicit_lock | PASS |
| mlb | fb_longest_rush | explicit_lock | PASS |
| mlb | fb_first_td | explicit_lock | PASS |
| mlb | fb_touchdowns | explicit_lock | PASS |
| mlb | fb_field_goals | explicit_lock | PASS |
| mlb | soccer_nhl_goal_scorer | explicit_lock | PASS |
| mlb | soccer_shots_on_target | explicit_lock | PASS |
| mlb | nhl_shots_on_goal | explicit_lock | PASS |
| mlb | soccer_shots | explicit_lock | PASS |
| mlb | nhl_soccer_goals | explicit_lock | PASS |
| mlb | nba_pra | explicit_lock | PASS |
| mlb | nba_pts_reb | explicit_lock | PASS |
| mlb | nba_pts_ast | explicit_lock | PASS |
| mlb | nba_reb_ast | explicit_lock | PASS |
| mlb | nba_combo_tab | explicit_lock | PASS |
| mlb | nba_blocks_steals | explicit_lock | PASS |
| mlb | nba_rebounds | explicit_lock | PASS |
| mlb | nba_assists | explicit_lock | PASS |
| mlb | nba_threes | explicit_lock | PASS |
| mlb | nba_blocks | explicit_lock | PASS |
| mlb | nba_steals | explicit_lock | PASS |
| mlb | nba_turnovers | explicit_lock | PASS |
| mlb | nba_points | explicit_lock | PASS |
| mlb | moneylines | game_line | PASS |
| mlb | spreads | game_line | PASS |
| mlb | totals | game_line | PASS |
| mlb | game lines only | game_line | PASS |
| wnba | mlb_strikeouts | explicit_lock | PASS |
| wnba | mlb_home_runs | explicit_lock | PASS |
| wnba | mlb_hits_runs_rbis | explicit_lock | PASS |
| wnba | mlb_stolen_bases | explicit_lock | PASS |
| wnba | mlb_total_bases | explicit_lock | PASS |
| wnba | mlb_rbis | explicit_lock | PASS |
| wnba | mlb_hits | explicit_lock | PASS |
| wnba | mlb_runs | explicit_lock | PASS |
| wnba | fb_pass_yds | explicit_lock | PASS |
| wnba | fb_rush_yds | explicit_lock | PASS |
| wnba | fb_rec_yds | explicit_lock | PASS |
| wnba | fb_completions | explicit_lock | PASS |
| wnba | fb_pass_attempts | explicit_lock | PASS |
| wnba | fb_rush_attempts | explicit_lock | PASS |
| wnba | fb_receptions | explicit_lock | PASS |
| … | 390 more rows in JSON | … | … |

## Notes

- Offline harness: parser/state/fuzz/fixture-pipeline only. Large fuzz does not call paid/live APIs.
- Live provider end-to-end validation is a separate controlled subset (not executed in this default run).
- Documented intentional inheritance: slateDay when current ask has no date cue; propsOnly inheritance exists in threadWantsPropsOnly — bare N-leg after props-only prior is flagged as state_leak (P1) per product QA expectation.
- Screenshot sequence stale propsOnly confirmed=true
- Matrix size=3125; sequential seeds=10
- No production Coach thresholds, selection, merge, deploy, OTA, or EAS build were changed.
