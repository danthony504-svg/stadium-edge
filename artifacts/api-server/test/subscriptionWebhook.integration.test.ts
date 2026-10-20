/** Actual webhook + isolated PostgreSQL; never connects to a production database. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
const configured = process.env.TEST_DATABASE_URL;
const schema = `subscription_test_${process.pid}`;
let pool: typeof import("@workspace/db").pool;
let server: Server;
let origin = "";
if (configured) {
  const url = new URL(configured);
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname));
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  process.env.REVENUECAT_WEBHOOK_SECRET = "isolated-fixture-secret";
}
before(async () => {
  if (!configured) return;
  ({ pool } = await import("@workspace/db"));
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE subscription_events (
    id serial primary key, event_key text not null unique, user_id text,
    event_type text not null, payload text, created_at timestamptz not null default now());
    CREATE TABLE subscription_entitlements (
    user_id text primary key, plan_id text not null, product_id text, status text not null,
    expires_at timestamptz, management_url text, original_app_user_id text, source text not null,
    store_kit_active boolean not null, updated_at timestamptz not null, created_at timestamptz not null);`);
  const { default: router } = await import("../src/routes/subscriptions.js");
  const app = express().use(express.json()).use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});
async function send(
  id: string,
  user = "user-fixture",
  type = "INITIAL_PURCHASE",
  product = "com.stadiumedge.app.pro.monthly",
) {
  return fetch(`${origin}/subscriptions/webhooks/revenuecat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer isolated-fixture-secret",
    },
    body: JSON.stringify({
      event: {
        id,
        type,
        app_user_id: user,
        product_id: product,
        expiration_at_ms: Date.now() + 86400000,
      },
    }),
  });
}
test(
  "failed entitlement rolls back claim; retry succeeds once; unknown events preserve access",
  { skip: !configured },
  async () => {
    await pool.query(
      "ALTER TABLE subscription_entitlements ADD CONSTRAINT fail_fixture CHECK(user_id <> 'retry-user')",
    );
    assert.equal((await send("retry-event", "retry-user")).status, 500);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM subscription_events WHERE event_key='rc:retry-event'",
        )
      ).rows[0].n,
      0,
    );
    await pool.query(
      "ALTER TABLE subscription_entitlements DROP CONSTRAINT fail_fixture",
    );
    assert.equal((await send("retry-event", "retry-user")).status, 200);
    assert.deepEqual(await (await send("retry-event", "retry-user")).json(), {
      ok: true,
      duplicate: true,
    });
    assert.deepEqual(
      (
        await pool.query(
          "SELECT plan_id,store_kit_active FROM subscription_entitlements WHERE user_id='retry-user'",
        )
      ).rows[0],
      { plan_id: "pro", store_kit_active: true },
    );
    const unknown = await send("unknown", "retry-user", "FUTURE_EVENT");
    assert.equal((await unknown.json()).skipped, "unhandled_event_type");
    const product = await send(
      "bad-product",
      "retry-user",
      "INITIAL_PURCHASE",
      "unknown-product",
    );
    assert.equal((await product.json()).skipped, "unrecognized_paid_product");
    assert.equal(
      (
        await pool.query(
          "SELECT plan_id FROM subscription_entitlements WHERE user_id='retry-user'",
        )
      ).rows[0].plan_id,
      "pro",
    );
  },
);
