import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRosterGrounding,
  extractMentionedSeasonYear,
  extractNamedPlayers,
  extractPlayerTeamClaims,
  resolveCurrentSeasonYear,
  ROSTER_GROUNDING_SYSTEM_RULE,
  wantsRosterGrounding,
} from "../src/lib/rosterGrounding.ts";

const LIKELY_MONANGAI_ASK =
  "Yes Isaiah likely plays for the New York Giants and Kyle Monangai plays for the Chicago Bears in 2026 NFL football seasons";

const FETCH_FIXTURES: Record<
  string,
  {
    athleteId: string;
    name: string;
    team: string;
    sport: string;
    seasonYearFromLeague: number;
    isActive: boolean;
  }
> = {
  "ashton jeanty": {
    athleteId: "4890973",
    name: "Ashton Jeanty",
    team: "Las Vegas Raiders",
    sport: "nfl",
    seasonYearFromLeague: 2026,
    isActive: true,
  },
  "kyle monangai": {
    athleteId: "4608686",
    name: "Kyle Monangai",
    team: "Chicago Bears",
    sport: "nfl",
    seasonYearFromLeague: 2026,
    isActive: true,
  },
  "brian robinson jr": {
    athleteId: "4429013",
    name: "Brian Robinson Jr.",
    team: "Atlanta Falcons",
    sport: "nfl",
    seasonYearFromLeague: 2026,
    isActive: true,
  },
  "brian robinson jr.": {
    athleteId: "4429013",
    name: "Brian Robinson Jr.",
    team: "Atlanta Falcons",
    sport: "nfl",
    seasonYearFromLeague: 2026,
    isActive: true,
  },
  "isaiah likely": {
    athleteId: "4361050",
    name: "Isaiah Likely",
    team: "New York Giants",
    sport: "nfl",
    seasonYearFromLeague: 2026,
    isActive: true,
  },
};

async function fixtureFetch(query: string, preferSport: string | null) {
  const key = query.toLowerCase().replace(/\./g, "").trim();
  const hit =
    FETCH_FIXTURES[key] ||
    Object.values(FETCH_FIXTURES).find((f) =>
      f.name.toLowerCase().replace(/\./g, "").includes(key.replace(/\./g, "")),
    );
  if (!hit) return null;
  return { ...hit, sport: preferSport || hit.sport };
}

test("wantsRosterGrounding detects identity asks without plays-for claims", () => {
  assert.equal(wantsRosterGrounding("Is Ashton Jeanty an NFL player?"), true);
  assert.equal(
    wantsRosterGrounding("Is Kyle Monangai currently on an active NFL roster?"),
    true,
  );
  assert.equal(
    wantsRosterGrounding("Does Brian Robinson Jr. still play for Washington?"),
    true,
  );
  assert.equal(wantsRosterGrounding("Ashton Jeanty rushing yards over"), true);
  assert.equal(wantsRosterGrounding(LIKELY_MONANGAI_ASK), true);
  assert.equal(wantsRosterGrounding("build me a 6 leg NFL parlay"), false);
});

test("extractNamedPlayers pulls Jeanty / Monangai / Robinson / Likely", () => {
  assert.deepEqual(extractNamedPlayers("Is Ashton Jeanty an NFL player?"), [
    "Ashton Jeanty",
  ]);
  assert.ok(
    extractNamedPlayers("Is Kyle Monangai currently on an active NFL roster?").some((n) =>
      /kyle monangai/i.test(n),
    ),
  );
  assert.ok(
    extractNamedPlayers("Does Brian Robinson Jr. still play for Washington?").some((n) =>
      /brian robinson/i.test(n),
    ),
  );
  assert.ok(
    extractNamedPlayers(LIKELY_MONANGAI_ASK).some((n) => /isaiah likely/i.test(n)),
  );
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
});

test("resolveCurrentSeasonYear uses fall start-year labeling for NFL", () => {
  assert.equal(resolveCurrentSeasonYear("nfl", new Date("2026-10-07T12:00:00Z")), 2026);
  assert.equal(resolveCurrentSeasonYear("nfl", new Date("2026-02-01T12:00:00Z")), 2025);
});

