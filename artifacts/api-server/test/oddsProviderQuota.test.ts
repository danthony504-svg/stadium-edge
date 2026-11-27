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

test("diagnostics have a shared low cap and production callers cannot use the test key", async () => {
  const original = globalThis.fetch;
  const previous = process.env.ODDS_TEST_API_KEY;
  process.env.ODDS_TEST_API_KEY = "fixture-isolated-test";
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  const marketList = Array.from({ length: 13 }, (_, i) => `test_${i}`).join(",");
  const url = `https://api.the-odds-api.com/v4/sports/test/odds?apiKey=fixture-isolated-test&markets=${marketList}&regions=us`;
  try {
    assert.equal((await oddsProviderFetch(url, "coach_build")).status, 503);
    assert.equal((await oddsProviderFetch(url, "live_probe")).status, 200);
    assert.equal((await oddsProviderFetch(url, "admin_test")).status, 403);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.ODDS_TEST_API_KEY;
    else process.env.ODDS_TEST_API_KEY = previous;
  }
});

test("70 and 90 percent warnings post once to the configured destination", async () => {
  const original = globalThis.fetch;
  const previous = process.env.ODDS_CREDIT_ALERT_WEBHOOK_URL;
  const oldLimit = process.env.ODDS_MONTHLY_CREDIT_LIMIT;
  process.env.ODDS_CREDIT_ALERT_WEBHOOK_URL = "https://alerts.example.test/test";
  process.env.ODDS_MONTHLY_CREDIT_LIMIT = "100";
  const messages: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://alerts.example.test/")) {
      messages.push(JSON.parse(String(init?.body)).text);
      return Response.json({});
    }
    return Response.json({}, { headers: { "x-requests-used": "92" } });
  };
  try {
    const url = "https://api.the-odds-api.com/v4/sports/test/odds?apiKey=fake-alert";
    await oddsProviderFetch(url, "scheduled_refresh");
    await oddsProviderFetch(url, "coach_build");
    assert.equal(messages.length, 2);
    assert.match(messages[0]!, /70%/);
    assert.match(messages[1]!, /90%/);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.ODDS_CREDIT_ALERT_WEBHOOK_URL;
    else process.env.ODDS_CREDIT_ALERT_WEBHOOK_URL = previous;
    if (oldLimit == null) delete process.env.ODDS_MONTHLY_CREDIT_LIMIT;
    else process.env.ODDS_MONTHLY_CREDIT_LIMIT = oldLimit;
  }
});
