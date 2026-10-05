# AI COACH QA — Root-Cause Clustering Report

**Audit only. No production code, threshold, merge, deploy, or OTA changes.**

Source run: seed `6092026` · 13,596 tests · **287 failed** · 96 warnings · P0=0 · P1=257 · P2=43(findings) / **30 failed P2**

## Reconciliation (287 failures)

| # | Root cause | Priority | Failures | P1 share |
|---|---|---|---|---|
| RC1 | Stale `propsOnly` via `threadWantsPropsOnly` | P1 | **169** | 169 |
| RC2 | Leg parse gap: `give me N {ufc\|tennis} picks` | P1 | **56** | 56 |
| RC3 | College `gameLinesOnly` suppresses explicit market locks | P2 | **30** | 0 |
| RC4 | Team exclusion nick dictionary gaps (Chelsea, Ohio State) | P1 | **24** | 24 |
| RC5 | Explicit-lock rule precedence (`completions` before `longest completion`) | P1 | **8** | 8 |
| | **Sum** | | **287** | **257** |

`169+56+30+24+8 = 287` · P1 `169+56+24+8 = 257` · P2 failures `30`.

No failures in this run for: stale sport, stale date, stale team include, stale exclusions, stale market allowlist, recovery/ALT, provider provenance, simulation, terminal/loading, or performance.

---

## RC1 — Stale `propsOnly` (169) — **confirmed #1**

### Failures explained
169 sequential/fuzz cases where follow-up text alone is **not** props-only, but with priors becomes `propsOnly=true`.

### Prior breakdown
| Prior class | Count | Mechanism |
|---|---|---|
| Sport N-leg rule (`soccer\|nba\|mlb\|nhl\|wnba\|ncaab`) | 121 | `wantsPropsOnly` sport-scoped N-leg |
| Explicit `player props` | 45 | `wantsPropsOnly` player-props phrases |
| `N leg … props` | 3 | `wantsPropsOnly` n-leg props |

Follow-up shapes: bare `N leg` (73), with date (42), with sport (19), other (35).

### Exact production divergence
1. `app/(tabs)/coach.tsx` — builds `priorUserTexts` from `messagesRef` and passes into `buildCoachParlay`
2. `lib/coach/buildParlay.ts` — `parseCoachAskMarketConstraint(askText, priorUserTexts)`
3. `lib/coachAskMarketFilter.ts` (~428) — `threadWantsPropsOnly(t, priorUserTexts)` → `{ propsOnly: true, allowedMarketKeys: null }`
4. `lib/slate.ts` **`threadWantsPropsOnly`** (~602–621) — if current doesn’t clear inheritance, any prior `wantsPropsOnly(prior)` sticks
5. `lib/slate.ts` **`wantsPropsOnly`** (~543–556) — bare `N leg soccer|nba|mlb|nhl|wnba|ncaab` is props-only by design

Market locks intentionally **do not** inherit (`allowedMarketKeys` stays null). TD/yards/sacks → bare `5 leg` correctly reset.

### Expected vs actual
| | Clean `5 leg` | `4 leg soccer` → `5 leg` |
|---|---|---|
| propsOnly | false | **true** |
| isMarketLocked | false | false |
| path | full_board_mix | **props_only** → skill-alt recovery copy |

### Production impact
**Yes — live phone regression.** Same session after soccer/player-props/sport N-leg routes bare follow-ups into football props-only + unlocked skill recovery (“locked-market props … skill alts”) even though `isMarketLocked=false`.

### Fix risk
**Medium-high.** `threadWantsPropsOnly` is documented for slate refinements (`5 leg for tomorrow` after `7 leg NFL player props`). A fix must:
- clear inheritance on bare `N leg` / new sport / non-prop follow-ups
- preserve intentional slate-refinement inheritance
- not rewrite market-lock allowlists

### Regression tests to add
- `4 leg soccer` → `5 leg` ⇒ `propsOnly=false`
- `5 leg player props` → `5 leg` ⇒ `propsOnly=false`
- `9 leg nfl props` → `5 leg` ⇒ `propsOnly=false`
- Keep: `7 leg NFL player props` → `5 leg for tomorrow` ⇒ `propsOnly=true` (documented)
- Keep: `5 leg touchdowns` → `5 leg` ⇒ unlocked + not props-only

---

## RC2 — Leg-count parse gap for UFC/tennis “give me” phrasing (56)

### Failures explained
All 56 are `give me N UFC picks` / `give me N tennis picks` (± date). `requestedLegs=0` vs expected N.

