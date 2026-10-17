#!/usr/bin/env node
/**
 * Probe: why oddsCleared>0 but staged=0 for college player props.
 * Monkey-patches stage path counting by wrapping evaluateCoachQualification calls
 * via instrumented copy of stageFootballPropsOnlyLegsWithCap logic.
 */
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const u = (rel) => pathToFileURL(path.join(root, rel)).href;
process.chdir(root);
process.env.EXPO_PUBLIC_DOMAIN =
  process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com";

const ASK = "7 leg college football player props";
const TARGET = 7;

const { getGames, getOdds, fetchFullBoardPropPool } = await import(u("lib/api.ts"));
const {
  filterBettableOddsGames,
  slateDayFromThread,
  filterOddsGamesForSlateDay,
  filterOddsForSlateDay,
} = await import(u("lib/slate.ts"));
const {
  hardLockedSportsFromAsk,
  canonicalizeCoachAskSport,
} = await import(u("lib/coachAskSportScope.ts"));
const { coachBoardSportsForAsk } = await import(u("lib/coachPropBoardCoverage.ts"));
const {
  coachAskTeamScope,
  excludedTeamScopesFromText,
  resolveExcludedTeamIdsFromGames,
  filterOddsGamesForCoachAskTeams,
  filterPicksForCoachAskTeams,
} = await import(u("lib/coachAskTeamScope.ts"));
const { parseCoachAskMarketConstraint } = await import(
  u("lib/coachAskMarketFilter.ts")
);
const { askAllowsNcaafPlayerProps } = await import(u("lib/boardScanPropDelivery.ts"));
const { buildFootballPropsOnlyTicket } = await import(
  u("lib/coachFootballPropsOnlyTicket.ts")
);
const propsOnlyMod = await import(u("lib/coachFootballPropsOnly.ts"));
const { evaluateCoachQualification } = await import(
  u("lib/coach/qualifyCoachCandidate.ts")
);
const {
  normalizePropsOnlyPick,
  propsOnlyLegClearsOdds,
  propsOnlyCollapseLadderKey,
  PROPS_ONLY_ODDS_SLACK,
} = await import(u("lib/coachFootballPropsOnlyGrade.ts"));
const {
  isRareCountPropMarket,
  rareCountGameFamilyKey,
} = await import(u("lib/rareCountPropModel.ts"));
const { anytimeTdNormalSeatAllowed, isAnytimeTdPropMarket } = await import(
  u("lib/anytimeTdPropModel.ts")
);
const { rareMultiCountNormalSeatAllowed } = await import(
  u("lib/rareMultiCountCoachGate.ts")
);

process.on("unhandledRejection", (err) => {
  console.error("[probe] unhandledRejection", err?.message || err);
});

const sports = coachBoardSportsForAsk(ASK, TARGET, ["ncaaf"]);
const lockedSports = hardLockedSportsFromAsk(ASK);
const ac = new AbortController();
const stamp = (rows, sport) => {
  const want = canonicalizeCoachAskSport(sport);
  return rows
    .map((g) => {
      const tagged = canonicalizeCoachAskSport(g.sport);
      if (tagged && tagged !== want) return null;
      return { ...g, sport: tagged || want };
    })
    .filter(Boolean);
};

const [espnGamesRaw, oddsRaw] = await Promise.all([
  Promise.all(
    sports.map((s) =>
      getGames(s, ac.signal)
        .catch(() => [])
        .then((rows) => stamp(rows, s)),
    ),
  ).then((r) => r.flat()),
  Promise.all(
    sports.map((s) =>
      getOdds(s, ac.signal)
        .catch(() => [])
        .then((rows) => stamp(rows, s)),
    ),
  ).then((r) => filterBettableOddsGames(r.flat())),
]);

const teamScope = coachAskTeamScope(ASK);
let excludedTeams = excludedTeamScopesFromText(ASK);
excludedTeams = resolveExcludedTeamIdsFromGames(excludedTeams, espnGamesRaw);
const sportBelt = (rows) =>
  lockedSports?.length
    ? rows.filter((g) => {
        const s = canonicalizeCoachAskSport(g.sport);
        return !!s && lockedSports.includes(s);
      })
    : rows;
const slateDay = slateDayFromThread(ASK, []);
let oddsGames = filterOddsGamesForSlateDay(
  filterOddsGamesForCoachAskTeams(sportBelt(oddsRaw), teamScope, excludedTeams),
  slateDay,
);
let espnGames = filterOddsForSlateDay(
  filterOddsGamesForCoachAskTeams(sportBelt(espnGamesRaw), teamScope, excludedTeams),
  slateDay,
);
let propPool = await fetchFullBoardPropPool(oddsGames, espnGames, [], ac.signal).catch(
  () => [],
);
propPool = filterOddsForSlateDay(propPool, slateDay);
propPool = filterPicksForCoachAskTeams(propPool, teamScope, excludedTeams);

console.error("[probe] pool", propPool.length, "allows", askAllowsNcaafPlayerProps(ASK));

// Intercept stageFootballPropsOnlyLegs to count reject reasons on scored legs.
const origStage = propsOnlyMod.stageFootballPropsOnlyLegs;
const stageStats = {
  scoredIn: 0,
  oddsFail: 0,
  qualifyFail: {},
  rareFail: 0,
  anytimeFail: 0,
  ladderDedupe: 0,
  perGameCap: 0,
  marketSideCap: 0,
  rareFamilyCap: 0,
  seated: 0,
  samples: [],
};

