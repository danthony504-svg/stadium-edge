---
name: Park Weather Report (mobile)
description: Honesty contract + shape of the MLB Park Weather feature (OpenWeather-backed) and its deterministic impact rating.
---

# Park Weather Report (mobile)

Mobile screen `app/(tabs)/weather.tsx` shows REAL OpenWeather current + multi-day
forecast per today's MLB game, plus a deterministic calc-only "AI Weather Impact"
rating. Server route GET `/api/weather/parks?sport=mlb` (api-server
`routes/weather.ts`), park coords/meta + pure `computeWeatherImpact` in
`lib/parks.ts`, contract in `lib/api-spec/openapi.yaml` (operationId
`getParkWeather`), mobile types hand-written in `lib/api.ts` (raw getJson, not
generated hooks).

## Honesty rules (the whole point of the feature)
- **Every OpenWeather field is nullable end-to-end.** Never default a missing
  reading to `?? 0` / `"Clear"` / `0%`. If OpenWeather omits it, emit `null` and
  render "Not reported" (current tiles) or filter the bit out (game list /
  forecast subtitle). This was the blocking code-review failure on v1.
- **Impact calc omits absent factors** from BOTH the score and the prose summary.
  Unknown precip is omitted, NOT treated as 0 (no false penalty / no fabricated
  "0% rain"). If temp AND precip are both null → honest "limited readings" Neutral
  instead of inventing a verdict.
- **Wind is bearing-only.** We have NO park orientation, so never say wind "blows
  out to RF". Report compass direction (`degToCompass`) + speed only; drop the
  "out of the <dir>" clause when windDir is null. Wind speed never moves the rating.
- Roofed/dome parks → always Neutral with a roof summary.
- A game whose home park can't be resolved is skipped, never invented.

**Why:** foundational project mandate is never fabricate data; weather fallbacks
are the classic silent-fabrication trap (a `?? 0` reads as a real reading).

**How to apply:** any new weather field or surface must thread nullability through
parks.ts → weather.ts → openapi.yaml (`["type","null"]`, re-run api-spec codegen)
→ mobile api.ts type → null-safe render. Server validates with
`GetParkWeatherResponse.parse()` so a shape mismatch is a 502, not a silent pass.
Unit tests live in `api-server/test/parks.test.ts` (run via the `--import
./test/register-hooks.mjs --test` harness); add a null-path case for new factors.
api-server dev is one-shot build+start (no watcher) — restart after route edits.
