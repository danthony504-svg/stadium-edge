import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParlayShortfallNote,
  buildQualifyingAltShortfallNote,
  buildFullBoardShortfallNote,
  mergeParlayRejects,
  promoteQualifyingAltsToTicket,
  promoteQualifyingStagedToTicket,
  reachParlayMix,
  selectParlayBackupPicks,
  selectParlayMainBackupPicks,
} from "./parlayReachCore.ts";

test("reachParlayMix allows more game legs for 15-leg tickets", () => {
  const mix = reachParlayMix(15);
  assert.ok(mix.maxGameLegs >= 5);
  assert.ok(mix.minProps <= 6);
});

test("selectParlayBackupPicks skips main moneylines", () => {
  const ticket = [
    {
      game: "A @ B",
      market: "Spread",
      pick: "B +1.5",
      odds: -110,
      isProp: false,
    },
  ];
  const rejects = [
    {
      pick: { game: "C @ D", market: "Moneyline", pick: "D ML", odds: 680, isProp: false },
      reason: "+1.7% edge",
      nearScore: 40,
    },
    {
      pick: { game: "E @ F", market: "Alt Spread", pick: "F +3.5", odds: -105, isProp: false },
      reason: "edge +2%",
      nearScore: 35,
    },
  ];
  const backups = selectParlayBackupPicks(ticket, rejects, 2);
  assert.equal(backups.length, 1);
  assert.equal(backups[0]!.market, "Alt Spread");
  assert.equal(backups[0]!.ticketRole, "alt");
});

test("buildQualifyingAltShortfallNote mentions positive-edge alts", () => {
  const note = buildQualifyingAltShortfallNote(15, 11, 3, "today's real odds");
  assert.match(note, /11/);
  assert.match(note, /alternate line/);
  assert.match(note, /ALT PICK/);
});

test("buildQualifyingAltShortfallNote mentions excluded leagues", () => {
  const note = buildQualifyingAltShortfallNote(12, 8, 2, "today's real odds", ["mlb"]);
  assert.match(note, /exclude.*MLB/i);
});

test("promoteQualifyingAltsToTicket fills the main ticket up to the target", () => {
  const ticket = [
    { game: "A @ B", market: "Points", pick: "Player A Over 10.5 Points", odds: -110, isProp: true },
  ];
  const qualifying = [
    {
      pick: { game: "C @ D", market: "Alt Spread", pick: "D +3.5", odds: -105, isProp: false },
      reason: "+2% edge",
      nearScore: 40,
    },
    {
      pick: { game: "E @ F", market: "Alt Total", pick: "Over 8.5", odds: 110, isProp: false },
      reason: "+1.5% edge",
      nearScore: 35,
    },
  ];
  const { picks, promoted } = promoteQualifyingAltsToTicket(ticket as any, qualifying as any, 3);
  assert.equal(promoted.length, 2);
  assert.equal(picks.length, 3);
});

test("promoteQualifyingStagedToTicket fills mains before qualifying alts on reach-N shortfall", () => {
  const ticket = [
    { game: "A @ B", market: "Points", pick: "Player A Over 10.5 Points", odds: -110, isProp: true },
  ];
  const mains = [
    {
      pick: { game: "C @ D", market: "Spread", pick: "D +1.5", odds: -110, isProp: false },
      reason: "+2% edge",
      nearScore: 50,
    },
  ];
  const alts = [
    {
      pick: { game: "E @ F", market: "Alt Spread", pick: "F +3.5", odds: -105, isProp: false },
      reason: "+2% edge",
      nearScore: 40,
    },
  ];
  const { picks, promotedMains, promotedAlts } = promoteQualifyingStagedToTicket(
    ticket as any,
    mains as any,
    alts as any,
    3,
  );
  assert.equal(promotedAlts.length, 1);
  assert.equal(promotedMains.length, 1);
  assert.equal(picks.length, 3);
  assert.equal(picks[1]!.ticketRole, "main");
  assert.equal(picks[2]!.ticketRole, "alt");
});

test("selectParlayMainBackupPicks skips alt rungs", () => {
  const ticket: any[] = [];
  const rejects = [
    {
      pick: { game: "A @ B", market: "Alt Spread", pick: "B +3.5", odds: -105, isProp: false },
      reason: "alt",
      nearScore: 40,
    },
    {
      pick: { game: "C @ D", market: "Spread", pick: "D +1.5", odds: -110, isProp: false },
      reason: "main",
      nearScore: 50,
    },
  ];
  const mains = selectParlayMainBackupPicks(ticket, rejects as any, 2);
  assert.equal(mains.length, 1);
  assert.equal(mains[0]!.market, "Spread");
});

test("buildFullBoardShortfallNote explains entire-board scan when short", () => {
  const note = buildFullBoardShortfallNote(15, 11, 840, 11, "today's real odds");
  assert.match(note, /840/);
  assert.match(note, /second half/i);
  assert.match(note, /combo props/i);
  assert.match(note, /correlation scoring/i);
  assert.match(note, /Every qualifying market/i);
  assert.match(note, /no ungraded filler/i);
});

test("buildFullBoardShortfallNote confirms top 15 when board has more qualifiers", () => {
  const note = buildFullBoardShortfallNote(15, 15, 920, 48, "today's real odds");
  assert.match(note, /48/);
  assert.match(note, /highest-rated/i);
});

test("mergeParlayRejects dedupes by leg fingerprint", () => {
  const pick = { game: "A @ B", market: "ML", pick: "B ML", odds: -120, isProp: false };
  const a = { pick, reason: "r1", nearScore: 10 };
  const b = { pick, reason: "r1", nearScore: 20 };
  const merged = mergeParlayRejects([a], [b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.nearScore, 20);
});
