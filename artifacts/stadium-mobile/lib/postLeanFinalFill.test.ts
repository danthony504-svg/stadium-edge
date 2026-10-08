import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import { marketLadderKey, wouldRepeatMarketLadder } from "./marketLadderKey.ts";
import { enforceMlLeanOnPicks } from "./mlLeanEnforcement.ts";
import {
  maxLegsPerGame,
  maxPropsPerGame,
  progressiveLegsPerGameRelaxation,
} from "./parlayCorrelationScore.ts";
import {
  scoredLegFromQualifiedCandidate,
  topUpAfterMlLean,
  wouldConflictOppositeSideSamePeriod,
} from "./postLeanFinalFill.ts";
import { pickLegFingerprint } from "./parlayReachCore.ts";

const TNF = "Tampa Bay Buccaneers @ Dallas Cowboys";
const TNF_HISTORY = {
  [TNF]: {
    home: null,
    away: null,
    homePace: null,
    awayPace: null,
    homeVenueForm: null,
    awayVenueForm: null,
    homeStreak: null,
    awayStreak: null,
    homeSeason: null,
    awaySeason: null,
    homeRest: null,
    awayRest: null,
    h2h: null,
    lastMeeting: null,
    mlLean: { side: "Dallas Cowboys", edge: 12, reasons: ["home dog lean"] },
  },
};

function qualifiedScore(overrides: Record<string, unknown> = {}) {
  return {
    composite: 7.5,
    grade: "B",
    confidencePct: 60,
    edgePct: 5,
    simHit: 0.58,
    simAligned: true,
    highRiskValuePlay: false,
    recommends: true,
    factors: [],
    rubric: {
      composite: 7.5,
      grade: "B",
      confidencePct: 60,
      edgePct: 5,
      scores: {} as never,
    },
    ...overrides,
  };
}

function prop(
  player: string,
  market: string,
  pick: string,
  odds: number,
  score: Record<string, unknown> = {},
): ParsedPick {
  return {
    game: TNF,
    sport: "nfl",
    market,
    pick,
    player,
    odds,
    isProp: true,
    propLine: Number(String(pick).match(/([\d.]+)/)?.[1] ?? 0) || null,
    propSide: /\bover\b/i.test(pick) ? "Over" : "Under",
    finalAiScore: qualifiedScore(score) as never,
  };
}

function gl(
  market: string,
  pick: string,
  odds: number,
  score: Record<string, unknown> = {},
): ParsedPick {
  return {
    game: TNF,
    sport: "nfl",
    market,
    pick,
    odds,
    isProp: false,
    ticketRole: /\balt\b/i.test(market) ? "alt" : "main",
    finalAiScore: qualifiedScore(score) as never,
  };
}

test("production progressive GL policy: target 7 raises to [3,4] only", () => {
  assert.equal(maxLegsPerGame(7), 2);
  assert.equal(maxPropsPerGame(7), 2);
  assert.deepEqual(progressiveLegsPerGameRelaxation(7), [3, 4]);
  assert.deepEqual(progressiveLegsPerGameRelaxation(9), [3, 4, 5]);
  assert.ok(progressiveLegsPerGameRelaxation(15).includes(4));
  assert.equal(Math.max(...progressiveLegsPerGameRelaxation(7)), 4);
});

