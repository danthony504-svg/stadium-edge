import assert from "node:assert/strict";
import test from "node:test";
import {
  combinedParlayEvPct,
  filterToQualifiedLegs,
  passesIndividualTicketLeg,
} from "./coachTicketEv.ts";

const ctx = {
  gameSimulations: new Map(),
  propSimulations: new Map([
    ["Player|points|25.5|Over", { hitProbability: 0.55 }],
  ]),
};

test("passesIndividualTicketLeg requires positive edge and grade", () => {
  const good = {
    game: "A @ B",
    market: "Points",
    pick: "Player Over 25.5 Points",
    odds: -110,
    isProp: true,
    player: "Player",
    propLine: 25.5,
    propSide: "Over",
    propMarketKey: "points",
    finalAiScore: {
      grade: "B",
      confidencePct: 58,
      edgePct: 2.5,
      simHit: 0.55,
    },
  };
  const weak = {
    ...good,
    finalAiScore: { grade: "C", confidencePct: 58, edgePct: 2.5, simHit: 0.55 },
  };
  assert.equal(passesIndividualTicketLeg(good as never, ctx), true);
  assert.equal(passesIndividualTicketLeg(weak as never, ctx), false);
});

test("filterToQualifiedLegs drops legs that fail individual gates", () => {
  const legs = [
    {
      game: "A @ B",
      market: "Points",
      pick: "Player Over 25.5 Points",
      odds: -110,
      isProp: true,
      player: "Player",
      propLine: 25.5,
      propSide: "Over",
      propMarketKey: "points",
      finalAiScore: { grade: "B", confidencePct: 58, edgePct: 2.5, simHit: 0.55 },
    },
    {
      game: "C @ D",
      market: "Points",
      pick: "Other Over 10.5 Points",
      odds: -110,
      isProp: true,
      player: "Other",
      propLine: 10.5,
      propSide: "Over",
      propMarketKey: "points",
      finalAiScore: { grade: "D", confidencePct: 40, edgePct: -1, simHit: 0.4 },
    },
  ];
  const out = filterToQualifiedLegs(legs as never, ctx);
  assert.equal(out.picks.length, 1);
  assert.equal(out.dropped.length, 1);
});

test("combinedParlayEvPct multiplies leg hit rates and odds", () => {
  const legs = [
    {
      game: "A @ B",
      market: "ML",
      pick: "Team A ML",
      odds: -110,
      isProp: false,
      finalAiScore: { simHit: 0.55, edgePct: 2, grade: "B", confidencePct: 55 },
    },
    {
      game: "C @ D",
      market: "ML",
      pick: "Team C ML",
      odds: -110,
      isProp: false,
      finalAiScore: { simHit: 0.55, edgePct: 2, grade: "B", confidencePct: 55 },
    },
  ];
  const ev = combinedParlayEvPct(legs as never, { gameSimulations: new Map() });
  assert.ok(ev != null && ev > 0);
});