### Exact divergence
`lib/coach/parseAsk.ts` **`parseRequestedLegs`** — `sportPicks` regex:

```text
/\b(\d{1,3})\s+(?:different\s+)?(?:nhl|nfl|nba|mlb|wnba|ncaaf|ncaab|cfb|soccer)\s+picks?\b/i
```

**Missing:** `ufc`, `tennis` (both are in `DEFAULT_SPORTS`).

Evidence:
- `give me 5 NFL picks` → 5
- `give me 5 UFC picks` → 0
- `build a 5 leg UFC parlay` → 5 (uses `N leg` path)
- `5 picks UFC` → 5 (bare picks path)

### Expected vs actual
Expected: `requestedLegs=5` for `give me 5 UFC picks`.  
Actual: `0` → ask may leave parlay-build path (`resolveBuildLegTarget` / `isParlayBuildAsk` gates).

### Production impact
**Yes** for UFC/tennis users using “give me N … picks” without the word “leg”.

### Fix risk
**Low** — extend sport alternation in one regex (and mirror any twin). Unlikely to disturb NFL/soccer paths.

### Regression tests
- `give me 5 UFC picks` / `give me 7 tennis picks tonight` → legs 5/7
- Existing NFL/soccer give-me cases still pass

---

## RC3 — College `gameLinesOnly` suppresses explicit locks (30) — P2

### Failures explained
All 30 are `5 leg ncaaf <EXPLICIT_MARKET_LOCK_RULE label>` where lock is dropped.

### Exact divergence
1. `lib/boardScanPropDelivery.ts` **`askIsCollegeFootballOnly`** → true for `ncaaf`/`cfb`/`college`
2. **`askAllowsNcaafPlayerProps`** — allowlist is narrow (player props phrases, yards, some TD/sack/reception patterns) — **false** for completions, attempts, longest, INTs, and non-CFB families
3. `lib/coachAskMarketFilter.ts` **`wantsGameLinesOnlyAsk`** (~481): college-only && !allowsProps → **`gameLinesOnly=true`**
4. **`parseCoachAskMarketConstraint`**: `if (explicit && !gameLinesOnly)` skipped → returns game-lines-only with `allowedMarketKeys=null`

Evidence:
- `5 leg ncaaf passing yards` → locked (allowsProps true)
- `5 leg ncaaf completions` → gameLinesOnly, keys null
- `5 leg nfl completions` → locked
- `5 leg ncaaf pitcher strikeouts` → same suppress path (cross-sport label on CFB ask)

### Expected vs actual
Expected (harness / user naming a family): explicit family locks.  
Actual: college gate forces game-lines-only and **throws away** the matched explicit allowlist.

### Production impact
**Partial / real for CFB skill asks** like `5 leg ncaaf completions` / `rushing attempts` / `longest rush` / `pass interceptions`.  
Cross-sport labels on ncaaf (`pitcher strikeouts`, `goal scorer`) are less meaningful but share the same defect path.

### Fix risk
**Medium.** College game-lines default is intentional for bare `8 leg college`. Fix options:
- honor `matchExplicitMarketLocks` even when college game-lines default would apply, or
- widen `askAllowsNcaafPlayerProps` to all football explicit families  
Must not re-open bare college asks to thin player-prop boards.

### Regression tests
- `5 leg ncaaf completions|rushing attempts|longest rush|pass interceptions` → locked keys
- `8 leg college` / `8 leg ncaaf` still game-lines-only
- `5 leg ncaaf passing yards|touchdowns|sacks` still locked

---

## RC4 — Team exclusion dictionary gaps (24)

### Failures explained
| Missing nick | Failures |
|---|---|
| Chelsea (soccer) | 12 |
| Ohio State (ncaaf) | 12 |

`excludedTeamScopesFromText` → `[]`. Ducks/Cowboys exclusions work.

### Exact divergence
`lib/coachAskTeamScope.ts` **`NICK_TO_SPORT`** — no `chelsea` / `ohio state` / `buckeyes` entries (soccer club dictionary largely absent; CFB sparse).

### Expected vs actual
Expected: `6 leg NHL no Ducks`-style exclusion for `no Chelsea` / `no Ohio State`.  
Actual: exclusions empty → excluded matchups can remain on the board.

### Production impact
**Yes** for those franchises/wordings. Not a session-leak issue.

### Fix risk
**Low–medium** — additive nick dictionary (watch ambiguous names).

