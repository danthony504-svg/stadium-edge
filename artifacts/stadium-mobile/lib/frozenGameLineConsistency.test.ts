import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFrozenTicketConsistency,
  buildFrozenGameLineSummaryNote,
  composeFrozenGameLineLegNote,
  frozenGameLineHeader,
  frozenLegSurfaceLabels,
  FrozenGameLineConsistencyError,
  mergeTicketPreservingFrozenGameLines,
  parseAllGameLineMentionsFromNote,
  parseFrozenSummaryGamePicks,
  stripModelGameLineListings,
} from "./frozenGameLineConsistency.ts";

type MockPick = Parameters<typeof buildFrozenGameLineSummaryNote>[0][number];

const GAMES = [
  "Indiana Fever @ Las Vegas Aces",
  "Boston Red Sox @ Los Angeles Angels",
  "New York Yankees @ Tampa Bay Rays",
  "San Diego Padres @ Los Angeles Dodgers",
  "Philadelphia Phillies @ Kansas City Royals",
];

const PICKS = [
  "Fever +1.5",
  "Angels +1.5",
  "Rays +1.5",
  "Dodgers -2",
  "Royals +2.5",
];

function mockFrozenGameLine(
  gameIdx: number,
  overrides?: Partial<MockPick> & { displayPick?: string },
): MockPick {
  const game = GAMES[gameIdx % GAMES.length]!;
  const pickLabel = overrides?.displayPick ?? PICKS[gameIdx % PICKS.length]!;
  const display = {
    pick: pickLabel,
    market: "Alt Spread",
    odds: 115,
    game,
    grade: "B+",
    confidencePct: 58,
    edgePct: 3.2,
    evPct: 4.1,
    simHit: 0.54,
    simPct: 54,
  };
  return {
    game,
    market: display.market,
    pick: pickLabel,
    odds: display.odds,
    isProp: false,
    gameLineFrozen: true,
    finalAiScore: {
      composite: 6.8,
      grade: display.grade,
      confidencePct: display.confidencePct,
      edgePct: display.edgePct,
      simHit: display.simHit,
      simAligned: true,
      highRiskValuePlay: false,
      recommends: true,
      factors: [],
      rubric: {
        scores: {},
        composite: 6.8,
        grade: display.grade,
        confidencePct: display.confidencePct,
        edgePct: display.edgePct,
      },
    },
    gameLineFinal: {
      reason: "Highest Final Score among posted alt spreads",
      finalScore: 6.8,
      frozenAt: Date.now(),
      display,
      bullets: ["Best EV among qualified alt rungs"],
    },
    ...overrides,
  };
}

function mockProp(idx: number): MockPick {
  return {
    game: GAMES[idx % GAMES.length]!,
    market: "Player Prop",
    pick: "Over 24.5 Points",
    odds: -115,
    isProp: true,
    player: `Player ${idx}`,
    propLine: 24.5,
    propSide: "over",
  };
}

