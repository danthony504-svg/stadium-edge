/**
 * Phase 1 before/after micro-benchmark for alt-market fairness.
 * Run: node --import tsx lib/coachAltMarketFairness.bench.ts
 * (or via the suite's node --test harness after compile)
 *
 * Compares candidate allocation composition under the current fair selectors
 * against a synthetic "mains-first / no alt floor" baseline that mirrors the
 * pre-Phase-1 behavior for reporting only — does not ship that path.
 */
import {
  BOARD_PROP_SIM_ALT_QUOTA_FRACTION,
  selectBoardPropSimCandidates,
  selectFootballMixPropSimCandidates,
  footballMixSimFamily,
} from "./boardPropSimExpansion.ts";
import { boardScanMaxPropsToSimForMix } from "./boardScanScope.ts";
import { marketLadderKey } from "./marketLadderKey.ts";
import {
  collapseScoredLegsByMarketLadder,
} from "./marketLadderExhaustion.ts";
import { selectGreedyBoardLegs, type BoardScoredLeg } from "./ticketStaging.ts";

type FakePick = {
  game: string;
  market: string;
  propMarketKey: string;
  pick: string;
  odds: number;
  isProp: true;
  sport: string;
  player: string;
  propLine: number;
  propSide: "Over";
  propIsAlt: boolean;
  athleteId: string;
};

function buildPool(n: number): FakePick[] {
  const out: FakePick[] = [];
  const markets = [
    { market: "Rush Yds", key: "player_rush_yds" },
    { market: "Pass Yds", key: "player_pass_yds" },
    { market: "Rec Yds", key: "player_reception_yds" },
    { market: "Pass TDs", key: "player_pass_tds" },
    { market: "Receptions", key: "player_receptions" },
  ];
  for (let i = 0; i < n; i++) {
    const m = markets[i % markets.length]!;
    const mainLine = 50.5 + (i % 8) * 5;
    const isAlt = i % 3 !== 0;
    const line = isAlt ? mainLine + 25 + (i % 4) * 10 : mainLine;
    out.push({
      game: `G${i % 16} @ H${i % 16}`,
      market: m.market,
      propMarketKey: m.key,
      pick: `P${i} Over ${line} ${m.market}`,
      odds: isAlt ? 150 + (i % 20) * 10 : -110,
      isProp: true,
      sport: "nfl",
      player: `P${i}`,
      propLine: line,
      propSide: "Over",
      propIsAlt: isAlt,
      athleteId: `id-${i}`,
    });
  }
  return out;
}

/** Pre-Phase-1 style: walk rank order, main O/U first, no alt floor. */
function selectMainsFirstBaseline<T extends FakePick>(
  ranked: T[],
  maxToSim: number,
): T[] {
  const selected: T[] = [];
  const ladderCounts = new Map<string, number>();
  const mains = ranked.filter((p) => !p.propIsAlt);
  const alts = ranked.filter((p) => p.propIsAlt);
  for (const pick of [...mains, ...alts]) {
    if (selected.length >= maxToSim) break;
    const ladder = marketLadderKey(pick);
    const used = ladderCounts.get(ladder) ?? 0;
    if (used >= 3) continue;
    ladderCounts.set(ladder, used + 1);
    selected.push(pick);
  }
  return selected;
}

function categorize(selected: FakePick[]) {
  let main = 0;
  let alt = 0;
  const families: Record<string, number> = {};
  for (const p of selected) {
    if (p.propIsAlt) alt += 1;
    else main += 1;
    const fam = footballMixSimFamily(p);
    families[fam] = (families[fam] ?? 0) + 1;
  }
  return { main, alt, families, total: selected.length };
}

function timed<T>(fn: () => T, loops: number): { result: T; ms: number } {
  const t0 = performance.now();
  let result!: T;
  for (let i = 0; i < loops; i++) result = fn();
  return { result, ms: performance.now() - t0 };
}

const pool = buildPool(400);
const cap = boardScanMaxPropsToSimForMix(7, pool.length);

const before = timed(() => selectMainsFirstBaseline(pool, cap), 50);
const afterGeneric = timed(() => selectBoardPropSimCandidates(pool, cap), 50);
const afterFootball = timed(() => selectFootballMixPropSimCandidates(pool, cap), 50);

const beforeCat = categorize(before.result);
const afterGenCat = categorize(afterGeneric.result.selected);
const afterFbCat = categorize(afterFootball.result.selected);

const qualScore = {
  composite: 8,
  grade: "B+",
  confidencePct: 58,
  edgePct: 4,
  simHit: 0.56,
  simAligned: true,
  highRiskValuePlay: false,
  recommends: true,
  factors: [],
  rubric: { composite: 8, grade: "B+", confidencePct: 58, edgePct: 4, scores: {} as never },
};

const scored: BoardScoredLeg[] = pool.slice(0, 80).map((p, i) => ({
  pick: { ...p, finalAiScore: p.propIsAlt ? { ...qualScore, recommends: false, grade: "B", composite: 7 } : qualScore },
  evPct: 2,
  edgePct: 3,
  confidencePct: 55,
  impliedProbPct: 50,
  lineShoppingScore: 1,
  grade: "B",
  simHit: 0.56,
  composite: 7,
  rankScore: p.propIsAlt ? 90 - (i % 10) : 60 - (i % 10),
}));

const ticketTimed = timed(() => {
  const collapsed = collapseScoredLegsByMarketLadder(scored);
  return selectGreedyBoardLegs(collapsed, 7);
}, 100);
const ticket = ticketTimed.result;
const ticketMain = ticket.filter((p) => !p.propIsAlt).length;
const ticketAlt = ticket.filter((p) => !!p.propIsAlt).length;

const report = {
  mixCap: cap,
  altQuotaFraction: BOARD_PROP_SIM_ALT_QUOTA_FRACTION,
  before: {
    label: "mains-first baseline (pre-Phase-1 mimic)",
    ...beforeCat,
    msPer50: Number(before.ms.toFixed(2)),
  },
  afterGeneric: {
    label: "selectBoardPropSimCandidates",
    ...afterGenCat,
    msPer50: Number(afterGeneric.ms.toFixed(2)),
  },
  afterFootball: {
    label: "selectFootballMixPropSimCandidates",
    ...afterFbCat,
    familyCounts: afterFootball.result.familyCounts,
    msPer50: Number(afterFootball.ms.toFixed(2)),
  },
  ticketComposition: {
    legs: ticket.length,
    main: ticketMain,
    alt: ticketAlt,
    msPer100: Number(ticketTimed.ms.toFixed(2)),
  },
  mem: process.memoryUsage(),
};

console.log(JSON.stringify(report, null, 2));