test("four picks + two independently eligible remaining → fills to six", () => {
  const seated: ParsedPick[] = [
    prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112, {
      grade: "B",
      edgePct: 19.9,
      simHit: 0.733,
    }),
    prop("Jake Ferguson", "Rec Yds", "Jake Ferguson Under 26.5 Rec Yds", -111, {
      grade: "B-",
      edgePct: 11.9,
      simHit: 0.639,
    }),
    gl("Q1 Alt Spread", "Cowboys +2.5", -396, {
      grade: "B+",
      edgePct: 4.8,
      simHit: 0.846,
    }),
    gl("1H Alt Spread", "Buccaneers +13.5", -400, {
      grade: "B+",
      edgePct: 18.7,
      simHit: 0.987,
    }),
  ];
  const q2 = gl("Q2 Alt Spread", "Buccaneers +2.5", 107, {
    grade: "B",
    edgePct: 8,
    simHit: 0.917,
    composite: 8.2,
  });
  const h2 = gl("2H Alt Spread", "Buccaneers +9.5", -263, {
    grade: "B",
    edgePct: 7,
    simHit: 0.88,
    composite: 8.0,
  });
  const out = topUpAfterMlLean({
    picks: seated,
    qualifiedCandidates: [...seated, q2, h2],
    target: 7,
  });
  assert.equal(out.length, 6);
  assert.ok(out.some((p) => p.pick === "Buccaneers +2.5"));
  assert.ok(out.some((p) => p.pick === "Buccaneers +9.5"));
  // Evidence preserved on added legs.
  for (const p of out.filter((x) => /Buccaneers \+[29]/.test(x.pick))) {
    assert.ok(p.finalAiScore?.simHit != null);
    assert.ok(p.odds != null && p.odds !== 0);
    assert.ok(p.finalAiScore?.grade);
  }
});

test("no eligible remaining candidates → unchanged short ticket", () => {
  const seated: ParsedPick[] = [
    prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112),
    prop("Jake Ferguson", "Rec Yds", "Jake Ferguson Under 26.5 Rec Yds", -111),
    gl("Q1 Alt Spread", "Cowboys +2.5", -396),
    gl("1H Alt Spread", "Buccaneers +13.5", -400),
  ];
  const out = topUpAfterMlLean({
    picks: seated,
    qualifiedCandidates: seated,
    target: 7,
  });
  assert.equal(out.length, 4);
  assert.deepEqual(
    out.map((p) => p.pick),
    seated.map((p) => p.pick),
  );
});

test("P0-blocked candidates never enter final fill", () => {
  const seated: ParsedPick[] = [
    prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112),
    gl("Q1 Alt Spread", "Cowboys +2.5", -396),
  ];
  const p0Total: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "1H Team Total",
    pick: "Buccaneers Over 9.5",
    odds: -110,
    finalAiScore: qualifiedScore({ simHit: 0.9, grade: "A" }) as never,
  };
  assert.equal(scoredLegFromQualifiedCandidate(p0Total), null);
  const out = topUpAfterMlLean({
    picks: seated,
    qualifiedCandidates: [...seated, p0Total],
    target: 7,
  });
  assert.ok(out.every((p) => !/team total/i.test(p.market)));
});

test("duplicate ladders / thresholds cannot double-seat", () => {
  const seated: ParsedPick[] = [
    prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112, {
      grade: "B",
      simHit: 0.73,
      edgePct: 20,
    }),
    gl("Q1 Alt Spread", "Cowboys +2.5", -396),
  ];
  const altThreshold = prop(
    "CeeDee Lamb",
    "Rec Yds",
    "CeeDee Lamb Over 79.5 Rec Yds",
    -133,
    { grade: "B+", simHit: 0.76, edgePct: 18, composite: 9 },
  );
  const q1Juice = gl("Q1 Alt Spread", "Cowboys +3.5", -350, {
    grade: "B+",
    simHit: 0.85,
    composite: 9,
  });
  assert.equal(marketLadderKey(seated[0]!), marketLadderKey(altThreshold));
  assert.equal(wouldRepeatMarketLadder(altThreshold, [seated[0]!]), true);
  assert.equal(wouldRepeatMarketLadder(q1Juice, [seated[1]!]), true);
  const out = topUpAfterMlLean({
    picks: seated,
    qualifiedCandidates: [...seated, altThreshold, q1Juice],
    target: 7,
  });
  assert.equal(out.filter((p) => /CeeDee/i.test(p.pick)).length, 1);
  assert.equal(out.filter((p) => /Cowboys/i.test(p.pick)).length, 1);
});

