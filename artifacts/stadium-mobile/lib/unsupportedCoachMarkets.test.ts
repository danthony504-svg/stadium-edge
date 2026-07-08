import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUnsupportedSoccerDisciplineAsk,
  extractMatchupHint,
  unsupportedSoccerDisciplineReply,
} from "./unsupportedCoachMarkets.ts";

test("isUnsupportedSoccerDisciplineAsk detects yellow-card asks", () => {
  assert.equal(
    isUnsupportedSoccerDisciplineAsk(
      "who's most likely to get a yellow card in the france v morocco game",
    ),
    true,
  );
  assert.equal(isUnsupportedSoccerDisciplineAsk("any booking props for tonight?"), true);
  assert.equal(isUnsupportedSoccerDisciplineAsk("Build me a 5-leg parlay"), false);
  assert.equal(isUnsupportedSoccerDisciplineAsk("Tatum foul trouble tonight"), false);
});

test("extractMatchupHint reads team-vs-team phrasing", () => {
  assert.equal(
    extractMatchupHint("yellow card in the france v morocco game"),
    "france vs morocco",
  );
  assert.equal(extractMatchupHint("France vs Morocco tonight"), "France vs Morocco");
  assert.equal(
    extractMatchupHint("who's most likely to get a yellow card in the france x morocco game"),
    "france vs morocco",
  );
});

test("isUnsupportedSoccerDisciplineAsk: france x morocco yellow-card ask", () => {
  assert.equal(
    isUnsupportedSoccerDisciplineAsk(
      "who's most likely to get a yellow card in the france x morocco game",
    ),
    true,
  );
});

test("unsupportedSoccerDisciplineReply is honest and names supported soccer props", () => {
  const reply = unsupportedSoccerDisciplineReply(
    "who's most likely to get a yellow card in the france v morocco game",
  );
  assert.match(reply, /yellow-card/i);
  assert.match(reply, /france vs morocco/i);
  assert.match(reply, /shots on target/i);
  assert.doesNotMatch(reply, /Tchouaméni|Amrabat|Hakimi/i);
});
