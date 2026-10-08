/**
 * Final pre-release validation probe for lean-preserve correction.
 * Run: node --import ./test/register-hooks.mjs scripts/leanFinalValidationProbe.mjs
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

// Load via TS hooks (register-hooks) — dynamic import of .ts
const lean = await import(pathToFileURL(path.join(root, "lib/mlLeanEnforcement.ts")).href);
const ladder = await import(pathToFileURL(path.join(root, "lib/marketLadderKey.ts")).href);
const corr = await import(pathToFileURL(path.join(root, "lib/parlayCorrelationScore.ts")).href);
const p0 = await import(pathToFileURL(path.join(root, "lib/coachP0UnvalidatedTotals.ts")).href);

const {
  enforceMlLeanOnPicks,
  isLeanQualifiedSubstitute,
  passesLeanTicketConstraints,
} = lean;
const { marketLadderKey, wouldRepeatMarketLadder } = ladder;
const {
  parlayCorrelationPenalty,
  maxLegsPerGame,
  wouldExceedMaxLegsPerGame,
  collapseSameTeamGameLineSides,
} = corr;
const { p0UnvalidatedSimTotalDecision } = p0;

const TNF = "Tampa Bay Buccaneers @ Dallas Cowboys";
const TNF_HISTORY = {
  [TNF]: {
    mlLean: { side: "Dallas Cowboys", edge: 12, reasons: ["home dog lean"] },
  },
};

function qualifiedScore(overrides = {}) {
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
      scores: {},
    },
    ...overrides,
  };
}

function tnfStagedSix(includeProps = true) {
  const gls = [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Buccaneers +6.5",
      odds: -242,
      finalAiScore: qualifiedScore({ grade: "B+", edgePct: 8, simHit: 0.72 }),
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "1H Alt Spread",
      pick: "Buccaneers +13.5",
      odds: -375,
      finalAiScore: qualifiedScore({ grade: "B", simHit: 0.85 }),
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "Q2 Spread",
      pick: "Buccaneers +3.5",
      odds: -108,
      finalAiScore: qualifiedScore({ grade: "B-", simHit: 0.54, edgePct: 4 }),
      ticketRole: "main",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "2H Alt Spread",
      pick: "Buccaneers +9.5",
      odds: -254,
      finalAiScore: qualifiedScore({ grade: "B", simHit: 0.8 }),
      ticketRole: "alt",
    },
  ];
  if (!includeProps) return gls;
  return [
    gls[0],
    {
      game: TNF,
      sport: "nfl",
      market: "Rec Yds",
      pick: "Ryan Flournoy Under 31.5 Rec Yds",
      player: "Ryan Flournoy",
      odds: -112,
      isProp: true,
      propLine: 31.5,
      propSide: "Under",
      propMarketKey: "player_reception_yds",
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 26.8, simHit: 0.79 }),
    },
    {
      game: TNF,
      sport: "nfl",
      market: "Rec Yds",
      pick: "Javonte Williams Over 14.5 Rec Yds",
      player: "Javonte Williams",
      odds: -113,
      isProp: true,
      propLine: 14.5,
      propSide: "Over",
      propMarketKey: "player_reception_yds",
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 12.6, simHit: 0.66 }),
    },
    gls[1],
    gls[2],
    gls[3],
  ];
}

function cowboysPeriodSubs() {
  return [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Cowboys +2.5",
      odds: -387,
      finalAiScore: qualifiedScore({ grade: "B+", edgePct: 5.5, simHit: 0.9 }),
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "1H Alt Spread",
      pick: "Cowboys +4.5",
      odds: -200,
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 6, simHit: 0.7 }),
      ticketRole: "alt",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "Q2 Spread",
      pick: "Cowboys -3.5",
      odds: -110,
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 5, simHit: 0.58 }),
      ticketRole: "main",
    },
    {
      game: TNF,
      sport: "nfl",
      market: "2H Alt Spread",
      pick: "Cowboys +3.5",
      odds: -180,
      finalAiScore: qualifiedScore({ grade: "B", edgePct: 5, simHit: 0.65 }),
      ticketRole: "alt",
    },
  ];
}

function strictEvidence(p) {
  const oddsOk = p.odds != null && Number.isFinite(p.odds) && p.odds !== 0;
  const scoreOk = !!p.finalAiScore;
  const simOk = p.finalAiScore?.simHit != null && Number.isFinite(p.finalAiScore.simHit);
  const qualOk = isLeanQualifiedSubstitute(p) || !!p.isProp; // props use trySeat path
  // For props, check sim grade presence rather than isLeanQualifiedSubstitute (game-side only path)
  const propOk =
    !p.isProp ||
    (oddsOk &&
      scoreOk &&
      simOk &&
      p.finalAiScore.grade != null);
  return {
    pick: `${p.market}|${p.pick}`,
    oddsOk,
    scoreOk,
    simOk,
    simHit: p.finalAiScore?.simHit ?? null,
    grade: p.finalAiScore?.grade ?? null,
    odds: p.odds,
    isLeanQualified: isLeanQualifiedSubstitute(p),
    strict: oddsOk && scoreOk && simOk && (p.isProp ? propOk : isLeanQualifiedSubstitute(p)),
  };
}

const report = { checks: {}, scenarios: {} };

// --- Scenario runs ---
const staged = tnfStagedSix();
const subs = cowboysPeriodSubs();

const s1 = enforceMlLeanOnPicks(staged, {
  matchupHistory: TNF_HISTORY,
  qualifiedCandidates: staged,
  requestedLegs: 7,
});
const s2 = enforceMlLeanOnPicks(staged, {
  matchupHistory: TNF_HISTORY,
  qualifiedCandidates: [...staged, subs[0]],
  requestedLegs: 7,
});
const s3 = enforceMlLeanOnPicks(staged, {
  matchupHistory: TNF_HISTORY,
  qualifiedCandidates: [...staged, ...subs],
  requestedLegs: 7,
});

for (const [name, res] of [
  ["staged-only", s1],
  ["live-1-sub", s2],
  ["four-subs", s3],
]) {
  const evidence = res.picks.map(strictEvidence);
  report.scenarios[name] = {
    length: res.picks.length,
    swapped: res.swapped,
    dropped: res.dropped,
    picks: res.picks.map((p) => ({
      market: p.market,
      pick: p.pick,
      odds: p.odds,
      ladderKey: marketLadderKey(p),
      ...strictEvidence(p),
    })),
    allStrict: evidence.every((e) => e.strict),
  };
}

// 1. Cowboys period distinctness in four-subs
const cowboysGLs = s3.picks.filter((p) => !p.isProp);
const ladderKeys = cowboysGLs.map((p) => marketLadderKey(p));
const periods = cowboysGLs.map((p) => {
  const fam = ladderKeys[cowboysGLs.indexOf(p)];
  return { market: p.market, pick: p.pick, ladderKey: fam };
});
const distinctKeys = new Set(ladderKeys);
const anyFgDuplicate = cowboysGLs.some((p) => {
  // full-game spread family is bare "spread" without period prefix
  const k = marketLadderKey(p);
  return k.endsWith("|spread|cowboys") || /\|spread\|/.test(k) && !/\|(q1|q2|h1|h2|1h|2h):/.test(k);
});
report.checks.cowboysPeriodDistinct = {
  count: cowboysGLs.length,
  periods,
  distinctLadderKeys: [...distinctKeys],
  allDistinct: distinctKeys.size === cowboysGLs.length && cowboysGLs.length === 2,
  wouldRepeatEachOther: cowboysGLs.length === 2
    ? wouldRepeatMarketLadder(cowboysGLs[1], [cowboysGLs[0]])
    : null,
  notDuplicateFullGameSpreadLadders: cowboysGLs.every((p) => {
    const k = marketLadderKey(p);
    // permitted settlement periods: q1:spread / h1:spread (or similar period-prefixed)
    return /\|(q1|q2|h1|h2):spread\|/i.test(k) || /\|(1h|2h):spread\|/i.test(k);
  }),
};

// 2. All fours retain evidence
report.checks.allFourEvidence = {
  staged: report.scenarios["staged-only"].allStrict && report.scenarios["staged-only"].length === 4,
  live: report.scenarios["live-1-sub"].allStrict && report.scenarios["live-1-sub"].length === 4,
  fourSubs: report.scenarios["four-subs"].allStrict && report.scenarios["four-subs"].length === 4,
};

// 3. Bucs Q1 + 1H correlation / overlap
const bucsQ1 = staged[0];
const bucs1H = staged.find((p) => p.market === "1H Alt Spread" && /Buccaneers/i.test(p.pick));
const softPenalty = parlayCorrelationPenalty(bucs1H, [bucsQ1]);
const hardCap = maxLegsPerGame(7);
const hardExceedsAfterQ1 = wouldExceedMaxLegsPerGame(bucs1H, [bucsQ1], hardCap);
const ladderRepeat = wouldRepeatMarketLadder(bucs1H, [bucsQ1]);
const collapse = collapseSameTeamGameLineSides
  ? collapseSameTeamGameLineSides([bucsQ1, bucs1H])
  : null;
// Seat Q2 after Q1+1H under hard cap
const bucsQ2 = staged.find((p) => p.market === "Q2 Spread");
const hardExceedsThird = wouldExceedMaxLegsPerGame(bucsQ2, [bucsQ1, bucs1H], hardCap);
const softPenaltyThird = parlayCorrelationPenalty(bucsQ2, [bucsQ1, bucs1H]);

report.checks.bucsQ1_1H = {
  q1Ladder: marketLadderKey(bucsQ1),
  h1Ladder: marketLadderKey(bucs1H),
  ladderDistinct: !ladderRepeat,
  softCorrelationPenalty_1H_given_Q1: softPenalty,
  hardMaxLegsPerGame_7: hardCap,
  hardCapBlocksSecond: hardExceedsAfterQ1, // should be false — 2 allowed
  hardCapBlocksThird_Q2: hardExceedsThird, // should be true
  softPenalty_Q2_given_Q1_1H: softPenaltyThird,
  collapseSameTeamTo: collapse?.length ?? null,
  collapsePicks: collapse?.map((p) => p.pick) ?? null,
  stagedFinalKeepsQ1and1H: s1.picks.some((p) => p.pick === "Buccaneers +6.5") &&
    s1.picks.some((p) => p.pick === "Buccaneers +13.5"),
  note:
    "Lean finalize uses HARD maxLegsPerGame only (no progressive raise). Soft parlayCorrelationPenalty applies in greedy board select, not lean seat gate.",
};

// 4. Preserve only when eligible
const validPreserve = enforceMlLeanOnPicks(
  [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Buccaneers +6.5",
      odds: -242,
      finalAiScore: qualifiedScore({ grade: "B+", edgePct: 8, simHit: 0.72 }),
    },
  ],
  { matchupHistory: TNF_HISTORY, qualifiedCandidates: [], requestedLegs: 7 },
);
report.checks.preserveValidOnly = {
  preserved: validPreserve.picks.length === 1 && validPreserve.dropped === 0,
  pick: validPreserve.picks[0]?.pick ?? null,
};

// Cap-blocked preserve: already 2 GLs on ticket — 3rd Bucs period should drop
const threeBucs = [staged[0], staged.find((p) => p.market === "1H Alt Spread"), staged.find((p) => p.market === "Q2 Spread")];
const overCap = enforceMlLeanOnPicks(threeBucs, {
  matchupHistory: TNF_HISTORY,
  qualifiedCandidates: threeBucs,
  requestedLegs: 7,
});
report.checks.preserveRespectsHardCap = {
  input: 3,
  output: overCap.picks.length,
  dropped: overCap.dropped,
  kept: overCap.picks.map((p) => `${p.market}|${p.pick}`),
  ok: overCap.picks.length === 2 && overCap.dropped >= 1,
};

// 5. Invalid never retained
const cases = {};
// ungraded
cases.ungraded = enforceMlLeanOnPicks(
  [{ game: TNF, sport: "nfl", market: "Q1 Alt Spread", pick: "Buccaneers +6.5", odds: -242 }],
  { matchupHistory: TNF_HISTORY, qualifiedCandidates: [], requestedLegs: 7 },
);
// expired / missing odds
cases.noOdds = enforceMlLeanOnPicks(
  [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Buccaneers +6.5",
      finalAiScore: qualifiedScore({ simHit: 0.72 }),
    },
  ],
  { matchupHistory: TNF_HISTORY, qualifiedCandidates: [], requestedLegs: 7 },
);
// P0 total as "original" — lean skips non-GL; ensure substitute path rejects
const p0Total = {
  game: TNF,
  sport: "nfl",
  market: "1H Team Total",
  pick: "Buccaneers Over 9.5",
  odds: -110,
  finalAiScore: qualifiedScore({ simHit: 0.72 }),
};
cases.p0IsBlocked = {
  p0Decision: !!p0UnvalidatedSimTotalDecision(p0Total),
  isLeanQualified: isLeanQualifiedSubstitute(p0Total),
  passesConstraints: passesLeanTicketConstraints(p0Total, []),
};
const p0AsSub = enforceMlLeanOnPicks(
  [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Buccaneers +6.5",
      odds: -242,
      finalAiScore: qualifiedScore({ simHit: 0.72 }),
    },
  ],
  {
    matchupHistory: TNF_HISTORY,
    qualifiedCandidates: [p0Total],
    requestedLegs: 7,
  },
);
cases.p0NeverSwappedIn = {
  swapped: p0AsSub.swapped,
  hasTeamTotal: p0AsSub.picks.some((p) => /team total/i.test(p.market)),
};
// duplicate ladder
const g = "Dallas Cowboys @ New York Giants";
const history = {
  [g]: { mlLean: { side: "Dallas Cowboys", edge: 8, reasons: ["lean"] } },
};
const seated = {
  game: g,
  market: "Spread",
  pick: "Cowboys -5.5",
  odds: -108,
  sport: "nfl",
  finalAiScore: qualifiedScore({ simHit: 0.6 }),
};
const opposing = {
  game: g,
  market: "Spread",
  pick: "Giants +5.5",
  odds: -110,
  sport: "nfl",
  finalAiScore: qualifiedScore({ simHit: 0.45 }),
};
const leanAlt = {
  game: g,
  market: "Alt Spread",
  pick: "Dallas Cowboys -8.5",
  odds: -103,
  sport: "nfl",
  finalAiScore: qualifiedScore({ simHit: 0.57 }),
};
cases.duplicateLadder = enforceMlLeanOnPicks([seated, opposing], {
  matchupHistory: history,
  qualifiedCandidates: [seated, leanAlt],
  requestedLegs: 7,
});
// zero simHit / missing sim
cases.noSim = enforceMlLeanOnPicks(
  [
    {
      game: TNF,
      sport: "nfl",
      market: "Q1 Alt Spread",
      pick: "Buccaneers +6.5",
      odds: -242,
      finalAiScore: { grade: "B", edgePct: 5, confidence: 0.7, reasons: ["x"] },
    },
  ],
  { matchupHistory: TNF_HISTORY, qualifiedCandidates: [], requestedLegs: 7 },
);

report.checks.invalidNeverRetained = {
  ungradedDropped: cases.ungraded.picks.length === 0 && cases.ungraded.dropped === 1,
  noOddsDropped: cases.noOdds.picks.length === 0 && cases.noOdds.dropped === 1,
  p0Blocked: cases.p0IsBlocked,
  p0NeverSwappedIn: cases.p0NeverSwappedIn.swapped === 0 && !cases.p0NeverSwappedIn.hasTeamTotal,
  duplicateKeepsOne:
    cases.duplicateLadder.picks.length === 1 &&
    cases.duplicateLadder.dropped === 1 &&
    cases.duplicateLadder.picks[0].pick === "Cowboys -5.5",
  noSimDropped: cases.noSim.picks.length === 0 && cases.noSim.dropped === 1,
};

// Same-team near-identical ladder soft penalty probe (FG vs FG alt)
const fgA = {
  game: g,
  sport: "nfl",
  market: "Spread",
  pick: "Cowboys -5.5",
  odds: -108,
  isProp: false,
};
const fgB = {
  game: g,
  sport: "nfl",
  market: "Alt Spread",
  pick: "Dallas Cowboys -8.5",
  odds: -103,
  isProp: false,
};
report.checks.softPenaltyReference = {
  sameGameDistinctPeriod_Q1_then_1H: softPenalty,
  sameGameSameFamilyNearIdentical_FG: parlayCorrelationPenalty(fgB, [fgA]),
  sameGameSamePick: parlayCorrelationPenalty(fgA, [fgA]),
};

console.log(JSON.stringify(report, null, 2));