### Regression tests
- `5 leg SOCCER no Chelsea` / `not Chelsea` / `without the Chelsea`
- `5 leg NCAAF no Ohio State` / `no Buckeyes`
- Existing Ducks/Cowboys exclusions unchanged

---

## RC5 — Explicit lock precedence: longest vs bare completions/receptions (8)

### Failures explained
| Ask | Expected key | Actual key |
|---|---|---|
| `N leg longest completion` (×4) | `player_pass_longest_completion` | `player_pass_completions` |
| `N leg longest reception` (×4) | `player_reception_longest` | `player_receptions` |

### Exact divergence
`lib/explicitMarketLock.ts` **`EXPLICIT_MARKET_LOCK_RULES` order** + **`matchExplicitMarketLocks`** first-match blanking:

- `fb_completions` (`completions?`) appears **before** `fb_longest_completion`
- In `"longest completion"`, `\bcompletions?\b` matches `"completion"` and blanks it
- `longest\s+completions?` never sees a match

Same pattern: `fb_receptions` before `fb_longest_reception`.

(`longest rush` is fine — no earlier bare `rush` rule eats it.)

### Expected vs actual
Expected: longest-* provider keys.  
Actual: volume completions/receptions allowlist — wrong family for an explicit “longest” ask.

### Production impact
**Yes** for longest-completion / longest-reception tickets (wrong market family).

### Fix risk
**Low** — reorder more-specific longest rules above bare completions/receptions (comment already says specific before bare). Do **not** broadly rewrite market-lock behavior beyond precedence.

### Regression tests
- `5 leg longest completion` → `player_pass_longest_completion` only
- `5 leg longest reception` → `player_reception_longest`
- `5 leg completions` / `5 leg receptions` still map to volume keys

---

## Minimal root-cause set

**Five production defects** explain all **287** failures. No further clusters required.

| Rank | Fix first? | Why |
|---|---|---|
| RC1 | **Yes** | Explains phone screenshot; 169 tests; violates follow-up intent |
| RC5 | Yes (small) | Wrong explicit family; 8 tests; low risk reorder |
| RC2 | Yes (small) | UFC/tennis give-me legs; 56 tests; one regex |
| RC4 | Yes (dictionary) | Exclusion misses; 24 tests |
| RC3 | Careful | 30 tests; interact with intentional college game-lines policy |

---

## P1 breakdown (257)

| Root cause | Count | % of P1 |
|---|---|---|
| RC1 stale propsOnly | 169 | 65.8% |
| RC2 UFC/tennis leg parse | 56 | 21.8% |
| RC4 exclusion nicks | 24 | 9.3% |
| RC5 longest-lock precedence | 8 | 3.1% |
| **Total** | **257** | 100% |

Priority among P1s matching the stated bar (explicit instruction / wrong constraint / state leak):
1. RC1 state leak  
2. RC5 wrong market family  
3. RC4 wrong team exclusion  
4. RC2 wrong/missing leg count for UFC/tennis give-me  

No P1s in this run for: fewer-than-N despite qualified candidates, recovery/ALT constraint violations (those need live pipeline; not in the 287 offline fails).

---

## Warnings (96) — clustered separately

| Cluster | Count | Classification |
|---|---|---|
| Market coverage on **ufc/tennis** (`propCapable=false`, status still PASS) | 82 | **Expected/benign** — non-prop sports; harness warning only |
| Live failure-injection **SKIPPED** (timeout, 429, missing ESPN/history/injury/weather, sim timeout, partial/empty board, malformed outcome, cache miss/stale, one sport down) | 13 | **Expected offline** — not latent product failures; need controlled live suite |
| Fixture data-quality flag (`Ghost Runner` line 999.5) | 1 | **Harness fixture** — proves DQ detector; not production |

**Do not promote these warnings to failures** without live evidence.

---

## What this run did *not* find (among the 287)

- Stale sport / date / teamScope / exclusions / `allowedMarketKeys` inheritance  
- Recovery/ALT top-up constraint breaks  
- Provider provenance / mapping / simulation mismatches (offline fixture path clean after stager sport-scoping)  
- Performance/timeouts / terminal stuck states  

Those remain **unproven**, not proven-absent — especially live pipeline, N-fill shortfalls, and recovery.

---

## Recommended next step (not done here)

Implement **RC1** with a narrow clear rule for bare/`non-prop` follow-ups, add the regression tests listed above, re-run `pnpm test:coach-qa`, and expect ~169 failures to clear—then tackle RC5 → RC2 → RC4 → RC3.
