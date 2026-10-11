import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  USAGE_MISSING_PRIOR_FRAC,
  USAGE_WEAK_DOMINANCE_CAP,
  buildOpportunityShiftForGame,
  deriveChannelUsageFromHistory,
  groundedUsageFromSeries,
  lookupOpportunityShift,
  normalizeUsageWeights,
  winsorizeSeries,
} from "../src/lib/opportunityShift/index.js";
import type { PlayerHistoryShape } from "../src/lib/monteCarloBuild.js";

function rushHist(carries: number[]): PlayerHistoryShape {
  return {
    labels: ["rushingAttempts"],
    recent: carries.map((c) => ({
      stats: { rushingAttempts: String(c) },
      isHome: true,
    })),
    vsOpponent: [],
  };
}

function rebHist(rebounds: number[], minutes: number[]): PlayerHistoryShape {
  return {
    labels: ["REB", "MIN"],
    recent: rebounds.map((r, i) => ({
      stats: { REB: String(r), MIN: String(minutes[i] ?? 24) },
      isHome: true,
    })),
    vsOpponent: [],
  };
}

function paHist(pas: number[]): PlayerHistoryShape {
  return {
    labels: ["PA", "AB"],
    recent: pas.map((p) => ({
      stats: { PA: String(p), AB: String(Math.max(0, p - 1)) },
      isHome: true,
    })),
    vsOpponent: [],
  };
}

