import assert from "node:assert/strict";
import test from "node:test";
import { nextOddsQuotaReset, OddsQuotaExhausted, oddsDiagnosticCaller, oddsProviderFetch } from "../src/lib/oddsProviderQuota.ts";

test("quota errors have a distinct reset date and suppress repeated calls for that key", async () => {
  assert.equal(nextOddsQuotaReset(new Date("2026-11-27T20:00:00Z")), "2026-12-01T00:00:00.000Z");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error_code: "OUT_OF_USAGE_CREDITS" }, { status: 401 });
  };
  try {
    const url = "https://api.the-odds-api.com/v4/sports/test/odds?apiKey=fake-quota-fixture";
    await assert.rejects(oddsProviderFetch(url, "coach_build"), OddsQuotaExhausted);
    await assert.rejects(oddsProviderFetch(url, "coach_build"), OddsQuotaExhausted);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("a bad key stays distinct and a daily budget blocks work before fetch", async () => {
  const original = globalThis.fetch;
  const previous = process.env.ODDS_DAILY_BUDGET_ADMIN_TEST;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error_code: "INVALID_KEY" }, { status: 401 });
  };
  const url = "https://api.the-odds-api.com/v4/sports/test/odds?apiKey=fake-budget-fixture&markets=h2h,totals&regions=us";
  try {
    process.env.ODDS_DAILY_BUDGET_ADMIN_TEST = "2";
    assert.equal((await oddsProviderFetch(url, "admin_test")).status, 401);
    assert.equal((await oddsProviderFetch(url, "admin_test")).status, 403);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.ODDS_DAILY_BUDGET_ADMIN_TEST;
    else process.env.ODDS_DAILY_BUDGET_ADMIN_TEST = previous;
  }
  assert.equal(oddsDiagnosticCaller(undefined, "admin_test"), null);
});
