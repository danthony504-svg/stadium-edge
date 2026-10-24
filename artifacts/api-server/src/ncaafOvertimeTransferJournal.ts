/** Manual research entry point. Default is a read-only plan with zero provider calls. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordOvertimeTransferForecasts } from "./lib/ncaafOvertimeTransferJournal.js";
async function main() {
  if (!process.env.DATABASE_URL) throw Error("transfer_database_missing");
  const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const requireDb = createRequire(resolve(root, "lib/db/package.json"));
  const { Client } = requireDb("pg");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await db.connect();
  try {
    const result = await recordOvertimeTransferForecasts(
      db,
      process.argv.includes("--execute"),
    );
    console.log(JSON.stringify(result));
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error("ncaaf OT transfer research failed; no release change");
  process.exitCode = 1;
});