test("buildRosterGrounding: Ashton Jeanty is an active NFL Raider for 2026", async () => {
  const g = await buildRosterGrounding("Is Ashton Jeanty an NFL player?", {
    now: new Date("2026-10-07T12:00:00Z"),
    fetchPlayer: fixtureFetch,
  });
  assert.ok(g);
  assert.equal(g!.seasonYear, 2026);
  const e = g!.entries.find((x) => /jeanty/i.test(x.name || x.query));
  assert.ok(e?.verified);
  assert.equal(e?.team, "Las Vegas Raiders");
  assert.equal(e?.isActive, true);
  assert.ok(g!.verifiedCurrentFacts.some((f) => f.player === "Ashton Jeanty" && f.verified));
  assert.doesNotMatch(g!.facts.join(" "), /not an NFL player|college only|Boise/i);
});

test("buildRosterGrounding: Kyle Monangai is on the Bears active roster", async () => {
  const g = await buildRosterGrounding(
    "Is Kyle Monangai currently on an active NFL roster?",
    {
      now: new Date("2026-10-07T12:00:00Z"),
      fetchPlayer: fixtureFetch,
    },
  );
  assert.ok(g);
  const e = g!.entries.find((x) => /monangai/i.test(x.name || x.query));
  assert.ok(e?.verified);
  assert.equal(e?.team, "Chicago Bears");
  assert.equal(e?.isActive, true);
  assert.match(g!.facts.join(" "), /Chicago Bears/i);
  assert.doesNotMatch(g!.facts.join(" "), /not currently on an active|Rutgers/i);
});

test("buildRosterGrounding: Brian Robinson Jr. is on Atlanta, not Washington", async () => {
  const g = await buildRosterGrounding(
    "Does Brian Robinson Jr. still play for Washington?",
    {
      now: new Date("2026-10-07T12:00:00Z"),
      fetchPlayer: fixtureFetch,
    },
  );
  assert.ok(g);
  const e = g!.entries.find((x) => /robinson/i.test(x.name || x.query));
  assert.ok(e?.verified);
  assert.equal(e?.team, "Atlanta Falcons");
  assert.equal(e?.claimMatchesProvider, false);
  assert.match(g!.facts.join(" "), /Atlanta Falcons/i);
  assert.match(g!.facts.join(" "), /does NOT match provider/i);
  assert.doesNotMatch(
    g!.verifiedCurrentFacts.map((f) => f.team).join(" "),
    /Washington/i,
  );
});

test("buildRosterGrounding confirms Likely→Giants and Monangai→Bears for 2026", async () => {
  const grounding = await buildRosterGrounding(LIKELY_MONANGAI_ASK, {
    now: new Date("2026-10-07T12:00:00Z"),
    fetchPlayer: fixtureFetch,
  });
  assert.ok(grounding, "expected roster grounding payload");
  assert.equal(grounding!.seasonYear, 2026);
  assert.equal(grounding!.sport, "nfl");
  assert.ok(grounding!.entries.length >= 2);

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

test("verifiedCurrentFacts attach prop market/line/odds without inventing roster", async () => {
  const g = await buildRosterGrounding("Ashton Jeanty rushing yards tonight", {
    now: new Date("2026-10-07T12:00:00Z"),
    fetchPlayer: fixtureFetch,
    realProps: [
      {
        player: "Ashton Jeanty",
        sport: "nfl",
        game: "Las Vegas Raiders @ Denver Broncos",
        market: "player_rush_yds",
        line: 72.5,
        overOdds: -115,
        team: "Las Vegas Raiders",
        athleteId: "4890973",
      },
    ],
  });
  assert.ok(g);
  const fact = g!.verifiedCurrentFacts.find((f) => f.player === "Ashton Jeanty");
  assert.ok(fact);
  assert.equal(fact!.season, 2026);
  assert.equal(fact!.team, "Las Vegas Raiders");
  assert.equal(fact!.opponent, "Denver Broncos");
  assert.equal(fact!.game, "Las Vegas Raiders @ Denver Broncos");
  assert.equal(fact!.market, "player_rush_yds");
  assert.equal(fact!.line, 72.5);
  assert.equal(fact!.odds, -115);
  assert.equal(fact!.provider, "stadium_edge_realProps+espn_player_search");
  assert.ok(fact!.dataTimestamp);
  assert.equal(fact!.verified, true);
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

test("ROSTER_GROUNDING_SYSTEM_RULE bans knowledge-cutoff and stale roster overrides", () => {
  assert.match(
    ROSTER_GROUNDING_SYSTEM_RULE,
    /supplied live context is authoritative and overrides pretrained model knowledge/i,
  );
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /Never reject a player, team, roster assignment/i);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /NEVER cite a model knowledge-cutoff/i);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /June 2024/);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /not an NFL player/i);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /cannot currently verify/i);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /seasonYear/);
  assert.match(ROSTER_GROUNDING_SYSTEM_RULE, /verifiedCurrentFacts/);
});