test("buildFrozenGameLineSummaryNote matches card header for every frozen leg", () => {
  const picks = [mockFrozenGameLine(0), mockFrozenGameLine(1), mockProp(0)];
  const summary = buildFrozenGameLineSummaryNote(picks);
  assert.match(summary, /\*\*Fever \+1\.5\*\*/);
  assert.match(summary, /Indiana Fever @ Las Vegas Aces/);
  const parsed = parseFrozenSummaryGamePicks(summary);
  for (const pick of picks) {
    if (pick.isProp) continue;
    const header = frozenGameLineHeader(pick);
    const summaryPick = parsed.get(
      header.game
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    assert.equal(summaryPick, header.pick.toLowerCase().replace(/\s+/g, " ").trim());
  }
  assertFrozenTicketConsistency(picks, summary);
});

test("assertFrozenTicketConsistency throws when summary and card disagree", () => {
  const picks = [mockFrozenGameLine(0)];
  const badSummary =
    "• **Aces -2.5** (Spread) · Indiana Fever @ Las Vegas Aces\nSim 49% · Edge +1% · EV +1.0% · Conf 50 · Grade C+";
  assert.throws(
    () => assertFrozenTicketConsistency(picks, badSummary),
    FrozenGameLineConsistencyError,
  );
});

test("assertFrozenTicketConsistency throws on opposing sides in ticket", () => {
  const fever = mockFrozenGameLine(0, { displayPick: "Fever +1.5" });
  const aces = mockFrozenGameLine(0, { displayPick: "Aces -2.5", pick: "Aces -2.5" });
  assert.throws(() => assertFrozenTicketConsistency([fever, aces]), FrozenGameLineConsistencyError);
});

test("assertFrozenTicketConsistency throws when game line is not frozen", () => {
  const unfrozen: MockPick = {
    game: GAMES[0]!,
    market: "Spread",
    pick: "Aces -2.5",
    odds: -110,
    isProp: false,
    finalAiScore: mockFrozenGameLine(0).finalAiScore,
  };
  assert.throws(() => assertFrozenTicketConsistency([unfrozen]), FrozenGameLineConsistencyError);
});

test("stripModelGameLineListings removes legacy optimizer paragraphs", () => {
  const note = [
    "You asked for 15 legs, but only 5 cleared every quality check.",
    "Indiana Fever @ Las Vegas Aces: Aces -2.5 (Spread) — Final AI C+, sim 49%, edge —",
    "Dropped 2 legs that backed the opposing team on the same game.",
  ].join("\n\n");
  const stripped = stripModelGameLineListings(note);
  assert.doesNotMatch(stripped, /Aces -2\.5/);
  assert.doesNotMatch(stripped, /edge —/);
  assert.match(stripped, /only 5 cleared/);
});

test("stripModelGameLineListings removes legacy lines embedded in multi-line blocks", () => {
  const note = [
    "_Your 6-leg ticket is built from player props and alt rungs on the live board — not the model's chalk moneyline scaffold._",
    "Boston Red Sox @ Los Angeles Angels: Sox -1.5 (Spread) — Final AI: 5+, sim: 69%, edge: --",
    "Philadelphia Phillies @ Kansas City Royals: Royals +1 (Alt Spread) — Final AI: --, sim: 43%, edge: --",
  ].join("\n\n");
  const stripped = stripModelGameLineListings(note);
  assert.doesNotMatch(stripped, /Sox -1\.5/);
  assert.doesNotMatch(stripped, /Royals \+1/);
  assert.match(stripped, /player props and alt rungs/);
});

test("assertFrozenTicketConsistency throws when summary lists game lines on props-only ticket", () => {
  const props = [mockProp(0), mockProp(1)];
  const staleNote = [
    "_Your 6-leg ticket is built from player props._",
    "Boston Red Sox @ Los Angeles Angels: Sox -1.5 (Spread) — Final AI: 5+, sim: 69%, edge: --",
  ].join("\n\n");
  assert.throws(
    () => assertFrozenTicketConsistency(props, staleNote),
    /no game-line card is on the ticket/,
  );
});

test("assertFrozenTicketConsistency throws when game-line card is missing from summary", () => {
  const picks = [mockFrozenGameLine(1), mockProp(0)];
  const note = "_Built from player props._";
  assert.throws(
    () => assertFrozenTicketConsistency(picks, note),
    /missing from the summary/,
  );
});

test("composeFrozenGameLineLegNote strips stale lines and rebuilds from cards", () => {
  const picks = [mockFrozenGameLine(1), mockProp(0)];
  const stale = [
    "_Your 6-leg ticket is built from player props._",
    "Boston Red Sox @ Los Angeles Angels: Sox -1.5 (Spread) — Final AI: 5+, sim: 69%, edge: --",
  ].join("\n\n");
  const note = composeFrozenGameLineLegNote(picks, stale);
  assert.doesNotMatch(note, /Sox -1\.5/);
  assert.match(note, /\*\*Angels \+1\.5\*\*/);
  const mentions = parseAllGameLineMentionsFromNote(note);
  assert.equal(mentions.size, 1);
  assert.equal(mentions.get(normGameKey(GAMES[1]!))?.pick, "Angels +1.5");
});

function normGameKey(game: string) {
  return game
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("mergeTicketPreservingFrozenGameLines keeps frozen game lines when props re-score", () => {
  const frozen = mockFrozenGameLine(0);
  const prior = [frozen, mockProp(0)];
  const rescoredProp = {
    ...mockProp(0),
    finalAiScore: { ...mockFrozenGameLine(0).finalAiScore!, composite: 7.5 },
  };
  const mutatedGameLine = {
    ...mockFrozenGameLine(0),
    gameLineFrozen: false,
    pick: "Aces -2.5",
    gameLineFinal: undefined,
  };
  const next = [mutatedGameLine, rescoredProp];
  const merged = mergeTicketPreservingFrozenGameLines(prior, next);
  const gameLine = merged.find((p) => !p.isProp)!;
  assert.equal(frozenGameLineHeader(gameLine).pick, "Fever +1.5");
  assert.equal(merged.length, 2);
});

test("frozenLegSurfaceLabels are identical across card, slip, breakdown, share", () => {
  const pick = mockFrozenGameLine(2);
  const surfaces = frozenLegSurfaceLabels(pick);
  assert.equal(surfaces.card, surfaces.slip);
  assert.equal(surfaces.card, surfaces.breakdown);
  assert.equal(surfaces.card, surfaces.share);
  assert.match(surfaces.card, /Rays \+1\.5/);
});