describe("Opportunity Shift — usage weighting formula", () => {
  it("winsorize softens a single outlier game", () => {
    const raw = [12, 11, 13, 40, 12];
    const w = winsorizeSeries(raw);
    assert.ok(Math.max(...w) < 40);
    assert.ok(groundedUsageFromSeries(raw).usage! < mean(raw));
  });

  it("clear lead-back hierarchy → Swift gets majority of carries", () => {
    const swift = deriveChannelUsageFromHistory(rushHist([15, 20, 16, 18]));
    const roschon = deriveChannelUsageFromHistory(rushHist([4, 0, 0, 1]));
    const weights = normalizeUsageWeights([
      { id: "swift", usage: swift.channelUsage.carries ?? null, sampleSize: swift.channelUsageSamples.carries ?? 0 },
      { id: "roschon", usage: roschon.channelUsage.carries ?? null, sampleSize: roschon.channelUsageSamples.carries ?? 0 },
    ]);
    assert.ok((weights.get("swift") ?? 0) > 0.7);
    assert.ok((weights.get("roschon") ?? 0) < 0.3);
    const sum = [...weights.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it("near-even committee stays near 50/50", () => {
    const a = deriveChannelUsageFromHistory(rushHist([12, 11, 13, 12]));
    const b = deriveChannelUsageFromHistory(rushHist([11, 12, 12, 13]));
    const weights = normalizeUsageWeights([
      { id: "a", usage: a.channelUsage.carries ?? null, sampleSize: a.channelUsageSamples.carries ?? 0 },
      { id: "b", usage: b.channelUsage.carries ?? null, sampleSize: b.channelUsageSamples.carries ?? 0 },
    ]);
    assert.ok(Math.abs((weights.get("a") ?? 0) - 0.5) < 0.08);
    assert.ok(Math.abs((weights.get("b") ?? 0) - 0.5) < 0.08);
  });

  it("one beneficiary with no history → soft prior, not 100% to the leader", () => {
    const lead = deriveChannelUsageFromHistory(rushHist([18, 16, 17, 15]));
    const weights = normalizeUsageWeights([
      { id: "lead", usage: lead.channelUsage.carries ?? null, sampleSize: lead.channelUsageSamples.carries ?? 0 },
      { id: "none", usage: null, sampleSize: 0 },
    ]);
    const leadW = weights.get("lead") ?? 0;
    const noneW = weights.get("none") ?? 0;
    assert.ok(leadW > noneW);
    assert.ok(leadW <= USAGE_WEAK_DOMINANCE_CAP + 1e-9);
    assert.ok(noneW > 0);
    // Soft prior ≈ MISSING_PRIOR_FRAC of mean before renormalize/cap
    assert.ok(noneW < 0.4);
  });

  it("both beneficiaries with no history → equal fallback", () => {
    const weights = normalizeUsageWeights([
      { id: "a", usage: null, sampleSize: 0 },
      { id: "b", usage: null, sampleSize: 0 },
    ]);
    assert.equal(weights.get("a"), 0.5);
    assert.equal(weights.get("b"), 0.5);
  });

  it("Monangai OUT: Swift/Roschon allocation uses carry hierarchy (not 50/50)", () => {
    const vacated = 14;
    const leakage = 0.18;
    const swiftU = deriveChannelUsageFromHistory(rushHist([15, 20, 16, 18]));
    const roschonU = deriveChannelUsageFromHistory(rushHist([4, 0, 0, 1]));
    const weights = normalizeUsageWeights([
      { id: "swift", usage: swiftU.channelUsage.carries ?? null, sampleSize: swiftU.channelUsageSamples.carries ?? 0 },
      { id: "roschon", usage: roschonU.channelUsage.carries ?? null, sampleSize: roschonU.channelUsageSamples.carries ?? 0 },
    ]);
    const beforeEqual = { swift: vacated * 0.5 * (1 - leakage), roschon: vacated * 0.5 * (1 - leakage) };
    const after = {
      swift: vacated * (weights.get("swift") ?? 0) * (1 - leakage),
      roschon: vacated * (weights.get("roschon") ?? 0) * (1 - leakage),
    };
    assert.ok(after.swift > beforeEqual.swift);
    assert.ok(after.roschon < beforeEqual.roschon);
    assert.ok(Math.abs(after.swift + after.roschon - vacated * (1 - leakage)) < 1e-9);

    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "CHI @ GB",
      homeTeam: "Packers",
      awayTeam: "Bears",
      injuries: [
        {
          team: "Bears",
          entries: [
            { player: "Kyle Monangai", status: "Out", position: "RB" },
            { player: "D'Andre Swift", status: "Active", position: "RB" },
            { player: "Roschon Johnson", status: "Active", position: "RB" },
          ],
        },
      ],
      players: [
        {
          player: "D'Andre Swift",
          athleteId: "swift",
          team: "Bears",
          position: "RB",
          channelUsage: swiftU.channelUsage,
          channelUsageSamples: swiftU.channelUsageSamples,
        },
        {
          player: "Roschon Johnson",
          athleteId: "roschon",
          team: "Bears",
          position: "RB",
          channelUsage: roschonU.channelUsage,
          channelUsageSamples: roschonU.channelUsageSamples,
        },
      ],
    });
    const swiftM = lookupOpportunityShift(table, {
      player: "D'Andre Swift",
      athleteId: "swift",
      market: "rush_attempts",
      sport: "nfl",
    });
    const roschonM = lookupOpportunityShift(table, {
      player: "Roschon Johnson",
      athleteId: "roschon",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.ok(swiftM.multiplier > 1);
    assert.ok(roschonM.multiplier > 1);
    // Lead back should get at least as much family uplift as the committee back.
    assert.ok(swiftM.multiplier >= roschonM.multiplier - 0.001);
    // Unrelated family unchanged
    const pass = lookupOpportunityShift(table, {
      player: "D'Andre Swift",
      athleteId: "swift",
      market: "pass_yds",
      sport: "nfl",
    });
    assert.equal(pass.multiplier, 1);
  });

  it("multi-vacancy conservation still holds with weighted shares", () => {
    const table = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "g",
      homeTeam: "Home",
      awayTeam: "Away",
      injuries: [
        {
          team: "Home",
          entries: [
            { player: "RB1", status: "Out", position: "RB" },
            { player: "RB2", status: "Out", position: "RB" },
          ],
        },
      ],
      players: [
        {
          player: "RB3",
          athleteId: "rb3",
          team: "Home",
          position: "RB",
          channelUsage: { carries: 14 },
          channelUsageSamples: { carries: 5 },
        },
        {
          player: "RB4",
          athleteId: "rb4",
          team: "Home",
          position: "RB",
          channelUsage: { carries: 6 },
          channelUsageSamples: { carries: 5 },
        },
        {
          player: "RB1",
          team: "Home",
          position: "RB",
          channelUsage: { carries: 12 },
        },
        {
          player: "RB2",
          team: "Home",
          position: "RB",
          channelUsage: { carries: 10 },
        },
      ],
    });
    assert.ok(table.vacancies.length >= 2);
    const m3 = lookupOpportunityShift(table, {
      player: "RB3",
      athleteId: "rb3",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.ok(m3.multiplier > 1);
    assert.ok(m3.multiplier <= 1.28);
  });

  it("NBA shared engine: rebound opportunity weights by REB history", () => {
    const big = deriveChannelUsageFromHistory(rebHist([10, 9, 11, 8], [28, 30, 27, 29]));
    const wing = deriveChannelUsageFromHistory(rebHist([4, 5, 3, 4], [32, 34, 31, 33]));
    const weights = normalizeUsageWeights([
      { id: "big", usage: big.channelUsage.reb_opps ?? null, sampleSize: big.channelUsageSamples.reb_opps ?? 0 },
      { id: "wing", usage: wing.channelUsage.reb_opps ?? null, sampleSize: wing.channelUsageSamples.reb_opps ?? 0 },
    ]);
    assert.ok((weights.get("big") ?? 0) > (weights.get("wing") ?? 0));

    const table = buildOpportunityShiftForGame({
      sport: "nba",
      gameKey: "x",
      homeTeam: "Hawks",
      awayTeam: "X",
      injuries: [
        {
          team: "Hawks",
          entries: [{ player: "Star C", status: "Out", position: "C" }],
        },
      ],
      players: [
        {
          player: "Backup C",
          athleteId: "bc",
          team: "Hawks",
          position: "C",
          channelUsage: big.channelUsage,
          channelUsageSamples: big.channelUsageSamples,
        },
        {
          player: "Wing",
          athleteId: "w",
          team: "Hawks",
          position: "SF",
          channelUsage: wing.channelUsage,
          channelUsageSamples: wing.channelUsageSamples,
        },
        {
          player: "Star C",
          team: "Hawks",
          position: "C",
          channelUsage: { minutes: 30, reb_opps: 10 },
        },
      ],
    });
    const bigM = lookupOpportunityShift(table, {
      player: "Backup C",
      athleteId: "bc",
      market: "rebounds",
      sport: "nba",
    });
    assert.ok(bigM.multiplier > 1);
  });

  it("MLB shared engine: PA opportunity from recent PA", () => {
    const a = deriveChannelUsageFromHistory(paHist([4.4, 4.2, 4.5, 4.1, 4.3]));
    const b = deriveChannelUsageFromHistory(paHist([3.1, 2.8, 3.0, 3.2]));
    assert.ok((a.channelUsage.pa ?? 0) > (b.channelUsage.pa ?? 0));
    const table = buildOpportunityShiftForGame({
      sport: "mlb",
      gameKey: "x",
      homeTeam: "DBacks",
      awayTeam: "X",
      injuries: [
        {
          team: "DBacks",
          entries: [{ player: "IL Bat", status: "60-Day-IL", position: "1B" }],
        },
      ],
      players: [
        {
          player: "Regular",
          athleteId: "r",
          team: "DBacks",
          position: "2B",
          channelUsage: a.channelUsage,
          channelUsageSamples: a.channelUsageSamples,
        },
        {
          player: "PartTime",
          athleteId: "p",
          team: "DBacks",
          position: "OF",
          channelUsage: b.channelUsage,
          channelUsageSamples: b.channelUsageSamples,
        },
        {
          player: "IL Bat",
          team: "DBacks",
          position: "1B",
          channelUsage: { pa: 3.8 },
        },
      ],
    });
    const hits = lookupOpportunityShift(table, {
      player: "Regular",
      athleteId: "r",
      market: "hits",
      sport: "mlb",
    });
    assert.ok(hits.multiplier > 1);
  });

  it("identical fixture → same table fingerprint for shared HTTP/Coach inputs", () => {
    const players = [
      {
        player: "D'Andre Swift",
        athleteId: "4259545",
        team: "Bears",
        position: "RB" as string | null,
        channelUsage: deriveChannelUsageFromHistory(rushHist([15, 20, 16, 18])).channelUsage,
        channelUsageSamples: deriveChannelUsageFromHistory(rushHist([15, 20, 16, 18]))
          .channelUsageSamples,
      },
      {
        player: "Roschon Johnson",
        athleteId: "4426386",
        team: "Bears",
        position: "RB" as string | null,
        channelUsage: deriveChannelUsageFromHistory(rushHist([4, 0, 0, 1])).channelUsage,
        channelUsageSamples: deriveChannelUsageFromHistory(rushHist([4, 0, 0, 1]))
          .channelUsageSamples,
      },
    ];
    const injuries = [
      {
        team: "Bears",
        entries: [
          { player: "Kyle Monangai", status: "Out", position: "RB" },
          { player: "D'Andre Swift", status: "Active", position: "RB" },
          { player: "Roschon Johnson", status: "Active", position: "RB" },
        ],
      },
    ];
    const httpTable = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "CHI @ GB",
      homeTeam: "Packers",
      awayTeam: "Bears",
      injuries,
      players,
    });
    const coachTable = buildOpportunityShiftForGame({
      sport: "nfl",
      gameKey: "CHI @ GB",
      homeTeam: "Packers",
      awayTeam: "Bears",
      injuries,
      players,
    });
    assert.equal(httpTable.tableFingerprint, coachTable.tableFingerprint);
    const h = lookupOpportunityShift(httpTable, {
      player: "D'Andre Swift",
      athleteId: "4259545",
      market: "rush_attempts",
      sport: "nfl",
    });
    const c = lookupOpportunityShift(coachTable, {
      player: "D'Andre Swift",
      athleteId: "4259545",
      market: "rush_attempts",
      sport: "nfl",
    });
    assert.equal(h.multiplier, c.multiplier);
  });
});

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// silence unused import lint if any
void USAGE_MISSING_PRIOR_FRAC;
