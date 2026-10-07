import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRosterGrounding,
  extractMentionedSeasonYear,
  extractPlayerTeamClaims,
  resolveCurrentSeasonYear,
  ROSTER_GROUNDING_SYSTEM_RULE,
  wantsRosterGrounding,
} from "../src/lib/rosterGrounding.ts";

const LIKELY_MONANGAI_ASK =
  "Yes Isaiah likely plays for the New York Giants and Kyle Monangai plays for the Chicago Bears in 2026 NFL football seasons";

test("wantsRosterGrounding detects future/current-season roster claims", () => {
  assert.equal(wantsRosterGrounding(LIKELY_MONANGAI_ASK), true);
  assert.equal(wantsRosterGrounding("who is on the Bears roster?"), true);
  assert.equal(wantsRosterGrounding("build me a 6 leg NFL parlay"), false);
});

test("extractMentionedSeasonYear reads 2026 from the production example", () => {
  assert.equal(extractMentionedSeasonYear(LIKELY_MONANGAI_ASK), 2026);
});

test("extractPlayerTeamClaims parses Likely (lowercase) and Monangai", () => {
  const claims = extractPlayerTeamClaims(LIKELY_MONANGAI_ASK);
  assert.ok(claims.length >= 2, `expected ≥2 claims, got ${JSON.stringify(claims)}`);
  const byPlayer = Object.fromEntries(
    claims.map((c) => [c.player.toLowerCase(), c.claimedTeam?.toLowerCase() ?? ""]),
  );
  assert.ok(
    Object.keys(byPlayer).some((p) => p.includes("isaiah") && p.includes("likely")),
    `missing Isaiah Likely in ${JSON.stringify(claims)}`,
  );
  assert.ok(
    Object.keys(byPlayer).some((p) => p.includes("kyle") && p.includes("monangai")),
    `missing Kyle Monangai in ${JSON.stringify(claims)}`,
  );
  assert.ok(
    Object.values(byPlayer).some((t) => t.includes("giant")),
    `missing Giants claim in ${JSON.stringify(claims)}`,
  );
  assert.ok(
    Object.values(byPlayer).some((t) => t.includes("bear")),
    `missing Bears claim in ${JSON.stringify(claims)}`,
  );
});

test("resolveCurrentSeasonYear uses fall start-year labeling for NFL", () => {
  assert.equal(resolveCurrentSeasonYear("nfl", new Date("2026-10-07T12:00:00Z")), 2026);
  assert.equal(resolveCurrentSeasonYear("nfl", new Date("2026-02-01T12:00:00Z")), 2025);
});

test("buildRosterGrounding confirms Likely→Giants and Monangai→Bears for 2026", async () => {
  const fetchPlayer = async (query: string, preferSport: string | null) => {
    const q = query.toLowerCase();
    if (q.includes("likely")) {
      return {
        athleteId: "4361050",
        name: "Isaiah Likely",
        team: "New York Giants",
        sport: preferSport || "nfl",
        seasonYearFromLeague: 2026,
      };
    }
    if (q.includes("monangai")) {
      return {
        athleteId: "4608686",
        name: "Kyle Monangai",
        team: "Chicago Bears",
        sport: preferSport || "nfl",
        seasonYearFromLeague: 2026,
      };
    }
    return null;
  };

  const grounding = await buildRosterGrounding(LIKELY_MONANGAI_ASK, {
    now: new Date("2026-10-07T12:00:00Z"),
    fetchPlayer,
  });
  assert.ok(grounding, "expected roster grounding payload");
  assert.equal(grounding!.seasonYear, 2026);
  assert.equal(grounding!.sport, "nfl");
  assert.equal(grounding!.entries.length, 2);

  const likely = grounding!.entries.find((e) => e.name === "Isaiah Likely");
  const monangai = grounding!.entries.find((e) => e.name === "Kyle Monangai");
  assert.ok(likely?.verified);
  assert.equal(likely?.team, "New York Giants");
  assert.equal(likely?.claimMatchesProvider, true);
  assert.ok(monangai?.verified);
  assert.equal(monangai?.team, "Chicago Bears");
  assert.equal(monangai?.claimMatchesProvider, true);

  const blob = grounding!.facts.join("\n");
  assert.match(blob, /Isaiah Likely/i);
  assert.match(blob, /New York Giants/i);
  assert.match(blob, /Kyle Monangai/i);
  assert.match(blob, /Chicago Bears/i);
  assert.match(blob, /2026/);
  assert.doesNotMatch(blob, /June 2024|data cutoff|Ravens|Rutgers/i);
});

test("buildRosterGrounding does not invent a team when ESPN misses", async () => {
  const grounding = await buildRosterGrounding(
    "Does Brandon Fisher play for the Mets in 2026 MLB?",
    {
      now: new Date("2026-10-07T12:00:00Z"),
      fetchPlayer: async () => null,
    },
  );
  assert.ok(grounding);
  assert.equal(grounding!.entries[0]?.verified, false);
  assert.equal(grounding!.entries[0]?.team, null);
  assert.match(grounding!.facts.join(" "), /could not currently verify/i);
});

test("ROSTER_GROUNDING_SYSTEM_RULE bans knowledge-cutoff evidence", () => {
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /NEVER cite a model knowledge-cutoff/i);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /June 2024/);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /cannot currently verify/i);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /seasonYear/);
});