test("correlated opposite-side same-period GLs are rejected", () => {
  const cowboysQ1 = gl("Q1 Alt Spread", "Cowboys +2.5", -396, {
    grade: "B+",
    simHit: 0.85,
  });
  const bucsQ1 = gl("Q1 Alt Spread", "Buccaneers +6.5", -242, {
    grade: "B+",
    simHit: 0.94,
    composite: 9.5,
  });
  const bucsQ2 = gl("Q2 Alt Spread", "Buccaneers +2.5", 107, {
    grade: "B",
    simHit: 0.92,
    composite: 8.5,
  });
  assert.equal(wouldConflictOppositeSideSamePeriod(bucsQ1, [cowboysQ1]), true);
  assert.equal(wouldConflictOppositeSideSamePeriod(bucsQ2, [cowboysQ1]), false);
  const out = topUpAfterMlLean({
    picks: [
      prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112),
      cowboysQ1,
    ],
    qualifiedCandidates: [
      prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112),
      cowboysQ1,
      bucsQ1,
      bucsQ2,
    ],
    target: 7,
  });
  assert.equal(out.some((p) => p.pick === "Buccaneers +6.5"), false);
  assert.ok(out.some((p) => p.pick === "Buccaneers +2.5"));
});

test("missing simulation grades never qualify for fill", () => {
  const seated = [gl("Q1 Alt Spread", "Cowboys +2.5", -396)];
  const ungraded: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "Q2 Alt Spread",
    pick: "Buccaneers +2.5",
    odds: 107,
  };
  const noSim: ParsedPick = {
    game: TNF,
    sport: "nfl",
    market: "2H Alt Spread",
    pick: "Buccaneers +9.5",
    odds: -263,
    finalAiScore: {
      composite: 7,
      grade: "B",
      confidencePct: 60,
      edgePct: 5,
      recommends: true,
      factors: [],
      rubric: { composite: 7, grade: "B", confidencePct: 60, edgePct: 5, scores: {} as never },
    } as never,
  };
  assert.equal(scoredLegFromQualifiedCandidate(ungraded), null);
  assert.equal(scoredLegFromQualifiedCandidate(noSim), null);
  const out = topUpAfterMlLean({
    picks: seated,
    qualifiedCandidates: [...seated, ungraded, noSim],
    target: 7,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.pick, "Cowboys +2.5");
});

test("existing game-line and player-prop caps still bind", () => {
  const seated: ParsedPick[] = [
    prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112, {
      edgePct: 20,
      simHit: 0.73,
    }),
    prop("Jake Ferguson", "Rec Yds", "Jake Ferguson Under 26.5 Rec Yds", -111, {
      edgePct: 12,
      simHit: 0.64,
    }),
    gl("Q1 Alt Spread", "Cowboys +2.5", -396, { simHit: 0.85, composite: 8 }),
    gl("1H Alt Spread", "Buccaneers +13.5", -400, { simHit: 0.98, composite: 8.5 }),
  ];
  const thirdProp = prop(
    "George Pickens",
    "Rec Yds",
    "George Pickens Under 63.5 Rec Yds",
    -110,
    { grade: "B-", edgePct: 10, simHit: 0.62, composite: 9 },
  );
  const dak = prop(
    "Dak Prescott",
    "Pass TDs",
    "Dak Prescott Under 2.5 Pass TDs",
    -170,
    { grade: "B", edgePct: 5, simHit: 0.68, composite: 8.8 },
  );
  const periodGls = [
    gl("Q2 Alt Spread", "Buccaneers +2.5", 107, { simHit: 0.92, composite: 8.2 }),
    gl("2H Alt Spread", "Buccaneers +9.5", -263, { simHit: 0.88, composite: 8.1 }),
    gl("Alt Spread", "Buccaneers +17.5", -295, { simHit: 0.9, composite: 8.0 }),
    gl("Q3 Alt Spread", "Buccaneers +2.5", -103, { simHit: 0.65, composite: 7.5 }),
  ];
  const out = topUpAfterMlLean({
    picks: seated,
    qualifiedCandidates: [...seated, thirdProp, dak, ...periodGls],
    target: 7,
  });
  assert.equal(out.filter((p) => p.isProp).length, 2, "maxPropsPerGame(7)=2");
  assert.ok(out.filter((p) => !p.isProp).length <= 4, "progressive ceiling 4");
  assert.ok(out.length <= 6);
  assert.equal(out.some((p) => /Pickens|Prescott/i.test(p.pick)), false);
});

