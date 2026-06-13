import { test } from "node:test";
import assert from "node:assert/strict";
import { slipPropPlayerName } from "./slipPlayer.ts";

test("extracts the player name from an Over/Under prop pick", () => {
  assert.equal(slipPropPlayerName("Stephon Castle Over 3.5 Rebounds"), "Stephon Castle");
  assert.equal(slipPropPlayerName("Luke Kornet Under 0.5 Points"), "Luke Kornet");
});

test("extracts the player name from a Yes/No (goalscorer) prop pick", () => {
  assert.equal(slipPropPlayerName("Erling Haaland Yes Anytime Goalscorer"), "Erling Haaland");
  assert.equal(slipPropPlayerName("Aaron Judge No To Hit A Home Run"), "Aaron Judge");
});

test("is case-insensitive on the side token", () => {
  assert.equal(slipPropPlayerName("OG Anunoby over 0.5 Assists"), "OG Anunoby");
});

test("returns null for moneyline / spread legs (no player before a side token)", () => {
  assert.equal(slipPropPlayerName("Lakers ML"), null);
  assert.equal(slipPropPlayerName("Celtics -3.5"), null);
  assert.equal(slipPropPlayerName("Boston Celtics Moneyline"), null);
});

test("returns null for a bare game total (nothing before the side token)", () => {
  assert.equal(slipPropPlayerName("Over 220.5"), null);
  assert.equal(slipPropPlayerName("Under 7.5"), null);
});

test("a team total yields the team string — the downstream guard rejects it, never this parser", () => {
  // We do NOT try to distinguish teams here; the active-player / whole-word guard
  // in buildChatContext refuses to bind a team name to an athlete. This test just
  // documents that the prefix is returned as-is (the safety net is elsewhere).
  assert.equal(slipPropPlayerName("Lakers Over 110.5"), "Lakers");
});

test("does not match a substring inside another word (no/yes/over/under embedded)", () => {
  // "Novak" contains "no" but only as a leading substring, not a whitespace-led
  // word — the \s anchor prevents a false match.
  assert.equal(slipPropPlayerName("Novak Djokovic"), null);
});

test("trims surrounding whitespace from the extracted name", () => {
  assert.equal(slipPropPlayerName("  Jayson Tatum   Over 27.5 Points"), "Jayson Tatum");
});
