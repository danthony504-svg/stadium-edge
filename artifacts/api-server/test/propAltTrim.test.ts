import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregatePropRowsWithAltTrim,
  isMilestonePropLine,
  trimAlternatePropRungs,
} from "../src/lib/propAltTrim.js";

type Row = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  alt: boolean;
};

function row(
  player: string,
  market: string,
  line: number,
  alt: boolean,
  over = -110,
): Row {
  return { player, market, line, overPrice: over, underPrice: -110, alt };
}

function rushAltLadder(player: string, mainLine: number): Row[] {
  const mains = row(player, "player_rush_yds", mainLine, false);
  const alts: Row[] = [];
  for (let line = 10.5; line <= 199.5; line += 5) {
    if (Math.abs(line - mainLine) < 0.1) continue;
    alts.push(row(player, "player_rush_yds", line, true, line >= 100 ? 200 + line : -110));
  }
  for (const milestone of [124.5, 149.5, 174.5, 199.5]) {
    if (Math.abs(milestone - mainLine) < 0.1) continue;
    alts.push(row(player, "player_rush_yds", milestone, true, 250 + milestone));
  }
  return [mains, ...alts];
}

test("isMilestonePropLine recognizes common yard milestones", () => {
  assert.ok(isMilestonePropLine(149.5, "player_rush_yds"));
  assert.ok(isMilestonePropLine(174.5, "player_pass_yds"));
  assert.ok(isMilestonePropLine(74.5, "player_reception_yds"));
  assert.equal(isMilestonePropLine(72.5, "player_rush_yds"), false);
});

test("default trim keeps only nearest alts to main", () => {
  const rows = rushAltLadder("Barkley", 67.5);
  const trimmed = trimAlternatePropRungs(rows);
  const lines = trimmed.map((r) => r.line).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.equal(lines.includes(149.5), false);
  assert.equal(lines.includes(174.5), false);
  assert.ok(lines.length <= 12);
});

test("fullBoard trim keeps milestone yard alts far from main", () => {
  const rows = rushAltLadder("Barkley", 67.5);
  const trimmed = trimAlternatePropRungs(rows, { fullBoard: true });
  const lines = trimmed.map((r) => r.line).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.ok(lines.includes(149.5));
  assert.ok(lines.includes(174.5));
});

test("aggregatePropRowsWithAltTrim keeps mains before alts", () => {
  const rows: Row[] = [
    row("Allen", "player_pass_yds", 265.5, false),
    row("Allen", "player_pass_yds", 299.5, true, 180),
  ];
  const out = aggregatePropRowsWithAltTrim(rows, { fullBoard: true });
  assert.equal(out[0]!.alt, false);
  assert.equal(out[out.length - 1]!.alt, true);
});

test("fullBoard trim keeps higher pass TD and sack count alts", () => {
  const rows: Row[] = [
    row("Allen", "player_pass_tds", 1.5, false),
    row("Allen", "player_pass_tds", 0.5, true),
    row("Allen", "player_pass_tds", 2.5, true, 180),
    row("Allen", "player_pass_tds", 3.5, true, 350),
    row("Garrett", "player_sacks", 0.5, false),
    row("Garrett", "player_sacks", 1.5, true, 140),
    row("Garrett", "player_sacks", 2.5, true, 320),
  ];
  const trimmed = trimAlternatePropRungs(rows, { fullBoard: true });
  const allen = trimmed.filter((r) => r.player === "Allen").map((r) => r.line);
  const garrett = trimmed.filter((r) => r.player === "Garrett").map((r) => r.line);
  assert.ok(allen.includes(2.5));
  assert.ok(allen.includes(3.5));
  assert.ok(garrett.includes(1.5));
  assert.ok(garrett.includes(2.5));
});

test("default trim drops far pass TD alts", () => {
  const rows: Row[] = [row("Allen", "player_pass_tds", 1.5, false)];
  for (let line = 0.5; line <= 20.5; line += 1) {
    if (Math.abs(line - 1.5) < 0.1) continue;
    rows.push(row("Allen", "player_pass_tds", line, true));
  }
  const trimmed = trimAlternatePropRungs(rows);
  assert.equal(trimmed.some((r) => r.line === 20.5), false);
});
