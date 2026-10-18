import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPropsResponsePayload,
  lookupRosterEntry,
  rosterNameKeys,
  stampPropRowIdentity,
} from "../src/routes/props.ts";
import { parsePropsResponseForSimulateGame } from "../src/routes/simulate.ts";
import { pickFromPoolEntry } from "../src/lib/coachSlateBoardScan.ts";
import type { PropPoolEntry } from "../src/lib/coachSlateTypes.ts";

describe("Stage 2 — roster name keys (suffix aliases, fail-closed collisions)", () => {
  it("rosterNameKeys adds Jr/Sr/II aliases without inventing athletes", () => {
    const keys = rosterNameKeys("Patrick Mahomes Jr.");
    assert.ok(keys.includes("patrickmahomesjr"));
    assert.ok(keys.includes("patrickmahomes"));
  });

  it("lookupRosterEntry hits suffix-stripped ESPN name from Odds Jr. label", () => {
    const m = new Map([
      [
        "kengriffey",
        { headshot: null, athleteId: "123", teamId: "1" },
      ],
    ]);
    const hit = lookupRosterEntry(m, "Ken Griffey Jr.");
    assert.equal(hit?.athleteId, "123");
    assert.equal(lookupRosterEntry(m, "Nobody"), null);
  });
});

describe("Stage 2 — props response stamps event/sport ids", () => {
  it("buildPropsResponsePayload stamps root + row odds/espn/event/sport", () => {
    const payload = buildPropsResponsePayload({
      home: "Jacksonville Jaguars",
      away: "Houston Texans",
      bookmaker: "DraftKings",
      sport: "nfl",
      identity: {
        oddsEventId: "57418b2cf5aca558b3c98eafac1e264a",
        espnEventId: "401872996",
      },
      props: [
        {
          player: "Woody Marks",
          market: "player_anytime_td",
          line: null,
          athleteId: "4429059",
          playerTeamId: "34",
          overPrice: 135,
          underPrice: null,
          alt: false,
        },
        {
          player: "Jayson Tatum",
          market: "player_assists",
          line: 5.5,
          athleteId: "4065648",
          playerTeamId: "2",
          overPrice: -122,
          underPrice: 113,
          alt: true,
        },
      ],
    });

    assert.equal(payload.oddsEventId, "57418b2cf5aca558b3c98eafac1e264a");
    assert.equal(payload.espnEventId, "401872996");
    const rows = payload.props as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.eventId, "57418b2cf5aca558b3c98eafac1e264a");
      assert.equal(r.oddsEventId, "57418b2cf5aca558b3c98eafac1e264a");
      assert.equal(r.espnEventId, "401872996");
      assert.equal(r.sport, "nfl");
    }
    // Alt market keeps line/athlete association — never rewritten.
    assert.equal(rows[1]!.line, 5.5);
    assert.equal(rows[1]!.athleteId, "4065648");
    assert.equal(rows[1]!.alt, true);
  });

  it("stampPropRowIdentity never fabricates when identity missing", () => {
    const stamped = stampPropRowIdentity(
      [{ player: "X", market: "player_points", line: 20.5 }],
      "nba",
      null,
    );
    assert.equal(stamped[0]!.sport, "nba");
    assert.equal(stamped[0]!.eventId, null);
    assert.equal(stamped[0]!.oddsEventId, null);
    assert.equal(stamped[0]!.espnEventId, null);
  });
});

describe("Stage 2 — simulate/game parses { props } body", () => {
  it("extracts rows + team/event ids from object shape (production bug)", () => {
    const parsed = parsePropsResponseForSimulateGame({
      home: "Detroit Pistons",
      away: "Boston Celtics",
      oddsEventId: "26b036ff107f3c658258eaf4a6f26228",
      espnEventId: "401909088",
      identity: {
        oddsEventId: "26b036ff107f3c658258eaf4a6f26228",
        espnEventId: "401909088",
        homeTeamId: "8",
        awayTeamId: "2",
      },
      props: [
        {
          player: "Jayson Tatum",
          market: "player_assists",
          line: 5.5,
          athleteId: "4065648",
          playerTeamId: "2",
          overPrice: -122,
          underPrice: 113,
          eventId: "26b036ff107f3c658258eaf4a6f26228",
          alt: false,
        },
      ],
    });
    assert.equal(parsed.propRows.length, 1);
    assert.equal(parsed.propRows[0]!.athleteId, "4065648");
    assert.equal(parsed.propRows[0]!.playerTeamId, "2");
    assert.equal(parsed.identity?.homeTeamId, "8");
    assert.equal(parsed.oddsEventId, "26b036ff107f3c658258eaf4a6f26228");
  });

  it("still accepts legacy bare array without throwing", () => {
    const parsed = parsePropsResponseForSimulateGame([
      {
        player: "A",
        market: "player_points",
        line: 10.5,
        overPrice: -110,
        underPrice: -110,
      },
    ]);
    assert.equal(parsed.propRows.length, 1);
    assert.equal(parsed.identity, null);
  });
});

describe("Stage 2 — server pickFromPoolEntry preserves identity", () => {
  it("copies eventId, sportsbook, team ids onto ParsedPick", () => {
    const e: PropPoolEntry = {
      sport: "nfl",
      game: "Houston Texans @ Jacksonville Jaguars",
      marketLabel: "Anytime Td",
      player: "Woody Marks",
      line: null,
      side: "Over",
      odds: 135,
      athleteId: "4429059",
      playerTeamId: "34",
      homeTeamId: "30",
      awayTeamId: "34",
      eventId: "57418b2cf5aca558b3c98eafac1e264a",
      sportsbook: "DraftKings",
      marketKey: "player_anytime_td",
      alt: false,
    };
    const pick = pickFromPoolEntry(e);
    assert.equal(pick.athleteId, "4429059");
    assert.equal(pick.eventId, "57418b2cf5aca558b3c98eafac1e264a");
    assert.equal(pick.sportsbook, "DraftKings");
    assert.equal(pick.playerTeamId, "34");
    assert.equal(pick.homeTeamId, "30");
    assert.equal(pick.awayTeamId, "34");
    assert.equal(pick.propMarketKey, "player_anytime_td");
    assert.equal(pick.propSide, "Over");
  });
});
