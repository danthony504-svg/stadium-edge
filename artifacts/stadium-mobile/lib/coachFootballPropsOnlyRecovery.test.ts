import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  collapsePropsOnlyToBestEvSides,
  gradeFootballPropFromHistory,
  gradeFootballPropsOnlyFromHistory,
  propsOnlyLegClearsOdds,
  PROPS_ONLY_ODDS_SLACK,
  PROPS_ONLY_RECOVERY_ODDS_SLACK,
} from "./coachFootballPropsOnlyGrade.ts";
import {
  FOOTBALL_SKILL_RECOVERY_MARKET_KEYS,
  filterPoolByFootballRecoverySports,
  filterPoolForFootballSkillRecovery,
  footballSkillRecoveryNote,
  isFootballSkillRecoveryMarket,
  normalizeFootballRecoverySport,
  shouldRecoverPropsOnlyWithFootballSkillBoard,
} from "./coachFootballPropsOnlyRecovery.ts";
import { stageFootballPropsOnlyLegs } from "./coachFootballPropsOnly.ts";
import {
  COACH_SIM_MIN_CONFIDENCE,
  COACH_SIM_MIN_GRADE,
} from "./gameSimQualityGates.ts";
import { derivePropsOnlyFailCode } from "./coachPropsOnlyFailReason.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";

test("football skill recovery markets cover TD + yards + receptions + sacks", () => {
  for (const k of [
    "player_anytime_td",
    "player_rush_yds_alternate",
    "player_reception_yds",
    "player_receptions",
    "player_sacks",
    "player_pass_yds",
    "player_pass_tds",
  ]) {
    assert.equal(isFootballSkillRecoveryMarket(k), true, k);
  }
  assert.equal(isFootballSkillRecoveryMarket("player_points"), false);
  assert.equal(isFootballSkillRecoveryMarket("batter_home_runs"), false);
  assert.ok(FOOTBALL_SKILL_RECOVERY_MARKET_KEYS.includes("player_sacks"));
});

test("filterPoolForFootballSkillRecovery keeps NFL/NCAAF skill + alts when both allowed", () => {
  const pool = [
    { marketKey: "player_anytime_td", sport: "nfl" },
    { marketKey: "player_rush_yds_alternate", sport: "nfl" },
    { marketKey: "player_receptions", sport: "ncaaf" },
    { marketKey: "player_sacks", sport: "nfl" },
    { marketKey: "player_points", sport: "nba" },
    { marketKey: "batter_home_runs", sport: "mlb" },
  ];
  const out = filterPoolForFootballSkillRecovery(pool, {
    allowedSports: ["nfl", "ncaaf"],
  });
  assert.deepEqual(
    out.map((r) => r.marketKey).sort(),
    [
      "player_anytime_td",
      "player_receptions",
      "player_rush_yds_alternate",
      "player_sacks",
    ].sort(),
  );
});

