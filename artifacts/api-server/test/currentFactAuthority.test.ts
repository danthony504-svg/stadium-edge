/**
 * Multi-sport current-fact grounding regressions.
 *
 * Fixtures intentionally conflict with older pretrained knowledge (trades,
 * transfers, rookies, new clubs, current tournaments). Coach must project the
 * live rows — never substitute historical memory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_COACH_SPORTS,
  CURRENT_FACT_AUTHORITY_RULE,
  buildCurrentFactGroundingPayload,
  projectLiveContextFacts,
  resolveProviderLeagueSport,
} from "../src/lib/currentFactAuthority.ts";
import {
  buildRosterGrounding,
  detectSportHint,
  wantsRosterGrounding,
} from "../src/lib/rosterGrounding.ts";
import { trimLockedContextForDirectOpenAI } from "../src/lib/coachSystemPrompt.ts";

const NOW = new Date("2026-10-07T12:00:00Z");

/** Current-season fixtures that conflict with older model knowledge. */
const SPORT_CONFLICT_FIXTURES: Array<{
  sport: string;
  ask: string;
  staleMemoryWrong: RegExp;
  live: {
    playerName: string;
    currentTeam: string | null;
    opponent: string | null;
    market?: string | null;
    line?: number | null;
    game?: string | null;
    eventId?: string | null;
  };
}> = [
  {
    sport: "nfl",
    ask: "Does Ashton Jeanty play for Boise State?",
    staleMemoryWrong: /Boise State/i,
    live: {
      playerName: "Ashton Jeanty",
      currentTeam: "Las Vegas Raiders",
      opponent: "Denver Broncos",
      market: "player_rush_yds",
      line: 72.5,
      game: "Las Vegas Raiders @ Denver Broncos",
      eventId: "nfl-2026-lv-den",
    },
  },
  {
    sport: "ncaaf",
    ask: "Is Arch Manning still at Texas?",
    staleMemoryWrong: /Georgia|Alabama/i,
    live: {
      playerName: "Arch Manning",
      currentTeam: "Texas Longhorns",
      opponent: "Oklahoma Sooners",
      market: "player_pass_yds",
      line: 245.5,
      game: "Oklahoma Sooners @ Texas Longhorns",
      eventId: "ncaaf-2026-ou-tex",
    },
  },
  {
    sport: "nba",
    ask: "Does Luka Doncic still play for the Mavericks?",
    staleMemoryWrong: /Mavericks|Dallas/i,
    live: {
      playerName: "Luka Doncic",
      currentTeam: "Los Angeles Lakers",
      opponent: "Golden State Warriors",
      market: "player_points",
      line: 28.5,
      game: "Los Angeles Lakers @ Golden State Warriors",
      eventId: "nba-2026-lal-gsw",
    },
  },
  {
    sport: "wnba",
    ask: "Is Caitlin Clark on the Fever roster this season?",
    staleMemoryWrong: /Iowa|college only/i,
    live: {
      playerName: "Caitlin Clark",
      currentTeam: "Indiana Fever",
      opponent: "Las Vegas Aces",
      market: "player_points",
      line: 19.5,
      game: "Indiana Fever @ Las Vegas Aces",
      eventId: "wnba-2026-ind-lv",
    },
  },
  {
    sport: "ncaab",
    ask: "Does Cooper Flagg play for Duke?",
    staleMemoryWrong: /high school|Maine/i,
    live: {
      playerName: "Cooper Flagg",
      currentTeam: "Duke Blue Devils",
      opponent: "North Carolina Tar Heels",
      market: "player_points",
      line: 18.5,
      game: "Duke Blue Devils @ North Carolina Tar Heels",
      eventId: "ncaab-2026-duke-unc",
    },
  },
  {
    sport: "mlb",
    ask: "Does Juan Soto still play for the Yankees?",
    staleMemoryWrong: /Yankees|Padres|Nationals/i,
    live: {
      playerName: "Juan Soto",
      currentTeam: "New York Mets",
      opponent: "Philadelphia Phillies",
      market: "batter_total_bases",
      line: 1.5,
      game: "New York Mets @ Philadelphia Phillies",
      eventId: "mlb-2026-nym-phi",
    },
  },
  {
    sport: "nhl",
    ask: "Is Auston Matthews still on Toronto?",
    staleMemoryWrong: /retired|not active/i,
    live: {
      playerName: "Auston Matthews",
      currentTeam: "Toronto Maple Leafs",
      opponent: "Montreal Canadiens",
      market: "player_shots_on_goal",
      line: 3.5,
      game: "Montreal Canadiens @ Toronto Maple Leafs",
      eventId: "nhl-2026-mtl-tor",
    },
  },
  {
    sport: "soccer",
    ask: "Does Erling Haaland still play for Dortmund?",
    staleMemoryWrong: /Dortmund|Borussia/i,
    live: {
      playerName: "Erling Haaland",
      currentTeam: "Manchester City",
      opponent: "Arsenal",
      market: "player_goal_scorer_anytime",
      line: null,
      game: "Arsenal @ Manchester City",
      eventId: "soccer-2026-ars-mci",
    },
  },
  {
    sport: "tennis",
    ask: "Who does Carlos Alcaraz play in the current tournament?",
    staleMemoryWrong: /retired|2023 final/i,
    live: {
      playerName: "Carlos Alcaraz",
      currentTeam: null,
      opponent: "Jannik Sinner",
      market: "moneyline",
      line: null,
      game: "Carlos Alcaraz @ Jannik Sinner",
      eventId: "tennis-2026-uso-sf",
    },
  },
  {
    sport: "ufc",
    ask: "Is Islam Makhachev fighting tonight?",
    staleMemoryWrong: /retired|not on the card/i,
    live: {
      playerName: "Islam Makhachev",
      currentTeam: null,
      opponent: "Ilia Topuria",
      market: "moneyline",
      line: null,
      game: "Islam Makhachev @ Ilia Topuria",
      eventId: "ufc-2026-main",
    },
  },
];

