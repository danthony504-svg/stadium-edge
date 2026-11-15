import assert from "node:assert/strict";
import test from "node:test";
import { readPaidEntitlementForOwner } from "../src/lib/ownerEntitlementRead.js";

test("paid database errors do not erase verified owner access or invent a paid row", async () => {
  const failure = new Error("database unavailable");
  const read = async () => { throw failure; };
  assert.deepEqual(await readPaidEntitlementForOwner(true, read), {
    row: undefined,
    paidReadUnavailable: true,
  });
  await assert.rejects(readPaidEntitlementForOwner(false, read), error => error === failure);
});

test("healthy paid reads retain the existing row or absence for owners and regular users", async () => {
  const revoked = { planId: "pro", status: "revoked" };
  for (const owner of [false, true]) {
    for (const row of [undefined, revoked]) {
      assert.deepEqual(await readPaidEntitlementForOwner(owner, async () => row), {
        row,
        paidReadUnavailable: false,
      });
    }
  }
});
