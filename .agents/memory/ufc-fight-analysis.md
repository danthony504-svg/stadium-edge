---
name: UFC fight analysis + underdog upset read
description: Real ESPN MMA tale-of-the-tape + data lean + plus-money upset flag; never-fabricate constraints and the name-matching gotchas that make or break it.
---

# UFC fight analysis (web + mobile)

Real fighter breakdown for UFC bouts: W-L-D record, strike accuracy, strikes/min,
takedown acc/avg, submission avg, KO/TKO/decision %, plus a deterministic data lean
and a plus-money "upset" flag. Backend `GET /sports/fight-analysis?away=&home=`
(api-server lib/ufc.ts + routes/ufc.ts). Boxing is OUT OF SCOPE — no data source,
never fake it. UFC odds are h2h (moneyline) only.

## Never-fabricate rules baked in
- **0-valued % stats are placeholders, not real zeros.** ESPN reports unpopulated
  accuracy/percentage fields as 0 for active fighters. `pctOrNull` drops `<= 0`;
  a comparison factor is used only when BOTH fighters have real (>0) values. Per-fight
  averages (LPM, TD avg, sub avg) CAN legitimately be 0 → `avgOrNull` keeps `>= 0`.
- **Fail-closed fighter resolution.** `resolveFighterId` must NOT fall back to the
  first MMA search hit on a name miss — that attaches the WRONG fighter's real stats
  to a bout (misattributed real data still violates never-fabricate). Require a
  diacritic-/punctuation-insensitive exact display-name match; only accept a lone hit
  when the mma search returned exactly ONE candidate. Else null → card shows
  "unavailable". (Verified: gibberish name → null record, no fabrication.)
- Records are the reliable signal; if a fighter can't be resolved or has no record,
  `lean = null`. Honest-null `—` cells in the tale-of-the-tape, never invented numbers.

## Name-matching is the whole game (two diverging name sources)
- `lean.side` = ESPN's **canonical** resolvedName. The h2h **outcome name** comes from
  the odds feed. Accents/punctuation/spacing differ ("Joandérson" vs "Joanderson").
- **The upset join must normalize BOTH sides** (lowercase → NFD → strip combining marks
  → collapse non-alphanumerics → trim) before matching. An exact `===` silently misses
  real upsets. There are **4 join sites** that must all use the normalized compare:
  web build loop, web GameDetail effect, mobile buildChatContext loop, mobile
  `app/game/[id].tsx` card. Server helper is `normFighter`; clients inline the same `nf`.
- Real UFC game label form = `` `${away} @ ${home}` `` (matches realOdds/realGames).

## Upset semantics
- An upset = the **data-favored fighter (`lean.side`) is ALSO the plus-money dog**
  (real h2h price `>= +100`). Surfaced as `lean.upset = { dogOdds }` + a 🚨 badge.
  Coach prompt (chat.ts) documents `context.fightAnalysis` (keyed by the game label)
  and the upset, with explicit non-fabrication + boxing-out-of-scope guards.

## Build/verify quirks
- api-server has NO file watcher — RESTART "artifacts/api-server: API Server" after
  ufc.ts/routes/chat.ts edits or it serves stale compiled code.
- Web gate = Vite build (`PORT=5000 BASE_PATH=/ ... run build`), NOT tsc (whole
  ParlayBuilder is implicit-any, ~1400 pre-existing errors — not a gate). Mobile tsc IS
  clean (0) and is the mobile gate.