test("rejected fingerprints are not reintroduced; lean is not re-run", () => {
  // Hard cap already holds 2 GLs — lean drops the 3rd anti-lean; fill must not
  // restore that fingerprint when callers mark it rejected.
  const seated = [
    prop("CeeDee Lamb", "Rec Yds", "CeeDee Lamb Over 84.5 Rec Yds", -112),
    prop("Jake Ferguson", "Rec Yds", "Jake Ferguson Under 26.5 Rec Yds", -111),
    gl("Q1 Alt Spread", "Cowboys +2.5", -396, { simHit: 0.85 }),
    gl("1H Alt Spread", "Buccaneers +13.5", -400, { simHit: 0.98 }),
  ];
  const droppedByLean = gl("Q2 Spread", "Buccaneers +3.5", -108, {
    simHit: 0.54,
    grade: "B-",
    composite: 9.5,
  });
  const ok = gl("2H Alt Spread", "Buccaneers +9.5", -263, {
    simHit: 0.88,
    composite: 8.5,
  });
  const afterLean = enforceMlLeanOnPicks([...seated, droppedByLean], {
    matchupHistory: TNF_HISTORY as never,
    qualifiedCandidates: [...seated, droppedByLean, ok],
    requestedLegs: 7,
  });
  assert.equal(
    afterLean.picks.some((p) => p.pick === "Buccaneers +3.5"),
    false,
    "lean hard-cap drops 3rd GL",
  );
  const rejectedFp = new Set([pickLegFingerprint(droppedByLean)]);
  const out = topUpAfterMlLean({
    picks: afterLean.picks,
    qualifiedCandidates: [...seated, droppedByLean, ok],
    target: 7,
    rejectedFingerprints: rejectedFp,
  });
  assert.equal(out.some((p) => p.pick === "Buccaneers +3.5"), false);
  assert.ok(out.some((p) => p.pick === "Buccaneers +9.5"));
  assert.ok(out.some((p) => /Cowboys/i.test(p.pick)), "lean seats survive fill");
  // Fill must not invoke a second lean wipe — ticket only grows or stays.
  assert.ok(out.length >= afterLean.picks.length);
});

test("requests for 7, 9 and 15 legs honor progressive ceilings without raising them", () => {
  const props = [
    prop("A", "Rec Yds", "A Over 10.5 Rec Yds", -110, { edgePct: 20, simHit: 0.7 }),
    prop("B", "Rec Yds", "B Under 20.5 Rec Yds", -110, { edgePct: 15, simHit: 0.65 }),
  ];
  const gls = [
    gl("Q1 Alt Spread", "Cowboys +2.5", -200, { simHit: 0.8, composite: 8 }),
    gl("1H Alt Spread", "Buccaneers +13.5", -300, { simHit: 0.9, composite: 8.5 }),
    gl("Q2 Alt Spread", "Buccaneers +2.5", 100, { simHit: 0.85, composite: 8.2 }),
    gl("2H Alt Spread", "Buccaneers +9.5", -250, { simHit: 0.82, composite: 8.1 }),
    gl("Alt Spread", "Buccaneers +17.5", -280, { simHit: 0.88, composite: 8.0 }),
    gl("Q3 Alt Spread", "Buccaneers +1.5", -105, { simHit: 0.7, composite: 7.8 }),
  ];
  for (const target of [7, 9, 15]) {
    const progressive = progressiveLegsPerGameRelaxation(target);
    const ceiling = progressive.length ? Math.max(...progressive) : maxLegsPerGame(target);
    const out = topUpAfterMlLean({
      picks: [...props, gls[0]!, gls[1]!],
      qualifiedCandidates: [...props, ...gls],
      target,
    });
    const glCount = out.filter((p) => !p.isProp).length;
    assert.ok(
      glCount <= ceiling,
      `target ${target}: glCount ${glCount} exceeds progressive ceiling ${ceiling}`,
    );
    assert.equal(out.filter((p) => p.isProp).length, Math.min(2, maxPropsPerGame(target)));
    // Never force full N on a one-game slate.
    assert.ok(out.length < target || target <= 6);
  }
});