propsOnlyMod.stageFootballPropsOnlyLegs = function instrumentedStage(
  scored,
  target,
  oddsSlack = PROPS_ONLY_ODDS_SLACK,
  opts,
) {
  stageStats.scoredIn = scored.length;
  const ordered = [...scored].sort(propsOnlyMod.comparePropsOnlyLegsByReliableEv);
  const uniqueGames = new Set(
    ordered.map((l) => String(l.pick.game ?? "")).filter(Boolean),
  ).size;
  const ceiling = propsOnlyMod.propsOnlyPerGameCeiling(target, uniqueGames || 1);
  // Walk once at max ceiling to attribute every reject (not early-return path).
  const maxPerGame = ceiling;
  const maxSameGameMarketSide = ceiling;
  const usedPlayerMarket = new Set();
  const usedGames = new Map();
  const usedGameMarketSide = new Map();
  const usedRareGameFamily = new Map();
  const picks = [];
  for (const leg of ordered) {
    const p = normalizePropsOnlyPick(leg.pick);
    if (!propsOnlyLegClearsOdds(p, leg.simHit, oddsSlack)) {
      stageStats.oddsFail += 1;
      continue;
    }
    const grade = leg.grade ?? p.finalAiScore?.grade ?? null;
    const confidencePct =
      leg.confidencePct ?? p.finalAiScore?.confidencePct ?? null;
    const edgePct = leg.edgePct ?? p.finalAiScore?.edgePct ?? null;
    const simHit = leg.simHit ?? p.finalAiScore?.simHit ?? null;
    const q = evaluateCoachQualification(
      {
        ...p,
        isProp: true,
        propsOnlyTicket: true,
        grade,
        confidencePct,
        edgePct,
        simHit,
        odds: p.odds,
        finalAiScore: p.finalAiScore,
      },
      { requestStyle: "props_only", isProp: true },
    );
    if (stageStats.samples.length < 15) {
      stageStats.samples.push({
        player: p.player,
        market: p.propMarketKey ?? p.market,
        line: p.propLine,
        side: p.propSide,
        isAlt: !!p.propIsAlt,
        odds: p.odds,
        simHit,
        grade,
        confidencePct,
        edgePct,
        qualify: q.reason,
        status: q.status,
        game: p.game,
      });
    }
    if (q.status !== "qualified") {
      stageStats.qualifyFail[q.reason] = (stageStats.qualifyFail[q.reason] ?? 0) + 1;
      continue;
    }
    if (
      !rareMultiCountNormalSeatAllowed(
        { ...p, isProp: true },
        {
          askText: opts?.askText,
          ticketStyle: opts?.ticketStyle,
          hitReliability: leg.hitReliability,
          allowLotteryPath: opts?.allowRareMultiCount,
        },
      )
    ) {
      stageStats.rareFail += 1;
      continue;
    }
    if (
      !anytimeTdNormalSeatAllowed(
        { ...p, isProp: true },
        { hitReliability: leg.hitReliability, odds: p.odds, simHit },
      )
    ) {
      stageStats.anytimeFail += 1;
      continue;
    }
    const pm = propsOnlyCollapseLadderKey(p);
    if (usedPlayerMarket.has(pm)) {
      stageStats.ladderDedupe += 1;
      continue;
    }
    const gameKey = String(p.game ?? "");
    const gameCount = usedGames.get(gameKey) ?? 0;
    if (gameCount >= maxPerGame) {
      stageStats.perGameCap += 1;
      continue;
    }
    const marketSide = `${String(p.propMarketKey ?? p.market ?? "")
      .toLowerCase()
      .replace(/_/g, " ")}|${String(p.propSide ?? "").toLowerCase()}`;
    const gameMarketSide = `${gameKey}|${marketSide}`;
    const gmsCount = usedGameMarketSide.get(gameMarketSide) ?? 0;
    if (gmsCount >= maxSameGameMarketSide) {
      stageStats.marketSideCap += 1;
      continue;
    }
    if (!opts?.allowRareCountFamilyStack) {
      const rareKey = rareCountGameFamilyKey({
        game: p.game,
        market: p.propMarketKey ?? p.market,
      });
      if (rareKey && (usedRareGameFamily.get(rareKey) ?? 0) >= 1) {
        stageStats.rareFamilyCap += 1;
        continue;
      }
    }
    usedPlayerMarket.add(pm);
    usedGames.set(gameKey, gameCount + 1);
    usedGameMarketSide.set(gameMarketSide, gmsCount + 1);
    picks.push(p);
    stageStats.seated += 1;
    if (picks.length >= target) break;
  }
  // Still call original for real ticket behavior
  return origStage(scored, target, oddsSlack, opts);
};

const built = await buildFootballPropsOnlyTicket({
  target: TARGET,
  pool: propPool,
  realOdds: [],
  teamIdMap: new Map(),
  signal: ac.signal,
  askText: ASK,
  onStatus: (s) => console.error("[status]", s),
});

const out = {
  ask: ASK,
  failDiag: built.failDiag ?? null,
  pickCount: built.picks?.length ?? 0,
  stageStats,
  marketConstraint: parseCoachAskMarketConstraint(ASK, []),
};
mkdirSync("/opt/cursor/artifacts", { recursive: true });
writeFileSync(
  "/opt/cursor/artifacts/ncaaf-props-stage-reject-probe.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
