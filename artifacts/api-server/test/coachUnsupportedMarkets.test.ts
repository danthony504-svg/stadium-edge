import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUnsupportedSoccerDisciplineAsk,
  unsupportedSoccerDisciplineReply,
} from "../src/lib/coachUnsupportedMarkets.ts";

test("server blocks yellow-card asks from streaming player guesses", () => {
  const q = "who's most likely to get a yellow card in the france v morocco game";
  assert.equal(isUnsupportedSoccerDisciplineAsk(q), true);
  const reply = unsupportedSoccerDisciplineReply(q);
  assert.match(reply, /yellow-card/i);
  assert.doesNotMatch(reply, /Rabiot|Hakimi|Amrabat|Hernandez/i);
});