test("CURRENT_FACT_AUTHORITY_RULE carries the shared all-sports mandate", () => {
  assert.match(
    CURRENT_FACT_AUTHORITY_RULE,
    /supplied live Stadium Edge\/provider context is authoritative and overrides pretrained model knowledge/i,
  );
  assert.match(CURRENT_FACT_AUTHORITY_RULE, /Current data could not be verified/i);
  assert.match(CURRENT_FACT_AUTHORITY_RULE, /Never reject or alter a player, team, roster assignment, transfer/i);
  assert.match(CURRENT_FACT_AUTHORITY_RULE, /NFL/);
  assert.match(CURRENT_FACT_AUTHORITY_RULE, /Soccer/);
  assert.match(CURRENT_FACT_AUTHORITY_RULE, /UFC/);
  assert.match(CURRENT_FACT_AUTHORITY_RULE, /Tennis/);
  assert.doesNotMatch(CURRENT_FACT_AUTHORITY_RULE, /Ashton Jeanty|if player ===/i);
});

test("ALL_COACH_SPORTS covers every supported Coach sport", () => {
  for (const s of [
    "nfl",
    "ncaaf",
    "nba",
    "wnba",
    "ncaab",
    "mlb",
    "nhl",
    "soccer",
    "tennis",
    "ufc",
  ]) {
    assert.ok(ALL_COACH_SPORTS.includes(s as (typeof ALL_COACH_SPORTS)[number]), s);
  }
});

test("resolveProviderLeagueSport maps soccer competition slugs without a hardcode per player", () => {
  assert.equal(resolveProviderLeagueSport("eng.1"), "soccer");
  assert.equal(resolveProviderLeagueSport("uefa.champions"), "soccer");
  assert.equal(resolveProviderLeagueSport("sco.1"), "soccer");
  assert.equal(resolveProviderLeagueSport("fifa.world"), "soccer");
  assert.equal(resolveProviderLeagueSport("nfl"), "nfl");
  assert.equal(resolveProviderLeagueSport("college-football"), "ncaaf");
  assert.equal(resolveProviderLeagueSport("atp"), "tennis");
  assert.equal(resolveProviderLeagueSport("ufc"), "ufc");
});

test("detectSportHint covers every major Coach sport cue", () => {
  assert.equal(detectSportHint("NFL props tonight"), "nfl");
  assert.equal(detectSportHint("college football parlays"), "ncaaf");
  assert.equal(detectSportHint("NBA points"), "nba");
  assert.equal(detectSportHint("WNBA"), "wnba");
  assert.equal(detectSportHint("college basketball"), "ncaab");
  assert.equal(detectSportHint("MLB strikeouts"), "mlb");
  assert.equal(detectSportHint("NHL shots"), "nhl");
  assert.equal(detectSportHint("Premier League anytime goal"), "soccer");
  assert.equal(detectSportHint("ATP French Open"), "tennis");
  assert.equal(detectSportHint("UFC main event"), "ufc");
});

