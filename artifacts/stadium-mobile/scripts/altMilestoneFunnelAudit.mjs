/**
 * Classify why synthetic board alts were not deep-simmed, and report the
 * available → simulated → gradeable → qualified → independent → seats funnel.
 *
 * Run: node --import ./test/register-hooks.mjs scripts/altMilestoneFunnelAudit.mjs
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { writeFileSync } from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const u = (rel) => pathToFileURL(path.join(root, rel)).href;

const {
  selectBoardPropSimCandidates,
  BOARD_PROP_SIM_RUNGS_PER_LADDER,
  pickDiverseLadderRungsForSim,
} = await import(u("lib/boardPropSimExpansion.ts"));
const { isPostedMilestoneAltLine, milestoneMarketFamily } = await import(
  u("lib/coachMilestoneLines.ts")
);
const { marketLadderKey, wouldRepeatMarketLadder } = await import(
  u("lib/marketLadderKey.ts")
);
const { boardLegPoolRole, topUpTicketFromQualifiedScored } = await import(
  u("lib/ticketStaging.ts")
);
const {
  wouldRepeatPlayerProp,
  wouldExceedMaxPropsPerGame,
  maxPropsPerGame,
  maxLegsPerGame,
  wouldExceedMaxLegsPerGame,
} = await import(u("lib/parlayCorrelationScore.ts"));

const MAX_TO_SIM = 80;

const sports = [
  { sport: "nfl", market: "Rec Yds", key: "player_reception_yds", main: 52.5, miles: [39.5, 59.5, 74.5] },
  { sport: "ncaaf", market: "Pass Yds", key: "player_pass_yds", main: 245.5, miles: [199.5, 274.5, 299.5] },
  { sport: "nba", market: "Points", key: "player_points", main: 24.5, miles: [19.5, 29.5, 34.5] },
  { sport: "wnba", market: "Points", key: "player_points", main: 18.5, miles: [14.5, 19.5, 24.5] },
  { sport: "mlb", market: "Hits", key: "batter_hits", main: 0.5, miles: [1.5, 2.5] },
  { sport: "nhl", market: "Shots", key: "player_shots_on_goal", main: 2.5, miles: [3.5, 4.5] },
];

const qualScore = {
  composite: 7,
  grade: "B",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.62,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 7, grade: "B", confidencePct: 58, edgePct: 4, scores: {} },
};

const ranked = [];
for (const s of sports) {
  for (let p = 0; p < 4; p++) {
    const player = `${s.sport}_P${p}`;
    const game = `${s.sport.toUpperCase()} Away${p % 2} @ ${s.sport.toUpperCase()} Home${p % 2}`;
    ranked.push({
      game,
      market: s.market,
      propMarketKey: s.key,
      pick: `${player} Over ${s.main} ${s.market}`,
      odds: -110,
      isProp: true,
      sport: s.sport,
      player,
      propLine: s.main,
      propSide: "Over",
      propIsAlt: false,
      finalAiScore: qualScore,
    });
    for (const m of s.miles) {
      ranked.push({
        game,
        market: s.market,
        propMarketKey: s.key,
        pick: `${player} Over ${m} ${s.market}`,
        odds: 150,
        isProp: true,
        sport: s.sport,
        player,
        propLine: m,
        propSide: "Over",
        propIsAlt: true,
        finalAiScore: qualScore,
      });
    }
  }
}

const { selected, skippedCount } = selectBoardPropSimCandidates(ranked, MAX_TO_SIM);
const selectedSet = new Set(selected);

// Per-ladder diverse set (what the picker would keep before global cap).
const byLadder = new Map();
for (const pick of ranked) {
  const k = marketLadderKey(pick);
  const arr = byLadder.get(k) ?? [];
  arr.push(pick);
  byLadder.set(k, arr);
}
const diverseEligible = new Set();
for (const rungs of byLadder.values()) {
  for (const r of pickDiverseLadderRungsForSim(rungs, BOARD_PROP_SIM_RUNGS_PER_LADDER)) {
    diverseEligible.add(r);
  }
}

const alts = ranked.filter((r) => r.propIsAlt);
const notSimulated = alts.filter((r) => !selectedSet.has(r));

function classify(pick) {
  const ladder = marketLadderKey(pick);
  const ladderRungs = byLadder.get(ladder) ?? [];
  const diverseForLadder = pickDiverseLadderRungsForSim(
    ladderRungs,
    BOARD_PROP_SIM_RUNGS_PER_LADDER,
  );
  const inDiverse = diverseForLadder.includes(pick);
  const main = ladderRungs.find((r) => !r.propIsAlt);
  const isMile = isPostedMilestoneAltLine(
    pick.propLine,
    pick.propMarketKey,
    main?.propLine,
  );
  const selectedOnLadder = selected.filter((r) => marketLadderKey(r) === ladder);
  const reasons = [];
  if (!inDiverse) {
    // Beyond the 3-rung diverse set (main + underside milestone + upside milestone).
    reasons.push("duplicate_ladder_rung_budget");
  } else if (selected.length >= MAX_TO_SIM) {
    reasons.push("global_sim_budget_cap");
  } else if (selectedOnLadder.length >= BOARD_PROP_SIM_RUNGS_PER_LADDER) {
    reasons.push("ladder_rung_cap_full");
  } else if (!selectedSet.has(pick)) {
    reasons.push("selection_order_skipped");
  }
  if (!isMile) {
    reasons.push("non_milestone_redundant_alt");
  }
  return {
    sport: pick.sport,
    player: pick.player,
    market: pick.propMarketKey,
    family: milestoneMarketFamily(pick.propMarketKey),
    line: pick.propLine,
    milestone: isMile,
    ladder,
    inDiverse3RungSet: inDiverse,
    selectedOnLadder: selectedOnLadder.map((r) => r.propLine),
    primaryReason: reasons[0] ?? "unknown",
    reasons,
  };
}

const classified = notSimulated.map(classify);
const reasonCounts = {};
for (const c of classified) {
  reasonCounts[c.primaryReason] = (reasonCounts[c.primaryReason] ?? 0) + 1;
}

// Funnel with synthetic grades (all selected get the same qualScore — measures
// seating/correlation, not live MC). Gradeable = has simHit; qualified = pool role.
function toScored(pick) {
  return {
    pick: { ...pick, finalAiScore: qualScore },
    evPct: 4,
    edgePct: 4,
    confidencePct: 58,
    impliedProbPct: 40,
    lineShoppingScore: 1,
    grade: "B",
    simHit: 0.62,
    composite: 7,
    rankScore: pick.propIsAlt ? 50 + (pick.propLine ?? 0) : 80,
  };
}

function funnelForTarget(target) {
  const scored = selected.map(toScored);
  const gradeable = scored.filter((l) => l.simHit != null);
  const qualified = gradeable.filter(
    (l) => boardLegPoolRole(l.pick, l.pick.finalAiScore) != null,
  );
  // Independent after correlation: greedy seat under caps
  const independent = [];
  const maxProps = maxPropsPerGame(target);
  const maxGl = maxLegsPerGame(target);
  for (const leg of [...qualified].sort((a, b) => b.rankScore - a.rankScore)) {
    const p = leg.pick;
    if (wouldRepeatMarketLadder(p, independent)) continue;
    if (wouldRepeatPlayerProp(p, independent)) continue;
    if (wouldExceedMaxPropsPerGame(p, independent, maxProps)) continue;
    if (wouldExceedMaxLegsPerGame(p, independent, maxGl)) continue;
    independent.push(p);
  }
  const ticket = topUpTicketFromQualifiedScored([], qualified, target);
  const bySport = {};
  for (const s of sports) {
    const avail = alts.filter((r) => r.sport === s.sport);
    const sim = selected.filter((r) => r.sport === s.sport && r.propIsAlt);
    const mains = selected.filter((r) => r.sport === s.sport && !r.propIsAlt);
    const sportQualified = qualified.filter((l) => l.pick.sport === s.sport);
    const sportIndep = independent.filter((p) => p.sport === s.sport);
    const sportSeats = ticket.filter((p) => p.sport === s.sport);
    bySport[s.sport] = {
      availableAlts: avail.length,
      availableMains: ranked.filter((r) => r.sport === s.sport && !r.propIsAlt).length,
      simulatedAlts: sim.length,
      simulatedMains: mains.length,
      simulatedTotal: sim.length + mains.length,
      gradeable: sportQualified.length, // synthetic: sim ⇒ gradeable
      qualified: sportQualified.length,
      independentAfterCorrelation: sportIndep.length,
      finalTicketSeats: sportSeats.length,
      finalTicketProps: sportSeats.filter((p) => p.isProp).length,
    };
  }
  return {
    target,
    maxPropsPerGame: maxProps,
    maxLegsPerGame: maxGl,
    totals: {
      availableAlts: alts.length,
      simulatedAlts: selected.filter((r) => r.propIsAlt).length,
      simulatedTotal: selected.length,
      skippedAlts: notSimulated.length,
      skippedFromSelectCount: skippedCount,
      gradeable: gradeable.length,
      qualified: qualified.length,
      independentAfterCorrelation: independent.length,
      finalTicketSeats: ticket.length,
      finalTicketProps: ticket.filter((p) => p.isProp).length,
    },
    bySport,
    ticket: ticket.map((p) => ({
      sport: p.sport,
      player: p.player,
      market: p.propMarketKey ?? p.market,
      line: p.propLine,
      alt: !!p.propIsAlt,
      pick: p.pick,
    })),
  };
}

const report = {
  maxToSim: MAX_TO_SIM,
  rungsPerLadder: BOARD_PROP_SIM_RUNGS_PER_LADDER,
  availableAlts: alts.length,
  simulatedAlts: selected.filter((r) => r.propIsAlt).length,
  notSimulatedCount: notSimulated.length,
  reasonCounts,
  notSimulatedDetail: classified,
  prioritizationCheck: {
    note: "Within each ladder, diverse set prefers underside milestone then upside milestone before redundant nearest non-milestone alts",
    exampleRecYds: (() => {
      const rungs = ranked.filter(
        (r) => r.sport === "nfl" && r.player === "nfl_P0",
      );
      return pickDiverseLadderRungsForSim(rungs, 3).map((r) => ({
        line: r.propLine,
        alt: r.propIsAlt,
        milestone: isPostedMilestoneAltLine(r.propLine, r.propMarketKey, 52.5),
      }));
    })(),
  },
  funnel7: funnelForTarget(7),
  funnel15: funnelForTarget(15),
};

const out = process.env.ALT_FUNNEL_OUT || "/tmp/alt-milestone-funnel-audit.json";
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  notSimulatedCount: report.notSimulatedCount,
  reasonCounts: report.reasonCounts,
  prioritizationExample: report.prioritizationCheck.exampleRecYds,
  funnel7: report.funnel7.totals,
  funnel15: report.funnel15.totals,
  bySport7: report.funnel7.bySport,
}, null, 2));
console.log("wrote", out);
