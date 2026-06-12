---
name: Golf (PGA majors) outright-winner betting
description: How golf outrights are wired separately from team sports, the slip-leg shape contract, and the honesty gates on the endpoint/grading.
---

Golf outright-winner (PGA majors) is a STANDALONE surface, NOT a member of the `SPORTS` list.

**Why:** golf has no two-team matchup, no game-line/prop markets, no live-clock — adding it to `SPORTS` would break the odds fan-out, coach pool, arbitrage, and every matchup-keyed validator. It gets its own endpoint + screen/view only.

**How to apply:**
- Server: `GET /api/sports/golf` (api-server `routes/golf.ts`). Discovers active `golf_*_winner` keys from the cached Odds API sports list, fetches `markets=outrights` `regions=us,us2` (cached 5m). Per golfer: best (longest) price + books[] (cap 10), no-vig consensus `fairProb` (per-book devig→1, median, renorm), `edgePct`, `value`. api-server has NO file watcher — restart the workflow after edits; curl `http://localhost:8080` (NOT $REPLIT_DEV_DOMAIN → HTTP 000).
- Honesty gates (all REAL or omitted): drop outcomes with implied prob > 0.6 (placeholder/suspended lines like -100000 corrupt consensus); gate edge/value to credible contenders only (decimal ≤ 151 i.e. ≤ +15000, edge band 3–40%, ≥3 books) so deep longshots don't show fake 100%+ edges. Sort favorites-first by `fairProb` desc. Golf vig is genuinely -EV so most majors show 0 value — that's honest, don't loosen the gate to manufacture picks.
- Grading: `grade.ts` golf branch runs BEFORE team logic. ESPN `golf/pga/scoreboard`, completed + (`winner===true || order===1`), diacritic/punct-insensitive `golfNorm`, EXACTLY-ONE token-subset tournament match, fail-closed `ungraded`.

**Slip-leg shape contract (web + mobile MUST be byte-identical for dedupe + grading):**
`game` = tournament title, `market` = "Tournament Winner", `pick` = "<Golfer> to win", `sport` = "golf", `odds` = best American.

**Web add path gotcha:** web `addLeg` runs `filterPicksToReal` which validates against matchup feeds — golf is never in those, so it would silently drop. Golf adds MUST pass `{ skipValidation: true }`. Dedupe still holds via `legKey = game|market|pick`; toggle remove uses `removeLegByPick(leg)`. Web `ParlayBuilder.tsx` is untyped JS-in-`.tsx` with ~1440 pre-existing implicit-any tsc errors and is NOT tsc-gated (Vite/esbuild); don't chase those. Mobile is strict and clean.