for (const fx of SPORT_CONFLICT_FIXTURES) {
  test(`projectLiveContextFacts (${fx.sport}): live row wins over stale memory`, () => {
    assert.equal(wantsRosterGrounding(fx.ask), true);

    const liveContext =
      fx.sport === "ufc"
        ? {
            fightAnalysis: {
              [fx.live.game!]: {
                eventId: fx.live.eventId,
                date: "2026-10-07",
                awayFighter: { name: fx.live.playerName, athleteId: "ufc-1" },
                homeFighter: { name: fx.live.opponent, athleteId: "ufc-2" },
              },
            },
          }
        : fx.sport === "tennis"
          ? {
              tennisAnalysis: {
                [fx.live.game!]: {
                  eventId: fx.live.eventId,
                  date: "2026-10-07",
                  tour: "atp",
                  awayPlayer: { name: fx.live.playerName, athleteId: "ten-1" },
                  homePlayer: { name: fx.live.opponent, athleteId: "ten-2" },
                },
              },
            }
          : {
              realProps: [
                {
                  player: fx.live.playerName,
                  sport: fx.sport,
                  team: fx.live.currentTeam,
                  game: fx.live.game,
                  market: fx.live.market,
                  line: fx.live.line,
                  overOdds: -110,
                  eventId: fx.live.eventId,
                  startsAt: "2026-10-07T23:00:00Z",
                  athleteId: `${fx.sport}-ath-1`,
                },
              ],
            };

    const rows = projectLiveContextFacts(liveContext, {
      namedPlayers: [fx.live.playerName],
      now: NOW,
    });
    assert.ok(rows.length >= 1, `${fx.sport}: expected projected facts`);
    const row = rows.find((r) =>
      r.playerName.toLowerCase().includes(fx.live.playerName.split(" ").pop()!.toLowerCase()),
    );
    assert.ok(row, `${fx.sport}: missing ${fx.live.playerName}`);
    assert.equal(row!.sport, fx.sport === "tennis" || fx.sport === "ufc" ? fx.sport : fx.sport);
    if (fx.live.currentTeam) {
      assert.equal(row!.currentTeam, fx.live.currentTeam);
      assert.doesNotMatch(row!.currentTeam || "", fx.staleMemoryWrong);
    }
    if (fx.live.opponent) {
      assert.ok(
        (row!.opponent || "").toLowerCase().includes(fx.live.opponent!.split(" ").pop()!.toLowerCase()) ||
          (row!.game || "").toLowerCase().includes(fx.live.opponent!.toLowerCase()),
        `${fx.sport}: opponent missing — got ${row!.opponent} / ${row!.game}`,
      );
    }
    assert.equal(row!.verified, true);
    assert.ok(row!.provider);
    assert.ok(row!.providerTimestamp);
    assert.ok(row!.lastVerifiedAt);
    assert.doesNotMatch(
      JSON.stringify(row),
      /knowledge cutoff|as of 2024|as of 2025|June 2024/i,
    );
  });
}

test("buildCurrentFactGroundingPayload merges ESPN roster + live props with provenance", async () => {
  const rosterGrounding = await buildRosterGrounding(
    "Does Brian Robinson Jr. still play for Washington?",
    {
      now: NOW,
      fetchPlayer: async () => ({
        athleteId: "4429013",
        name: "Brian Robinson Jr.",
        team: "Atlanta Falcons",
        sport: "nfl",
        seasonYearFromLeague: 2026,
        isActive: true,
      }),
      realProps: [
        {
          player: "Brian Robinson Jr.",
          sport: "nfl",
          team: "Atlanta Falcons",
          game: "Atlanta Falcons @ Carolina Panthers",
          market: "player_rush_yds",
          line: 55.5,
          overOdds: -105,
          athleteId: "4429013",
        },
      ],
    },
  );
  assert.ok(rosterGrounding);

  const payload = buildCurrentFactGroundingPayload({
    rosterGrounding: rosterGrounding as unknown as Record<string, unknown>,
    liveContext: {
      realProps: [
        {
          player: "Brian Robinson Jr.",
          sport: "nfl",
          team: "Atlanta Falcons",
          game: "Atlanta Falcons @ Carolina Panthers",
          market: "player_rush_yds",
          line: 55.5,
          overOdds: -105,
          athleteId: "4429013",
          eventId: "nfl-atl-car",
          startsAt: "2026-10-12T17:00:00Z",
        },
      ],
    },
    namedPlayers: ["Brian Robinson Jr."],
    now: NOW,
  });

  assert.ok(payload.verifiedCurrentFacts.length >= 1);
  const fact = payload.verifiedCurrentFacts.find((f) =>
    /robinson/i.test(f.playerName),
  );
  assert.ok(fact);
  assert.equal(fact!.currentTeam, "Atlanta Falcons");
  assert.doesNotMatch(fact!.currentTeam || "", /Washington|Commanders/i);
  assert.equal(fact!.market, "player_rush_yds");
  assert.equal(fact!.line, 55.5);
  assert.ok(fact!.playerId);
  assert.ok(fact!.provider);
  assert.match(payload.authority, /authoritative and overrides pretrained/i);
  assert.match(payload.sportCoverage, /nfl/);
  assert.match(payload.sportCoverage, /soccer/);
});

