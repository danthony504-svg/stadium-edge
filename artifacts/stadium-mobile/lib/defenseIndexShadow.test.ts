/**
 * Stage 4 P1 — shadow defenseIndex comparison (no seating writes).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildDefenseIndexByFamily } from "./defenseIndexFromPack.ts";
import {
  approxHitFromMeanStd,
  clearDefenseIndexShadowReports,
  drainDefenseIndexShadowReports,
  normalCdf,
  recordDefenseIndexShadow,
  shadowMeanFromBaseline,
} from "./defenseIndexShadow.ts";
import type { FootballOppDefenseSlice } from "./footballRushDefense.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "stage4");

test("normalCdf / approxHitFromMeanStd sanity", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 0.01);
  assert.ok(normalCdf(3) > 0.99);
  const mid = approxHitFromMeanStd({
    mean: 50,
    stdDev: 15,
    line: 49.5,
    side: "Over",
  });
  assert.ok(mid != null && mid > 0.45 && mid < 0.55);
});

test("JAX rush: baseline vs shadow — defenseIndex alone, no vsOpp re-apply", () => {
  clearDefenseIndexShadowReports();
  const fixture = JSON.parse(
    readFileSync(join(FIX, "jax-jaguars-defense.json"), "utf8"),
  ) as { teamId: string; pack: FootballOppDefenseSlice };

  // Representative RB rush Over vs JAX (stingy). Baseline mean from live 10K
  // already embeds whatever vsOpp/venue the server applied — shadow multiplies
  // defenseIndex only (shadowAvoidsVsOppDoubleCount).
  const baselineMean = 72;
  const stdDev = 22;
  const line = 64.5;
  const baselineHit = approxHitFromMeanStd({
    mean: baselineMean,
    stdDev,
    line,
    side: "Over",
  });

  const report = recordDefenseIndexShadow({
    props: [
      {
        sport: "nfl",
        opponentTeamId: fixture.teamId,
        athleteId: "jax-rb-fixture",
        eventId: "hou-at-jax",
        player: "Fixture RB",
        market: "player_rush_yds",
        side: "Over",
        line,
        baselineHit,
        baselineMean,
        stdDev,
        pack: fixture.pack,
      },
    ],
  });

  assert.equal(report.rows.length, 1);
  const row = report.rows[0]!;
  assert.equal(row.defenseIndex, 0.9);
  assert.equal(row.shadowAvoidsVsOppDoubleCount, true);
  assert.equal(row.lineage.method, "local_normal_cdf");
  assert.ok(row.shadowMean != null);
  assert.equal(row.shadowMean, shadowMeanFromBaseline(baselineMean, 0.9));
  assert.ok(row.shadowHit != null && row.baselineHit != null);
  assert.ok(
    row.shadowHit! < row.baselineHit!,
    `stingy D should lower Over hit: base=${row.baselineHit} shadow=${row.shadowHit}`,
  );
  assert.ok(row.deltaHit != null && row.deltaHit! < 0);
  assert.equal(row.identity.athleteId, "jax-rb-fixture");
  assert.equal(row.identity.market, "player_rush_yds");
  assert.equal(row.identity.line, line);

  // Drain must not be readable as seating input — Coach never imports drain into propHits.
  const drained = drainDefenseIndexShadowReports();
  assert.equal(drained.length, 1);
  assert.equal(drainDefenseIndexShadowReports().length, 0);
});

test("shadow does not invent mean when std/mean missing", () => {
  clearDefenseIndexShadowReports();
  const fixture = JSON.parse(
    readFileSync(join(FIX, "jax-jaguars-defense.json"), "utf8"),
  ) as { teamId: string; pack: FootballOppDefenseSlice };
  const report = recordDefenseIndexShadow({
    props: [
      {
        sport: "nfl",
        opponentTeamId: fixture.teamId,
        market: "player_rush_yds",
        side: "Over",
        line: 50,
        baselineHit: 0.55,
        baselineMean: null,
        stdDev: null,
        pack: fixture.pack,
      },
    ],
  });
  assert.equal(report.rows[0]!.shadowHit, null);
  assert.ok(report.rows[0]!.skippedReason?.includes("missing_mean"));
});

test("anytime_td excluded from shadow index", () => {
  clearDefenseIndexShadowReports();
  const fixture = JSON.parse(
    readFileSync(join(FIX, "jax-jaguars-defense.json"), "utf8"),
  ) as { teamId: string; pack: FootballOppDefenseSlice };
  const report = recordDefenseIndexShadow({
    props: [
      {
        sport: "nfl",
        opponentTeamId: fixture.teamId,
        market: "player_anytime_td",
        side: "Over",
        line: 0.5,
        baselineHit: 0.42,
        baselineMean: 0.45,
        stdDev: 0.2,
        pack: fixture.pack,
      },
    ],
  });
  assert.equal(report.rows[0]!.defenseIndex, null);
  assert.ok(report.rows[0]!.skippedReason);
});

test("row cap bounds CPU", () => {
  clearDefenseIndexShadowReports();
  const fixture = JSON.parse(
    readFileSync(join(FIX, "jax-jaguars-defense.json"), "utf8"),
  ) as { teamId: string; pack: FootballOppDefenseSlice };
  const props = Array.from({ length: 30 }, (_, i) => ({
    sport: "nfl",
    opponentTeamId: fixture.teamId,
    market: "player_rush_yds" as const,
    side: "Over" as const,
    line: 40 + i,
    baselineHit: 0.5,
    baselineMean: 55,
    stdDev: 18,
    pack: fixture.pack,
  }));
  const report = recordDefenseIndexShadow({ props, maxRows: 12 });
  assert.equal(report.rows.length, 12);
  assert.ok(report.metrics.elapsedMs < 200);
});

test("double-count safeguard: shadow mean = baseline × index only", () => {
  // If baseline already included a matchup tilt in the mean, shadow must NOT
  // multiply by vsOpp again — only by defenseIndex.
  const mean = 80;
  const idx = 0.9;
  assert.equal(shadowMeanFromBaseline(mean, idx), 72);
  const built = buildDefenseIndexByFamily({
    sport: "nfl",
    opponentTeamId: "30",
    oppPack: JSON.parse(
      readFileSync(join(FIX, "jax-jaguars-defense.json"), "utf8"),
    ).pack,
  });
  // Mapper itself does not apply vs-opponent series.
  assert.ok(!("vsOpponent" in built.defenseIndexByFamily));
});