test("adversarial mixed recovery: college scope excludes NFL solely by sport", () => {
  // Threshold constants must stay frozen on this hardening change.
  assert.equal(COACH_SIM_MIN_CONFIDENCE, 52);
  assert.equal(COACH_SIM_MIN_GRADE, "C+");
  assert.equal(PROPS_ONLY_ODDS_SLACK, 0.025);
  assert.equal(PROPS_ONLY_RECOVERY_ODDS_SLACK, 0.08);

  const mixed = [
    {
      marketKey: "player_rush_yds",
      sport: "ncaaf",
      player: "CFB_Rush",
      athleteId: "cfb-r1",
    },
    {
      marketKey: "player_pass_yds_alternate",
      sport: "ncaaf",
      player: "CFB_PassAlt",
      athleteId: "cfb-p1",
    },
    {
      marketKey: "player_rush_yds",
      sport: "nfl",
      player: "NFL_Rush",
      athleteId: "nfl-r1",
    },
    {
      marketKey: "player_receptions",
      sport: "nfl",
      player: "NFL_Rec",
      athleteId: "nfl-rec1",
    },
    {
      marketKey: "player_rush_yds",
      sport: null,
      player: "Untagged",
      athleteId: "x1",
    },
    { marketKey: "player_points", sport: "ncaaf", player: "CFB_Points" },
  ];

  const collegeScope = { allowedSports: ["ncaaf"] as const };
  const scoped = filterPoolForFootballSkillRecovery(mixed, collegeScope);
  assert.deepEqual(
    scoped.map((r) => r.player).sort(),
    ["CFB_PassAlt", "CFB_Rush"].sort(),
  );
  assert.equal(
    scoped.some((r) => normalizeFootballRecoverySport(r.sport) === "nfl"),
    false,
    "NFL rows must be excluded solely by sport scope",
  );
  assert.equal(
    scoped.some((r) => !r.sport),
    false,
    "missing sport tags fail closed under scope",
  );

  // Sport belt alone (locked-market path) also drops NFL / untagged.
  const sportBelt = filterPoolByFootballRecoverySports(mixed, collegeScope);
  assert.ok(sportBelt.every((r) => normalizeFootballRecoverySport(r.sport) === "ncaaf"));
  assert.equal(sportBelt.some((r) => r.player?.startsWith("NFL")), false);

  // Qualified NCAAF legs still stage; NFL legs never enter the scored set.
  const ncaafScored: BoardScoredLeg[] = scoped.map((row, i) => {
    const pick = {
      game: `CFB Away${i} @ Home${i}`,
      market: row.marketKey,
      propMarketKey: String(row.marketKey).replace(/_alternate$/, ""),
      pick: `${row.player} Over 50.5`,
      odds: -110,
      isProp: true,
      player: row.player,
      propLine: 50.5,
      propSide: "Over" as const,
      sport: "ncaaf",
      athleteId: row.athleteId,
      propsOnlyTicket: true,
      propIsAlt: String(row.marketKey).includes("alternate"),
    };
    return {
      pick,
      simHit: 0.65,
      evPct: 12,
      edgePct: 12,
      confidencePct: 60,
      impliedProbPct: 52.4,
      lineShoppingScore: null,
      grade: "B",
      composite: 7,
      rankScore: 7 + i,
      hitReliability: 1,
    } as BoardScoredLeg;
  });
  const staged = stageFootballPropsOnlyLegs(ncaafScored, 2);
  assert.equal(staged.length, 2, "qualified NCAAF recovery rows must stage");
  assert.ok(staged.every((p) => p.sport === "ncaaf"));
  assert.ok(staged.every((p) => !String(p.player).startsWith("NFL")));

  // CONFIDENCE_GATE derivation unchanged when confidence is the terminal wipe.
  assert.equal(
    derivePropsOnlyFailCode({
      target: 7,
      pool: 100,
      athleteLinked: 100,
      candidates: 10,
      historyLoaded: 5,
      graded: 10,
      bestEvSides: 8,
      oddsCleared: 5,
      staged: 0,
      nullReasons: {},
      stageRejects: {
        qualifyFail: { confidence_floor: 5 },
        rareFail: 0,
        anytimeFail: 0,
        ladderDedupe: 0,
        perGameCap: 0,
        marketSideCap: 0,
        rareFamilyCap: 0,
      },
    }),
    "PROPS_ONLY_CONFIDENCE_GATE",
  );
});

test("shouldRecover only when graded>0 and staged=0 with a skill pool", () => {
  assert.equal(
    shouldRecoverPropsOnlyWithFootballSkillBoard({
      graded: 42,
      staged: 0,
      preferredPoolSize: 42,
      skillPoolSize: 200,
    }),
    true,
  );
  assert.equal(
    shouldRecoverPropsOnlyWithFootballSkillBoard({
      graded: 42,
      staged: 3,
      preferredPoolSize: 42,
      skillPoolSize: 200,
    }),
    false,
  );
  assert.equal(
    shouldRecoverPropsOnlyWithFootballSkillBoard({
      graded: 0,
      staged: 0,
      preferredPoolSize: 42,
      skillPoolSize: 200,
    }),
    false,
  );
  assert.equal(
    shouldRecoverPropsOnlyWithFootballSkillBoard({
      graded: 42,
      staged: 0,
      preferredPoolSize: 42,
      skillPoolSize: 0,
    }),
    false,
  );
});