test("NFL regression quartet still grounds: Jeanty / Monangai / Robinson / Likely", async () => {
  const names = [
    ["Ashton Jeanty", "Las Vegas Raiders"],
    ["Kyle Monangai", "Chicago Bears"],
    ["Brian Robinson Jr.", "Atlanta Falcons"],
    ["Isaiah Likely", "New York Giants"],
  ] as const;

  for (const [player, team] of names) {
    const g = await buildRosterGrounding(`Is ${player} an NFL player?`, {
      now: NOW,
      fetchPlayer: async (q) => ({
        athleteId: "id",
        name: player,
        team,
        sport: "nfl",
        seasonYearFromLeague: 2026,
        isActive: true,
      }),
    });
    assert.ok(g);
    assert.equal(g!.entries[0]?.team, team);
    assert.equal(g!.verifiedCurrentFacts[0]?.team, team);
    assert.doesNotMatch(
      g!.facts.join(" "),
      /not an NFL player|college only|knowledge cutoff|June 2024/i,
    );
  }
});

test("unverified current data must not invent a historical team", async () => {
  const g = await buildRosterGrounding("Does Fake Player play for the Mets in 2026 MLB?", {
    now: NOW,
    fetchPlayer: async () => null,
  });
  assert.ok(g);
  assert.equal(g!.entries[0]?.verified, false);
  assert.equal(g!.entries[0]?.team, null);
  assert.equal(g!.verifiedCurrentFacts[0]?.team, null);
  assert.equal(g!.verifiedCurrentFacts[0]?.verified, false);
  assert.match(g!.facts.join(" "), /could not currently verify/i);
  assert.match(g!.facts.join(" "), /do NOT substitute pretrained\/old roster knowledge/i);
  // May mention the user's claim for correction, but must not present Mets as verified current.
  assert.doesNotMatch(
    g!.facts.join(" "),
    /is currently listed on the Mets|verified.*Mets|Mets roster for the 2026/i,
  );
});

test("trimLockedContextForDirectOpenAI never drops currentFactGrounding / rosterGrounding", () => {
  const hist: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) {
    hist[`Player ${i}#${i}`] = {
      player: `Player ${i}`,
      recent: Array.from({ length: 20 }, (_, j) => ({ pts: j })),
    };
  }
  const ctx = {
    realProps: Array.from({ length: 200 }, (_, i) => ({
      game: `A${i} @ B${i}`,
      player: `P${i}`,
    })),
    realOdds: Array.from({ length: 100 }, (_, i) => ({ game: `A${i} @ B${i}` })),
    playerHistory: hist,
    matchupHistory: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `A${i} @ B${i}`,
        { h2h: { meetings: Array(10).fill({}) } },
      ]),
    ),
    rosterGrounding: {
      seasonYear: 2026,
      facts: ["Ashton Jeanty is currently listed on the Las Vegas Raiders"],
      verifiedCurrentFacts: [
        {
          player: "Ashton Jeanty",
          team: "Las Vegas Raiders",
          verified: true,
        },
      ],
    },
    currentFactGrounding: {
      authority: CURRENT_FACT_AUTHORITY_RULE.slice(0, 80),
      verifiedCurrentFacts: [
        {
          sport: "nfl",
          playerName: "Ashton Jeanty",
          currentTeam: "Las Vegas Raiders",
          verified: true,
          provider: "espn_player_search",
          providerTimestamp: NOW.toISOString(),
          lastVerifiedAt: NOW.toISOString(),
        },
      ],
    },
    asOf: NOW.toISOString(),
    seasonYear: 2026,
  };
  const trimmed = trimLockedContextForDirectOpenAI(ctx)!;
  assert.ok(trimmed.rosterGrounding, "rosterGrounding must survive TPM trim");
  assert.ok(trimmed.currentFactGrounding, "currentFactGrounding must survive TPM trim");
  assert.equal(trimmed.seasonYear, 2026);
  assert.ok(trimmed.asOf);
});
