/** Run only against an explicit localhost TEST_DATABASE_URL, never production. */
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { referralStore, ReferralError } from "../src/lib/referralStore.js";
import { encryptOffer, offerHash } from "../src/lib/referralPolicy.js";
const configured = process.env.TEST_DATABASE_URL;
const schema = `referral_test_${process.pid}`;
let pool: typeof import("@workspace/db").pool;
let store: ReturnType<typeof referralStore>;
const old = new Date(Date.now() - 86400000 * 2);
const recent = new Date(Date.now() - 3600000);
if (configured) {
  const url = new URL(configured);
  assert.ok(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname),
    "Tests require a localhost database",
  );
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  process.env.REFERRAL_REWARDS_KEY = "34".repeat(32);
}
before(async () => {
  if (!configured) return;
  ({ pool } = await import("@workspace/db"));
  await pool.query(`CREATE SCHEMA ${schema}`);
  const sql = await readFile(
    new URL(
      "../../../lib/db/migrations/20261019_create_referrals.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await pool.query(sql);
  store = referralStore(pool);
});
after(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
});
beforeEach(async () => {
  if (pool)
    await pool.query(
      "TRUNCATE referral_rewards,referral_offer_codes,referral_conversions,referral_accounts RESTART IDENTITY CASCADE",
    );
});
const check = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !configured }, fn);
async function owner(id = "owner") {
  return store.account(id, `hash-${id}`, old);
}
async function qualify(id = "owner", n = 3) {
  const a = await owner(id);
  for (let i = 0; i < n; i++) {
    const u = `${id}-friend-${i}`;
    await store.account(u, `hash-${u}`, recent);
    await store.convert(u, `hash-${u}`, a.code, recent);
  }
  return a;
}
async function voucher(
  milestone = 3,
  label = "TESTAPPLEOFFER123456",
  expiry = new Date(Date.now() + 86400000 * 10),
) {
  await pool.query(
    "INSERT INTO referral_offer_codes(milestone,encrypted_code,code_hash,expires_at) VALUES($1,$2,$3,$4)",
    [milestone, encryptOffer(label), offerHash(label), expiry],
  );
}
check(
  "legacy codes, concurrent registration and verified email collisions",
  async () => {
    const values = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.account("user_KKDECI4H", "owner-email", old),
      ),
    );
    assert.ok(values.every((v) => v.code === "KKDECI4H"));
    await assert.rejects(() =>
      store.account("someone-else", "owner-email", recent),
    );
    const collision = await store.account(
      "user_prefixKKDECI4H",
      "other-email",
      recent,
    );
    assert.notEqual(collision.code, "KKDECI4H");
  },
);
check("duplicate requests count once and cannot change inviter", async () => {
  const a = await owner();
  const b = await owner("other");
  await store.account("friend", "friend-email", recent);
  await Promise.all(
    Array.from({ length: 10 }, () =>
      store.convert("friend", "friend-email", a.code, recent),
    ),
  );
  assert.equal((await store.status("owner")).verifiedFriends, 1);
  await assert.rejects(
    () => store.convert("friend", "friend-email", b.code, recent),
    { status: 409 },
  );
});
check("self-referrals and unknown codes never count", async () => {
  const a = await owner();
  await assert.rejects(
    () => store.convert("owner", "hash-owner", a.code, recent),
    { status: 400 },
  );
  await assert.rejects(
    () => store.convert("owner", "hash-owner", "UNKNOWN1", recent),
    { status: 404 },
  );
  assert.equal((await store.status("owner")).verifiedFriends, 0);
});
check("locked concurrent claims reserve one offer exactly once", async () => {
  await qualify();
  await voucher();
  const claims = await Promise.all(
    Array.from({ length: 15 }, () => store.claim("owner", 3)),
  );
  assert.ok(claims.every((c) => c.redemptionUrl === claims[0].redemptionUrl));
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM referral_rewards"))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM referral_offer_codes WHERE assigned_at IS NOT NULL",
      )
    ).rows[0].n,
    1,
  );
});
check("different users cannot receive the same code", async () => {
  await qualify("a");
  await qualify("b");
  await voucher();
  const outcomes = await Promise.allSettled([
    store.claim("a", 3),
    store.claim("b", 3),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.filter(
      (o) =>
        o.status === "rejected" &&
        o.reason instanceof ReferralError &&
        o.reason.status === 503,
    ).length,
    1,
  );
});
check(
  "thresholds, invalid milestones and expired inventory fail closed",
  async () => {
    await qualify("owner", 2);
    await voucher();
    await assert.rejects(() => store.claim("owner", 3), { status: 409 });
    await assert.rejects(() => store.claim("owner", 1), { status: 400 });
    await qualify("ten", 10);
    await voucher(10, "TESTEXPIREDCODE123", new Date(Date.now() - 1000));
    await assert.rejects(() => store.claim("ten", 10), { status: 503 });
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM referral_rewards"))
        .rows[0].n,
      0,
    );
  },
);
check("week and month are independent once-only milestones", async () => {
  await qualify("owner", 10);
  await voucher();
  await voucher(10, "TESTMONTHCODE12345");
  const week = await store.claim("owner", 3);
  const month = await store.claim("owner", 10);
  assert.notEqual(week.redemptionUrl, month.redemptionUrl);
  assert.deepEqual(
    (await store.status("owner")).milestones.map((m) => m.claimed),
    [true, true],
  );
});
check(
  "deleting accounts removes identity but never recycles assigned Apple offers",
  async () => {
    const a = await qualify();
    await voucher();
    await store.claim("owner", 3);
    await store.removeAccount("owner-friend-0");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM referral_conversions WHERE referred_user_id IS NULL AND retired_at IS NOT NULL",
        )
      ).rows[0].n,
      1,
    );
    await store.account("recreated", "hash-owner-friend-0", recent);
    await assert.rejects(
      () => store.convert("recreated", "hash-owner-friend-0", a.code, recent),
      { status: 409 },
    );
    await store.removeAccount("owner");
    const offer = (
      await pool.query(
        "SELECT assigned_user_id,assigned_at FROM referral_offer_codes",
      )
    ).rows[0];
    assert.equal(offer.assigned_user_id, null);
    assert.ok(offer.assigned_at);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM referral_rewards"))
        .rows[0].n,
      0,
    );
  },
);