test("phone 7-leg touchdown: TD wipe recovers yards/receptions/sacks that clear odds", () => {
  // Preferred TD ladder: all fail clearsOdds (short juice vs ~37% hit).
  const tds: ParsedPick[] = [];
  const skill: ParsedPick[] = [];
  const histories: Record<string, { recent: { stats: Record<string, string> }[] }> = {};

  for (let i = 0; i < 7; i++) {
    const name = `Scorer${i}`;
    const id = `td-${i}`;
    const game = `Away${i} @ Home${i}`;
    tds.push({
      game,
      market: "Anytime TD",
      propMarketKey: "player_anytime_td",
      pick: `${name} Anytime TD`,
      odds: -150,
      isProp: true,
      player: name,
      propLine: 0.5,
      propSide: "Over",
      sport: "nfl",
      athleteId: id,
    } as ParsedPick);
    histories[`${name}#${id}`] = {
      recent: Array.from({ length: 8 }, (_, g) => ({
        stats: {
          rushingTouchdowns: "0",
          receivingTouchdowns: g % 3 === 0 ? "1" : "0",
          passingTouchdowns: "0",
          rushingYards: "65",
          receivingYards: "55",
          receptions: "5",
        },
      })),
    };
  }

  // Skill recovery board: yards / receptions / sacks that clear.
  const skillSpecs: {
    market: string;
    player: string;
    line: number;
    odds: number;
    stats: Record<string, string>;
  }[] = [
    {
      market: "player_rush_yds_alternate",
      player: "Rusher0",
      line: 49.5,
      odds: -110,
      stats: { rushingYards: "70" },
    },
    {
      market: "player_pass_yds",
      player: "Passer0",
      line: 220.5,
      odds: -110,
      stats: { passingYards: "260" },
    },
    {
      market: "player_reception_yds",
      player: "Recv0",
      line: 45.5,
      odds: -110,
      stats: { receivingYards: "65" },
    },
    {
      market: "player_receptions",
      player: "Recv1",
      line: 3.5,
      odds: -115,
      stats: { receptions: "6" },
    },
    {
      market: "player_sacks",
      player: "Edge0",
      line: 0.5,
      odds: 120,
      stats: { SACKS: "1" },
    },
    {
      market: "player_rush_yds",
      player: "Rusher1",
      line: 55.5,
      odds: -110,
      stats: { rushingYards: "80" },
    },
    {
      market: "player_pass_yds_alternate",
      player: "Passer1",
      line: 199.5,
      odds: -110,
      stats: { passingYards: "240" },
    },
  ];

  for (let i = 0; i < skillSpecs.length; i++) {
    const s = skillSpecs[i]!;
    const id = `skill-${i}`;
    const game = `SkillAway${i} @ SkillHome${i}`;
    skill.push({
      game,
      market: s.market,
      propMarketKey: s.market,
      pick: `${s.player} Over ${s.line}`,
      odds: s.odds,
      isProp: true,
      player: s.player,
      propLine: s.line,
      propSide: "Over",
      sport: "nfl",
      athleteId: id,
      propIsAlt: s.market.includes("alternate"),
    } as ParsedPick);
    histories[`${s.player}#${id}`] = {
      recent: Array.from({ length: 8 }, () => ({ stats: s.stats })),
    };
  }

  const tdHits = gradeFootballPropsOnlyFromHistory(tds, histories);
  const tdBest = collapsePropsOnlyToBestEvSides(tds, tdHits);
  const tdScored = tdBest
    .map((p) => {
      const hit = gradeFootballPropFromHistory(
        p,
        histories[`${p.player}#${p.athleteId}`],
      ).hitProbability;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      return { pick: p, simHit: hit, evPct: 1, rankScore: 1 } as BoardScoredLeg;
    })
    .filter((x): x is BoardScoredLeg => !!x);
  assert.equal(tdScored.length, 0, "preferred TDs must fail odds (phone wipe)");
  assert.equal(stageFootballPropsOnlyLegs(tdScored, 7).length, 0);
  assert.equal(
    shouldRecoverPropsOnlyWithFootballSkillBoard({
      graded: tds.length,
      staged: 0,
      preferredPoolSize: tds.length,
      skillPoolSize: skill.length,
    }),
    true,
  );

  const skillHits = gradeFootballPropsOnlyFromHistory(skill, histories);
  const skillBest = collapsePropsOnlyToBestEvSides(skill, skillHits);
  const skillScored = skillBest
    .map((p) => {
      const hit = gradeFootballPropFromHistory(
        p,
        histories[`${p.player}#${p.athleteId}`],
      ).hitProbability;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      return {
        pick: { ...p, propsOnlyTicket: true },
        simHit: hit,
        evPct: ((hit ?? 0) - 0.5) * 100,
        edgePct: 10,
        confidencePct: 60,
        impliedProbPct: 52,
        lineShoppingScore: null,
        grade: "B",
        composite: 7,
        rankScore: 7,
      } as BoardScoredLeg;
    })
    .filter((x): x is BoardScoredLeg => !!x);

  assert.ok(skillScored.length >= 7, `expected ≥7 clearing skill props, got ${skillScored.length}`);
  const staged = stageFootballPropsOnlyLegs(skillScored, 7);
  assert.equal(staged.length, 7, "skill recovery must fill 7-leg ticket");
  const families = staged.map((p) => String(p.propMarketKey ?? ""));
  assert.ok(
    families.some((m) => /rush_yds|pass_yds|reception|sacks/.test(m)),
    `recovery must use yards/receptions/sacks — got ${families.join(",")}`,
  );
  assert.match(
    footballSkillRecoveryNote({
      preferredGraded: tds.length,
      staged: staged.length,
      target: 7,
    }),
    /yards \/ receptions \/ sacks/i,
  );
});

