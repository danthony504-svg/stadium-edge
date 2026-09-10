// Team-level MLB batting splits vs LHP / RHP (StatMuse) and game-level compare
// vs tonight's probable starter hand. Honest nulls — never fabricate missing stats.

import { askStatMuse } from "./statmuse.ts";
import type {
  MlbGamePlatoonCompare,
  MlbHand,
  MlbStarterProfile,
  MlbTeamHandSplit,
} from "./mlbTeamPlatoonCompact.ts";

export {
  compactGamePlatoonForUpload,
  type MlbGamePlatoonCompare,
  type MlbHand,
  type MlbStarterProfile,
  type MlbTeamHandSplit,
  type MlbTeamPlatoonSide,
  type PitcherTendencySummary,
} from "./mlbTeamPlatoonCompact.ts";

export type MlbTeamBattingSplits = {
  team: string;
  vsLeft: MlbTeamHandSplit | null;
  vsRight: MlbTeamHandSplit | null;
};

const HAND_PHRASE: Record<MlbHand, string> = {
  Left: "left-handed pitchers",
  Right: "right-handed pitchers",
};

function parseDecimal(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseCount(answer: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = answer.match(re);
    if (m?.[1]) {
      const n = parseDecimal(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

function deriveRates(split: MlbTeamHandSplit): MlbTeamHandSplit {
  const pa = split.plateAppearances;
  const games = split.games;
  const kRate = pa && split.strikeouts != null && pa > 0 ? Math.round((split.strikeouts / pa) * 1000) / 1000 : null;
  const bbRate = pa && split.walks != null && pa > 0 ? Math.round((split.walks / pa) * 1000) / 1000 : null;
  const hitsPerGame =
    games && split.hits != null && games > 0 ? Math.round((split.hits / games) * 100) / 100 : null;
  const hrPerGame =
    games && split.homeRuns != null && games > 0 ? Math.round((split.homeRuns / games) * 100) / 100 : null;
  const iso =
    split.slg != null && split.avg != null ? Math.round((split.slg - split.avg) * 1000) / 1000 : null;
  return { ...split, kRate, bbRate, hitsPerGame, hrPerGame, iso };
}

async function fetchSplitMetric(
  team: string,
  hand: MlbHand,
  kind: string,
  patterns: RegExp[],
): Promise<{ value: number | null; line: string | null }> {
  const q = `${team} ${kind} vs ${HAND_PHRASE[hand]} this season`;
  const r = await askStatMuse(q, "mlb");
  if (!r.answer) return { value: null, line: null };
  return { value: parseCount(r.answer, patterns), line: r.answer };
}

/** Pull team batting line vs one pitcher hand from StatMuse (cached per metric). */
export async function fetchTeamBattingSplitVsHand(
  team: string,
  hand: MlbHand,
): Promise<MlbTeamHandSplit | null> {
  const name = String(team || "").trim();
  if (!name) return null;

  const [avg, obp, slg, ops, hits, hr, walks, k, pa, games] = await Promise.all([
    fetchSplitMetric(team, hand, "batting average", [/batting average of ([\d.]+)/i, /batting ([\d.]+)/i]),
    fetchSplitMetric(team, hand, "on-base percentage", [/on-base percentage of ([\d.]+)/i, /obp of ([\d.]+)/i]),
    fetchSplitMetric(team, hand, "slugging percentage", [/slugging percentage of ([\d.]+)/i, /slugging ([\d.]+)/i]),
    fetchSplitMetric(team, hand, "ops", [/ops of ([\d.]+)/i, /an ops of ([\d.]+)/i]),
    fetchSplitMetric(team, hand, "hits", [/([\d,]+)\s+hits\b/i]),
    fetchSplitMetric(team, hand, "home runs", [/([\d,]+)\s+home runs?\b/i, /hit ([\d,]+) home runs/i]),
    fetchSplitMetric(team, hand, "walks", [/([\d,]+)\s+(?:walks|free passes)\b/i]),
    fetchSplitMetric(team, hand, "strikeouts", [/struck out ([\d,]+) times/i, /([\d,]+)\s+strikeouts?\b/i]),
    fetchSplitMetric(team, hand, "plate appearances", [/([\d,]+)\s+plate appearances/i]),
    fetchSplitMetric(team, hand, "games", [/played ([\d,]+)\s+games/i, /([\d,]+)\s+games\b/i]),
  ]);

  const sourceBits = [avg, obp, slg, ops, hits, hr, walks, k, pa, games]
    .map((x) => x.line)
    .filter(Boolean) as string[];

  if (!sourceBits.length && avg.value == null && ops.value == null) return null;

  const base: MlbTeamHandSplit = {
    hand,
    sourceLine: sourceBits[0] ?? null,
    avg: avg.value,
    obp: obp.value,
    slg: slg.value,
    ops: ops.value,
    hits: hits.value,
    homeRuns: hr.value,
    walks: walks.value,
    strikeouts: k.value,
    plateAppearances: pa.value,
    games: games.value,
    kRate: null,
    bbRate: null,
    hitsPerGame: null,
    hrPerGame: null,
    iso: null,
    woba: null,
    wrcPlus: null,
    hardHitRate: null,
    groundBallRate: null,
    flyBallRate: null,
  };
  return deriveRates(base);
}

export async function fetchTeamBattingSplits(team: string): Promise<MlbTeamBattingSplits> {
  const [vsLeft, vsRight] = await Promise.all([
    fetchTeamBattingSplitVsHand(team, "Left"),
    fetchTeamBattingSplitVsHand(team, "Right"),
  ]);
  return { team, vsLeft, vsRight };
}

function splitForHand(splits: MlbTeamBattingSplits, hand: MlbHand | null): MlbTeamHandSplit | null {
  if (!hand) return null;
  return hand === "Left" ? splits.vsLeft : splits.vsRight;
}

function offenseLeanFromOps(awayOps: number | null, homeOps: number | null): "away" | "home" | "even" | null {
  if (awayOps == null || homeOps == null) return null;
  const diff = awayOps - homeOps;
  if (Math.abs(diff) < 0.025) return "even";
  return diff > 0 ? "away" : "home";
}

export async function buildMlbGamePlatoonCompare(opts: {
  game: string;
  awayTeam: string;
  homeTeam: string;
  awayPitcher?: MlbStarterProfile | null;
  homePitcher?: MlbStarterProfile | null;
}): Promise<MlbGamePlatoonCompare | null> {
  const { game, awayTeam, homeTeam, awayPitcher, homePitcher } = opts;
  if (!awayTeam || !homeTeam) return null;

  const [awaySplits, homeSplits] = await Promise.all([
    fetchTeamBattingSplits(awayTeam),
    fetchTeamBattingSplits(homeTeam),
  ]);

  const awayHand = homePitcher?.throws ?? null;
  const homeHand = awayPitcher?.throws ?? null;
  const awaySplit = splitForHand(awaySplits, awayHand);
  const homeSplit = splitForHand(homeSplits, homeHand);

  if (!awaySplit && !homeSplit && !awayPitcher && !homePitcher) return null;

  const lean = offenseLeanFromOps(awaySplit?.ops ?? null, homeSplit?.ops ?? null);
  let note: string | null = null;
  if (lean === "away" && awaySplit?.ops != null && awayHand) {
    note = `${awayTeam} OPS ${awaySplit.ops} vs ${awayHand === "Left" ? "LHP" : "RHP"} (${homePitcher?.name ?? "starter"})`;
  } else if (lean === "home" && homeSplit?.ops != null && homeHand) {
    note = `${homeTeam} OPS ${homeSplit.ops} vs ${homeHand === "Left" ? "LHP" : "RHP"} (${awayPitcher?.name ?? "starter"})`;
  }

  return {
    game,
    away: {
      team: awayTeam,
      opposingStarter: homePitcher ?? { name: null, throws: null, tendency: null },
      splitVsStarterHand: awaySplit,
    },
    home: {
      team: homeTeam,
      opposingStarter: awayPitcher ?? { name: null, throws: null, tendency: null },
      splitVsStarterHand: homeSplit,
    },
    offenseLean: lean,
    note,
  };
}
