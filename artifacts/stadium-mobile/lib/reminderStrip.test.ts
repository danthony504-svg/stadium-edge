import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTrailingReminder, REMINDER_RE } from "./reminderStrip.ts";

test("strips the observed real sign-off variants", () => {
  const variants = [
    "Bet responsibly — no wager is ever guaranteed.",
    "Bet only what you're comfortable losing.",
    "Bet responsibly. 21+",
    "Gamble responsibly.",
    "Remember to bet responsibly — no bet is guaranteed.",
    "Only bet what you can afford to lose.",
    "If you have a gambling problem, call 1-800-GAMBLER.",
  ];
  for (const v of variants) {
    const body = `New York has the better road form here.\n\n${v}`;
    assert.equal(stripTrailingReminder(body), "New York has the better road form here.", v);
  }
});

test("strips a trailing reminder plus trailing blank lines", () => {
  const body = "I like the underdog here.\n\nBet responsibly.\n\n  \n";
  assert.equal(stripTrailingReminder(body), "I like the underdog here.");
});

test("keeps legitimate trailing analysis that merely contains a fragment", () => {
  // "21+" as a stat threshold, not a disclaimer.
  const a = "He has gone for 21+ points in 7 of his last 10 games.";
  assert.equal(stripTrailingReminder(a), a);
  // "no guarantee" in analytic prose (not "no wager is guaranteed").
  const b = "There's no guarantee he plays, so confirm his status first.";
  assert.equal(stripTrailingReminder(b), b);
  // "lose" / "losing" in analysis, not the disclaimer phrase.
  const c = "Cleveland is 5-5 at home and has been losing the turnover battle.";
  assert.equal(stripTrailingReminder(c), c);
});

test("does not strip a long line that contains a disclaimer-ish fragment", () => {
  const long =
    "Even though you should always bet responsibly, the sharper read tonight is " +
    "that the Yankees' road margin and season record both quietly point to value " +
    "on the plus-money side rather than a blind fade of Cleveland at home.";
  assert.equal(stripTrailingReminder(long), long);
});

test("returns empty when the whole reply is just a reminder", () => {
  assert.equal(stripTrailingReminder("Bet responsibly — no wager is ever guaranteed."), "");
});

test("leaves a reply with no reminder untouched", () => {
  const body = "Why it's an upset spot\n\nThe Yankees have the better recent margin.";
  assert.equal(stripTrailingReminder(body), body);
});

test("REMINDER_RE does not match common analytic phrasings", () => {
  assert.ok(!REMINDER_RE.test("averaging 21+ points per game"));
  assert.ok(!REMINDER_RE.test("there is no guarantee he suits up"));
  assert.ok(!REMINDER_RE.test("they keep losing close games"));
});
