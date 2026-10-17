import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyMatchupSubdivision,
  classifyTeamSubdivision,
  isFbsFbsGame,
  listTransitionTeams,
  loadSubdivisionFixture,
  resetSubdivisionFixtureCache,
} from "../src/lib/sportSim/ncaafSubdivision.ts";
import {
  NcaafOppAdjRatings,
  predictTeamStrength,
  TEAM_STRENGTH_FULL,
} from "../src/lib/sportSim/ncaafTeamStrength.ts";

test("fixture loads; no FBS∩FCS overlap; season counts", () => {
  resetSubdivisionFixtureCache();
  const fix = loadSubdivisionFixture();
  assert.equal(Object.keys(fix.seasons["2024"]!.fbs).length, 134);
  assert.equal(Object.keys(fix.seasons["2025"]!.fbs).length, 136);
  assert.equal(Object.keys(fix.seasons["2023"]!.fbs).length, 133);
});

test("Delaware transition: FCS 2023–2024, FBS 2025", () => {
  assert.equal(classifyTeamSubdivision("48", 2023), "fcs");
  assert.equal(classifyTeamSubdivision("48", 2024), "fcs");
  assert.equal(classifyTeamSubdivision("48", 2025), "fbs");
  const t = listTransitionTeams().find((x) => x.teamId === "48");
  assert.ok(t);
  assert.equal(t!.path["2025"], "fbs");
});

test("Kennesaw / Missouri State transitions", () => {
  assert.equal(classifyTeamSubdivision("338", 2023), "fcs");
  assert.equal(classifyTeamSubdivision("338", 2024), "fbs");
  assert.equal(classifyTeamSubdivision("2623", 2024), "fcs");
  assert.equal(classifyTeamSubdivision("2623", 2025), "fbs");
});

test("previously misclassified FCS ids are verified FCS (not unknown, not FBS)", () => {
  // Audit gaps under the old name heuristic
  const mustBeFcs2025 = [
    ["2210", "Elon"],
    ["227", "Rhode Island"],
    ["2029", "Arkansas-Pine Bluff"],
    ["2448", "North Carolina A&T"],
    ["2717", "Western Carolina"],
    ["2523", "Robert Morris"],
    ["2193", "East Tennessee State"],
    ["2502", "Portland State"],
    ["282", "Indiana State"],
    ["2466", "Northwestern State"],
    ["302", "UC Davis"],
    ["2320", "Lamar"],
    ["2803", "Bryant"], // was unflagged missing-seed
  ] as const;
  for (const [id] of mustBeFcs2025) {
    assert.equal(
      classifyTeamSubdivision(id, 2025),
      "fcs",
      `expected FCS for ${id}`,
    );
  }
});

test("unknown team id stays unknown (not inferred FBS/FCS)", () => {
  assert.equal(classifyTeamSubdivision("999999999", 2025), "unknown");
  assert.equal(
    classifyMatchupSubdivision("999999999", "2", 2025),
    "involves_unknown",
  );
});

test("Grambling / Howard are FCS 2025; OSU FBS; matchup is fbs_fcs", () => {
  // Resolve by fixture names
  const fix = loadSubdivisionFixture();
  const fcs = fix.seasons["2025"]!.fcs;
  const fbs = fix.seasons["2025"]!.fbs;
  const grambling = Object.entries(fcs).find(([, n]) => /grambling/i.test(n));
  const howard = Object.entries(fcs).find(([, n]) => /^Howard\b/i.test(n));
  const osu = Object.entries(fbs).find(([, n]) => /Ohio State/i.test(n));
  assert.ok(grambling);
  assert.ok(howard);
  assert.ok(osu);
  assert.equal(classifyMatchupSubdivision(osu![0], grambling![0], 2025), "fbs_fcs");
  assert.ok(!isFbsFbsGame(osu![0], grambling![0], 2025));
  assert.ok(isFbsFbsGame(osu![0], Object.keys(fbs).find((id) => id !== osu![0])!, 2025));
});

test("seed skips FCS games; unrated teams do not invent predictive μ", () => {
  const fix = loadSubdivisionFixture();
  const fbsIds = Object.keys(fix.seasons["2024"]!.fbs);
  const fcsIds = Object.keys(fix.seasons["2024"]!.fcs);
  const a = fbsIds[0]!;
  const b = fbsIds[1]!;
  const c = fcsIds[0]!;
  const ratings = new NcaafOppAdjRatings();
  ratings.seedFromPrior([
    {
      homeTeamId: a,
      awayTeamId: b,
      homeFg: 31,
      awayFg: 17,
      season: 2024,
    },
    // FCS pollution attempt — must not seed c or pollute via cupcake
    {
      homeTeamId: a,
      awayTeamId: c,
      homeFg: 70,
      awayFg: 0,
      season: 2024,
    },
  ]);
  assert.equal(ratings.hasRating(a), true);
  assert.equal(ratings.hasRating(b), true);
  assert.equal(ratings.hasRating(c), false);

  const live = ratings.clone();
  // Predict FBS–FCS: FCS unrated → null (no default-24 μ)
  assert.equal(
    predictTeamStrength({
      seed: ratings,
      live,
      homeId: a,
      awayId: c,
      week: 1,
      components: TEAM_STRENGTH_FULL,
    }),
    null,
  );

  // Update on FCS game must not create ratings for c or change seasonN for pollution path
  const offBefore = live.getOff(a);
  live.update({
    homeTeamId: a,
    awayTeamId: c,
    homeFg: 70,
    awayFg: 0,
    season: 2025,
    week: 1,
  });
  assert.equal(live.hasRating(c), false);
  assert.equal(live.getSeasonN(a), 0);
  assert.equal(live.getOff(a), offBefore);

  // FBS–FBS update establishes chronological ratings
  const pred = predictTeamStrength({
    seed: ratings,
    live,
    homeId: a,
    awayId: b,
    week: 2,
    components: TEAM_STRENGTH_FULL,
  });
  assert.ok(pred);
  live.update({
    homeTeamId: a,
    awayTeamId: b,
    homeFg: 28,
    awayFg: 21,
    season: 2025,
    week: 2,
  });
  assert.equal(live.getSeasonN(a), 1);
  assert.equal(live.getSeasonN(b), 1);
});

test("Delaware has no 2024 FBS seed; 2025 first predict stays unrated until FBS–FBS update", () => {
  const fix = loadSubdivisionFixture();
  const fbs2024 = Object.keys(fix.seasons["2024"]!.fbs);
  const ratings = new NcaafOppAdjRatings();
  ratings.seedFromPrior(
    fbs2024.slice(0, 4).flatMap((home, i, arr) => {
      const away = arr[(i + 1) % arr.length]!;
      return [
        {
          homeTeamId: home,
          awayTeamId: away,
          homeFg: 24,
          awayFg: 21,
          season: 2024 as const,
        },
      ];
    }),
  );
  assert.equal(ratings.hasRating("48"), false); // Delaware
  const live = ratings.clone();
  const opp = fbs2024[0]!;
  assert.equal(
    predictTeamStrength({
      seed: ratings,
      live,
      homeId: "48",
      awayId: opp,
      week: 1,
      components: TEAM_STRENGTH_FULL,
    }),
    null,
  );
  live.update({
    homeTeamId: "48",
    awayTeamId: opp,
    homeFg: 17,
    awayFg: 24,
    season: 2025,
    week: 1,
  });
  assert.equal(live.hasRating("48"), true);
  assert.equal(live.hasRating(opp), true);
});
