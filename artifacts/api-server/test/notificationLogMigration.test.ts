import assert from "node:assert/strict";
import test from "node:test";
import { applyNotificationLogMigration } from "../src/lib/notificationLogMigration.js";
test("notification schema repair refuses another database before any DDL", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () =>
      applyNotificationLogMigration(
        {
          query: async (sql) => {
            calls.push(sql);
            return { rows: [{ name: "wrong_database" }] };
          },
        },
        "DDL",
      ),
    /unexpected_database/,
  );
  assert.deepEqual(calls, ["SELECT current_database() AS name"]);
});
test("failed notification schema repair rolls back before returning its client", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () =>
      applyNotificationLogMigration(
        {
          query: async (sql) => {
            calls.push(sql);
            if (sql.includes("current_database"))
              return { rows: [{ name: "stadium_edge_production" }] };
            if (sql === "DDL") throw Error("failure");
            return {};
          },
        },
        "DDL",
      ),
    /failure/,
  );
  assert.equal(calls.at(-1), "ROLLBACK");
});
