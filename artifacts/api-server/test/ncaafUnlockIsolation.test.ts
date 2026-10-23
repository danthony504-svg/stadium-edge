import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/,
  "",
);
const { build } = createRequire(root + "/artifacts/api-server/package.json")(
  "esbuild",
);
async function isolated(unlocked) {
  const result = await build({
    stdin: {
      contents: `export * from './coachP0UnvalidatedTotals.ts'; export * from './simMarketSupport.ts'; export {evaluateHistoricalNcaafAcceptance} from ${JSON.stringify(root + '/artifacts/api-server/src/lib/sportSim/ncaafHistoricalAcceptance.ts')};`,
      resolveDir: root + "/artifacts/stadium-mobile/lib",
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "test-only-unlock",
        setup(b) {
          b.onLoad({ filter: /coachP0UnvalidatedTotals\.ts$/ }, async (a) => ({
            contents: (await readFile(a.path, "utf8")).replace(
              "NCAAF_GAME_LINE_SIM_VALIDATED = false",
              "NCAAF_GAME_LINE_SIM_VALIDATED = " + unlocked,
            ),
            loader: "ts",
          }));
        },
      },
    ],
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}
test("isolated NCAAF unlock preserves period restrictions and separate acceptance requirements", async () => {
  const locked = await isolated(false),
    unlocked = await isolated(true);
  for (const market of ["Moneyline", "Spread", "Alt Spread"]) {
    const pick = { sport: "ncaaf", market };
    assert.equal(locked.p0UnvalidatedSimDecision(pick)?.accept, false);
    assert.equal(unlocked.p0UnvalidatedSimDecision(pick), null);
  }
  for (const sport of ["ncaaf", "cfb"])
    for (const market of ["Total", "Team Total", "First Half Total"])
      assert.equal(
        unlocked.p0UnvalidatedSimDecision({ sport, market })?.accept,
        false,
      );
  for (const sport of ["ncaaf", "cfb", "college-football", "NCAAF"])
    for (const market of [
      "Q1 Spread",
      "First Half Moneyline",
      "Second Half Spread",
      "spreads_q2",
      "totals_h1",
      "Q1 Team Total",
    ]) {
      assert.equal(unlocked.marketSupportsSimulation(market, { sport }), false);
      assert.equal(unlocked.simMarketMappingIsValid({ market, sport }), false);
    }
  assert.equal(
    unlocked.p0UnvalidatedSimDecision({ market: "Spread" })?.accept,
    false,
  );
  assert.equal(
    locked.p0UnvalidatedSimDecision({
      sport: "ncaaf",
      market: "Player Passing Yards",
      isProp: true,
      propMarketKey: "player_pass_yds",
    }),
    null,
  );
  assert.equal(
    unlocked.p0UnvalidatedSimDecision({ sport: "nfl", market: "Moneyline" }),
    null,
  );
  const rows = Array.from({ length: 500 }, (_, i) => {
    const season = i < 250 ? 2024 : 2025;
    return {
      gameId: "SYNTHETIC-TEST-ONLY-" + i,
      season,
      playedAt: season + "-10-04T18:00:00Z",
      homeScore: 28,
      awayScore: 21,
      closingHomeSpread: -3.5,
      closingHomePrice: -110,
      closingAwayPrice: -110,
      predictedHomeCoverProbability: 0.7,
      predictedHomeWinProbability: 0.7,
      predictedHomeScore: 28,
      predictedAwayScore: 21,
      injurySourceTimestamp: season + "-10-03T18:00:00Z",
      source: "SYNTHETIC-LOGIC-TEST-NOT-VALIDATION",
      forecastAt: season + "-10-04T16:00:00Z",
      inputCutoffAt: season + "-10-04T15:00:00Z",
      quoteObservedAt: season + "-10-04T14:00:00Z",
      settlement: "full_game_including_overtime",
      modelVersion: "SYNTHETIC-TEST-ONLY",
    };
  });
  const opts = {
    marketBaselineBrier: 0.25,
    independentHoldoutVerified: true,
    exactLineBindingVerified: true,
    injuryConservatismVerified: true,
    humanSignoff: true,
  };
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance(rows, opts).eligible,
    true,
  );
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance(rows.slice(0, 499), opts)
      .eligible,
    false,
  );
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance(
      rows.map((x) => ({ ...x, season: 2025 })),
      opts,
    ).eligible,
    false,
  );
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance(rows, {
      ...opts,
      independentHoldoutVerified: false,
    }).eligible,
    false,
  );
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance(
      rows.map((x) => ({ ...x, forecastAt: x.playedAt })),
      opts,
    ).eligible,
    false,
  );
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance(
      rows.map((x) => ({ ...x, predictedHomeCoverProbability: 0.1 })),
      opts,
    ).eligible,
    false,
  );
  assert.equal(
    unlocked.evaluateHistoricalNcaafAcceptance([], opts).eligible,
    false,
  );
  assert.match(
    await readFile(
      root + "/artifacts/stadium-mobile/lib/coachP0UnvalidatedTotals.ts",
      "utf8",
    ),
    /NCAAF_GAME_LINE_SIM_VALIDATED = false/,
  );
  console.log(
    JSON.stringify(
      {
        isolatedUnlock: "PASS",
        fullGameSides: "open only in test bundle",
        totals: "still blocked",
        footballPeriods: "still unsupported",
        incompleteAndPostgameEvidence: "rejected",
        syntheticAcceptancePath: "PASS — not validation",
        productionFlag: "unchanged false",
      },
      null,
      2,
    ),
  );
});