test("phone yards wipe recovers receptions/sacks alts (not TD-only patch)", () => {
  // Prefer rush/pass yards that fail odds; recovery board has rec + sacks that clear.
  const preferred: ParsedPick[] = [
    {
      game: "A @ B",
      market: "Rush Yds",
      propMarketKey: "player_rush_yds",
      pick: "Henry Over 99.5",
      odds: -200,
      isProp: true,
      player: "Henry",
      propLine: 99.5,
      propSide: "Over",
      sport: "nfl",
      athleteId: "h1",
    } as ParsedPick,
  ];
  const recovery: ParsedPick[] = [
    {
      game: "C @ D",
      market: "Receptions",
      propMarketKey: "player_receptions",
      pick: "Kelce Over 4.5",
      odds: -110,
      isProp: true,
      player: "Kelce",
      propLine: 4.5,
      propSide: "Over",
      sport: "nfl",
      athleteId: "k1",
    } as ParsedPick,
    {
      game: "E @ F",
      market: "Sacks",
      propMarketKey: "player_sacks",
      pick: "Parsons Over 0.5",
      odds: 100,
      isProp: true,
      player: "Parsons",
      propLine: 0.5,
      propSide: "Over",
      sport: "nfl",
      athleteId: "p1",
      propIsAlt: true,
    } as ParsedPick,
  ];
  const histories = {
    "Henry#h1": {
      recent: Array.from({ length: 8 }, () => ({
        stats: { rushingYards: "60" },
      })),
    },
    "Kelce#k1": {
      recent: Array.from({ length: 8 }, () => ({
        stats: { receptions: "7" },
      })),
    },
    "Parsons#p1": {
      recent: Array.from({ length: 8 }, () => ({
        stats: { SACKS: "1" },
      })),
    },
  };

  const prefHits = gradeFootballPropsOnlyFromHistory(preferred, histories);
  const prefBest = collapsePropsOnlyToBestEvSides(preferred, prefHits);
  const prefScored = prefBest.filter((p) =>
    propsOnlyLegClearsOdds(
      p,
      gradeFootballPropFromHistory(p, histories[`${p.player}#${p.athleteId}`])
        .hitProbability,
    ),
  );
  assert.equal(prefScored.length, 0);

  const recHits = gradeFootballPropsOnlyFromHistory(recovery, histories);
  const recBest = collapsePropsOnlyToBestEvSides(recovery, recHits);
  const recScored = recBest
    .map((p) => {
      const hit = gradeFootballPropFromHistory(
        p,
        histories[`${p.player}#${p.athleteId}`],
      ).hitProbability;
      if (!propsOnlyLegClearsOdds(p, hit)) return null;
      return {
        pick: { ...p, propsOnlyTicket: true },
        simHit: hit,
        evPct: 20,
        rankScore: 8,
      } as BoardScoredLeg;
    })
    .filter((x): x is BoardScoredLeg => !!x);
  assert.equal(recScored.length, 2);
  const staged = stageFootballPropsOnlyLegs(recScored, 2);
  assert.equal(staged.length, 2);
  assert.ok(staged.some((p) => /receptions/i.test(String(p.propMarketKey))));
  assert.ok(staged.some((p) => /sacks/i.test(String(p.propMarketKey))));
});

test("recovery odds slack stages near-clearing TD that strict gate rejects", () => {
  // 4/8 = 50% hit vs -130 (~56.5% implied): strict 2.5pp fails; recovery 8pp clears.
  const td = {
    game: "A @ B",
    market: "Anytime TD",
    propMarketKey: "player_anytime_td",
    pick: "Star Anytime TD",
    odds: -130,
    isProp: true,
    player: "Star",
    propLine: 0.5,
    propSide: "Over",
    sport: "nfl",
    athleteId: "star-1",
  } as ParsedPick;
  const hist = {
    recent: Array.from({ length: 8 }, (_, g) => ({
      stats: {
        rushingTouchdowns: "0",
        receivingTouchdowns: g % 2 === 0 ? "1" : "0",
        passingTouchdowns: "0",
      },
    })),
  };
  const hit = gradeFootballPropFromHistory(td, hist).hitProbability;
  assert.ok(hit != null && hit >= 0.45 && hit <= 0.55, `expected ~50% hit, got ${hit}`);
  assert.equal(propsOnlyLegClearsOdds(td, hit), false, "strict gate must fail");
  assert.equal(
    propsOnlyLegClearsOdds(td, hit, PROPS_ONLY_RECOVERY_ODDS_SLACK),
    true,
    "recovery slack must clear near-miss TD",
  );
  const scored: BoardScoredLeg[] = [
    {
      pick: { ...td, propsOnlyTicket: true },
      simHit: hit,
      evPct: -5,
      rankScore: 5,
    } as BoardScoredLeg,
  ];
  assert.equal(stageFootballPropsOnlyLegs(scored, 1).length, 0);
  assert.equal(
    stageFootballPropsOnlyLegs(scored, 1, PROPS_ONLY_RECOVERY_ODDS_SLACK).length,
    1,
  );
});
