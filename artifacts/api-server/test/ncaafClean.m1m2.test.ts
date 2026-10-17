/**
 * M1/M2 clean engine tests — identity, causal inputs, uncertainty, settlement.
 * Does not touch FINAL_EVAL, NFL product path, or NCAAF gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { FOOTBALL_DRIVE_ENGINE_VERSION } from "../src/lib/sportSim/footballDriveMatchup.ts";
import {
  CLEAN_HFA_POINTS,
  CleanOppAdjStrength,
  NCAAF_CLEAN_ENGINE_STAMP,
  buildPregameFromFixtureRow,
  cleanUncertainty,
  loadVenueSidecar,
  ncaafCleanEngineResearchEnabled,
  pHomeCoverFromMargin,
  pHomeMlFromMargin,
  predictScoreMargin,
  recoverVenue,
  settleAtsHome,
  settleMoneyline,
  settleTotal,
  type CleanFixtureGameRow,
} from "../src/lib/sportSim/ncaafClean/index.ts";

const FIX = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function loadTuningGames(): CleanFixtureGameRow[] {
  const raw = JSON.parse(
    readFileSync(join(FIX, "ncaaf-tuning-2025-w1-7-games.json"), "utf8"),
  );
  return raw.games as CleanFixtureGameRow[];
}

function loadPhaseEGames(): CleanFixtureGameRow[] {
  const raw = JSON.parse(
    readFileSync(join(FIX, "ncaaf-phase-e-games.json"), "utf8"),
  );
  return (Array.isArray(raw) ? raw : raw.games) as CleanFixtureGameRow[];
}

test("M1 stamp frozen and distinct from live NFL/drive stamp", () => {
  assert.equal(NCAAF_CLEAN_ENGINE_STAMP, "ncaaf-score-margin-v1-research");
  assert.notEqual(NCAAF_CLEAN_ENGINE_STAMP, FOOTBALL_DRIVE_ENGINE_VERSION);
  assert.equal(FOOTBALL_DRIVE_ENGINE_VERSION, "ppg-per-drive-v1");
});

test("M1 research flag defaults off", () => {
  const prev = process.env.NCAAF_CLEAN_ENGINE_RESEARCH;
  delete process.env.NCAAF_CLEAN_ENGINE_RESEARCH;
  assert.equal(ncaafCleanEngineResearchEnabled(), false);
  assert.equal(ncaafCleanEngineResearchEnabled(true), true);
  process.env.NCAAF_CLEAN_ENGINE_RESEARCH = "1";
  assert.equal(ncaafCleanEngineResearchEnabled(), true);
  if (prev === undefined) delete process.env.NCAAF_CLEAN_ENGINE_RESEARCH;
  else process.env.NCAAF_CLEAN_ENGINE_RESEARCH = prev;
});

test("identity: season-specific FBS vs FCS (Delaware 2024 FCS / 2025 FBS)", () => {
  const p24 = buildPregameFromFixtureRow({
    eventId: "t-del-2024",
    season: 2024,
    week: 1,
    kickoffIso: "2024-08-31T17:00Z",
    homeTeamId: "48",
    awayTeamId: "2306",
    homeName: "Delaware",
    awayName: "Kansas State",
  });
  const p25 = buildPregameFromFixtureRow({
    eventId: "t-del-2025",
    season: 2025,
    week: 1,
    kickoffIso: "2025-08-30T17:00Z",
    homeTeamId: "48",
    awayTeamId: "2306",
    homeName: "Delaware",
    awayName: "Kansas State",
  });
  assert.equal(p24.home.subdivision, "fcs");
  assert.equal(p25.home.subdivision, "fbs");
  assert.equal(p25.home.transition, "fcs_to_fbs");
  assert.equal(p24.matchupScope, "fbs_fcs");
  assert.equal(p25.matchupScope, "fbs_fbs");

  const ksu = buildPregameFromFixtureRow({
    eventId: "ksu",
    season: 2025,
    week: 1,
    kickoffIso: "2025-08-23T16:00Z",
    homeTeamId: "2306",
    awayTeamId: "66",
    homeName: "Kansas State",
    awayName: "Iowa State",
  });
  assert.equal(ksu.home.subdivision, "fbs");
  assert.equal(ksu.away.subdivision, "fbs");
  assert.equal(ksu.matchupScope, "fbs_fbs");
});

test("venue recovery: unresolved stays unknown — never silent neutral", () => {
  const bare = recoverVenue({
    eventId: "1",
    season: 2025,
    kickoffIso: "2025-09-01T00:00Z",
    homeTeamId: "1",
    awayTeamId: "2",
  });
  assert.equal(bare.kind, "unknown");
  assert.equal(bare.source, "unresolved");

  const neutral = recoverVenue({
    eventId: "2",
    season: 2025,
    kickoffIso: "2025-09-01T00:00Z",
    homeTeamId: "1",
    awayTeamId: "2",
    neutralSite: true,
  });
  assert.equal(neutral.kind, "neutral");
  assert.equal(neutral.source, "recovered");

  const home = recoverVenue({
    eventId: "3",
    season: 2025,
    kickoffIso: "2025-09-01T00:00Z",
    homeTeamId: "1",
    awayTeamId: "2",
    venueKind: "home",
  });
  assert.equal(home.kind, "home");

  const homeFromFlag = recoverVenue({
    eventId: "4",
    season: 2025,
    kickoffIso: "2025-09-01T00:00Z",
    homeTeamId: "1",
    awayTeamId: "2",
    neutralSite: false,
    venueId: "3833",
  });
  assert.equal(homeFromFlag.kind, "home");
  assert.equal(homeFromFlag.source, "recovered");

  // Bowl alone must NOT infer neutral without explicit neutralSite
  const bowlOnly = recoverVenue({
    eventId: "5",
    season: 2025,
    kickoffIso: "2025-09-01T00:00Z",
    homeTeamId: "1",
    awayTeamId: "2",
    bowl: true,
  });
  assert.equal(bowlOnly.kind, "unknown");
});

test("venue sidecar joins TUNING games with explicit ESPN flags", () => {
  const sc = loadVenueSidecar();
  assert.equal(sc.counts.unresolved, 0);
  assert.ok(sc.counts.recovered >= 469);
  const ireland = sc.games.find((g) => g.eventId === "401756846");
  assert.equal(ireland?.kind, "neutral");
  assert.equal(ireland?.international, true);
  const pre = buildPregameFromFixtureRow(
    {
      eventId: "401756846",
      season: 2025,
      week: 1,
      kickoffIso: "2025-08-23T16:00Z",
      homeTeamId: "2306",
      awayTeamId: "66",
    },
    { useVenueSidecar: true },
  );
  assert.equal(pre.venue.kind, "neutral");
  assert.equal(pre.venue.source, "recovered");
});

test("causal: real FBS ids — update after predict changes next μ", () => {
  const games = loadTuningGames().filter((g) => g.week === 1 || g.week === 2);
  const phaseE = loadPhaseEGames().filter((g) => g.season === 2024);
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.seedFromPriorSeason(
    phaseE.map((g) => ({
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeFg: g.homeFg!,
      awayFg: g.awayFg!,
      season: g.season,
      kickoffIso: g.kickoffIso,
    })),
  );

  const fbsFbs = games
    .map((g) => ({ g, pre: buildPregameFromFixtureRow(g) }))
    .filter(({ pre }) => pre.matchupScope === "fbs_fbs")
    .filter(
      ({ pre }) =>
        strength.hasRating(pre.home.teamId) &&
        strength.hasRating(pre.away.teamId),
    );

  assert.ok(fbsFbs.length >= 2, "need ≥2 rated FBS–FBS games in early TUNING");

  const a = fbsFbs[0]!;
  const preA = {
    ...a.pre,
    venue: { ...a.pre.venue, kind: "home" as const, source: "explicit_field" as const },
  };
  const pred1 = predictScoreMargin({ pregame: preA, strength });
  assert.equal(pred1.ok, true);
  if (!pred1.ok) return;
  const mu1 = pred1.marginMean;

  strength.update({
    homeTeamId: a.g.homeTeamId,
    awayTeamId: a.g.awayTeamId,
    homeFg: a.g.homeFg!,
    awayFg: a.g.awayFg!,
    season: 2025,
    kickoffIso: a.g.kickoffIso,
  });

  // Same matchup identities again would differ — use second game involving one side
  const b = fbsFbs.find(
    (x) =>
      x.g.eventId !== a.g.eventId &&
      (x.g.homeTeamId === a.g.homeTeamId ||
        x.g.awayTeamId === a.g.homeTeamId ||
        x.g.homeTeamId === a.g.awayTeamId ||
        x.g.awayTeamId === a.g.awayTeamId),
  );
  assert.ok(b, "need a follow-on game sharing a team");
  const preB = {
    ...b!.pre,
    venue: { ...b!.pre.venue, kind: "home" as const, source: "explicit_field" as const },
  };
  const before = strength.expectedPoints(
    preB.home.teamId,
    preB.away.teamId,
    CLEAN_HFA_POINTS,
  );
  // Re-predict first matchup ratings changed for those teams
  const pred1b = predictScoreMargin({ pregame: preA, strength });
  assert.equal(pred1b.ok, true);
  if (!pred1b.ok) return;
  // After a decisive update, μ for same pair should generally move (not identical write)
  assert.notEqual(pred1b.marginMean, mu1);
  void before;
});

test("uncertainty: thin n inflates; more games reduces", () => {
  const early = cleanUncertainty({ week: 1, nHomeFbsGames: 0, nAwayFbsGames: 0 });
  const later = cleanUncertainty({ week: 7, nHomeFbsGames: 6, nAwayFbsGames: 6 });
  assert.ok(early > later);
  assert.ok(early > 1);
});

test("unrated side → ok:false unrated_fbs_side (no invented μ)", () => {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.off.set("2306", 30);
  strength.def.set("2306", 20);
  // away 66 unrated
  const pre = buildPregameFromFixtureRow({
    eventId: "u1",
    season: 2025,
    week: 1,
    kickoffIso: "2025-08-23T16:00Z",
    homeTeamId: "2306",
    awayTeamId: "66",
    homeName: "Kansas State",
    awayName: "Iowa State",
    venueKind: "home",
  });
  const pred = predictScoreMargin({ pregame: pre, strength });
  assert.equal(pred.ok, false);
  if (pred.ok) return;
  assert.equal(pred.reason, "unrated_fbs_side");
});

test("venue unknown: research may predict but evaluableSupported=false; HFA not applied", () => {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.off.set("2306", 28);
  strength.def.set("2306", 20);
  strength.off.set("66", 24);
  strength.def.set("66", 22);
  const pre = buildPregameFromFixtureRow({
    eventId: "401756846",
    season: 2025,
    week: 1,
    kickoffIso: "2025-08-23T16:00Z",
    homeTeamId: "2306",
    awayTeamId: "66",
    homeName: "Kansas State",
    awayName: "Iowa State",
  });
  assert.equal(pre.venue.kind, "unknown");
  const pred = predictScoreMargin({ pregame: pre, strength });
  assert.equal(pred.ok, true);
  if (!pred.ok) return;
  assert.equal(pred.evaluableSupported, false);
  assert.equal(pred.productionReleaseApproved, false);
  assert.equal(pred.hfaApplied, false);
  assert.ok(pred.missingOptional.includes("venue_unknown_material"));
  assert.ok(pred.missingOptional.includes("injury_unavailable"));

  const withHome = {
    ...pre,
    venue: { kind: "home" as const, source: "explicit_field" as const },
  };
  const predHome = predictScoreMargin({ pregame: withHome, strength });
  assert.equal(predHome.ok, true);
  if (!predHome.ok) return;
  assert.equal(predHome.hfaApplied, true);
  assert.equal(predHome.evaluableSupported, true);
  assert.equal(predHome.productionReleaseApproved, false);
  assert.ok(predHome.marginMean > pred.marginMean);
});

test("injury unavailable: no invented adjustment; does not satisfy validation", () => {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  strength.off.set("2306", 28);
  strength.def.set("2306", 20);
  strength.off.set("66", 24);
  strength.def.set("66", 22);
  const pre = {
    ...buildPregameFromFixtureRow({
      eventId: "inj",
      season: 2025,
      week: 2,
      kickoffIso: "2025-09-06T16:00Z",
      homeTeamId: "2306",
      awayTeamId: "66",
      venueKind: "home",
    }),
  };
  const without = predictScoreMargin({ pregame: pre, strength });
  const withLate = predictScoreMargin({
    pregame: pre,
    strength,
    availability: {
      eventId: "inj",
      captureTimestamp: "2025-09-07T00:00Z", // after kickoff — invalid
      home: { qbStatus: "out", keyOffenseOut: true, keyDefenseOut: null },
      away: { qbStatus: "active", keyOffenseOut: false, keyDefenseOut: false },
    },
  });
  assert.equal(without.ok, true);
  assert.equal(withLate.ok, true);
  if (!without.ok || !withLate.ok) return;
  assert.ok(without.missingOptional.includes("injury_unavailable"));
  assert.ok(withLate.missingOptional.includes("injury_unavailable"));
  // No invented injury tilt — means identical
  assert.equal(without.marginMean, withLate.marginMean);
  assert.equal(without.homeScoreMean, withLate.homeScoreMean);
});

test("settlement: ML excludes ties (no half-wins); OT-style decisive finals ok", () => {
  assert.deepEqual(settleMoneyline({ homeScore: 27, awayScore: 24 }), {
    ok: true,
    yHomeWin: 1,
  });
  assert.deepEqual(settleMoneyline({ homeScore: 20, awayScore: 20 }), {
    ok: false,
    reason: "tied_final",
  });
  assert.deepEqual(settleMoneyline({ homeScore: 31, awayScore: 28, decided: true }), {
    ok: true,
    yHomeWin: 1,
  });
  assert.equal(settleMoneyline({ homeScore: 0, awayScore: 0, decided: false }).ok, false);
});

test("settlement: ATS Phase-E cover / push", () => {
  assert.deepEqual(
    settleAtsHome({ homeScore: 24, awayScore: 20, homeSpreadLine: -3.5 }),
    { ok: true, yHomeCover: 1 },
  );
  assert.deepEqual(
    settleAtsHome({ homeScore: 24, awayScore: 21, homeSpreadLine: -3 }),
    { ok: false, reason: "push" },
  );
  assert.deepEqual(
    settleAtsHome({ homeScore: 17, awayScore: 21, homeSpreadLine: 7.5 }),
    { ok: true, yHomeCover: 1 },
  );
});

test("settlement: totals push excluded", () => {
  assert.deepEqual(
    settleTotal({ homeScore: 24, awayScore: 21, totalLine: 44.5 }),
    { ok: true, yOver: 1 },
  );
  assert.deepEqual(
    settleTotal({ homeScore: 17, awayScore: 14, totalLine: 45 }),
    { ok: true, yOver: 0 },
  );
  assert.deepEqual(
    settleTotal({ homeScore: 20, awayScore: 20, totalLine: 40 }),
    { ok: false, reason: "push" },
  );
});

test("market derivation helpers are finite probabilities", () => {
  const p = pHomeMlFromMargin(3.5, 16.5);
  const c = pHomeCoverFromMargin(3.5, 16.5, -3.5);
  assert.ok(p > 0.5 && p < 1);
  assert.ok(c > 0.05 && c < 0.95);
});

test("FBS–FCS matchup withheld (unsupported scope)", () => {
  const strength = new CleanOppAdjStrength({ season: 2025 });
  // UNLV 2439 FBS vs Idaho State 304 FCS (from TUNING week 1)
  const pre = buildPregameFromFixtureRow({
    eventId: "401760371",
    season: 2025,
    week: 1,
    kickoffIso: "2025-08-23T20:00Z",
    homeTeamId: "2439",
    awayTeamId: "304",
    homeName: "UNLV",
    awayName: "Idaho State",
    venueKind: "home",
  });
  assert.equal(pre.matchupScope, "fbs_fcs");
  strength.off.set("2439", 30);
  strength.def.set("2439", 20);
  strength.off.set("304", 20);
  strength.def.set("304", 28);
  const pred = predictScoreMargin({ pregame: pre, strength });
  assert.equal(pred.ok, false);
  if (pred.ok) return;
  assert.equal(pred.reason, "fbs_fcs_unsupported_scope");
});
