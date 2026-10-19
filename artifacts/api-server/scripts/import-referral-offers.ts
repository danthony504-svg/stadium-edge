/** Offline operator tool. Input JSON stays outside git; output never prints codes. */
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { encryptOffer, offerHash } from "../src/lib/referralPolicy.js";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: import-referral-offers.ts /secure/path/apple-offers.json",
  );
const entries: unknown = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(entries) || !entries.length || entries.length > 25000)
  throw new Error("Expected 1–25000 offer entries.");
const checked = entries.map((e) => {
  if (
    ![3, 10].includes(e.milestone) ||
    typeof e.code !== "string" ||
    !/^[A-Z0-9]{8,32}$/.test(e.code) ||
    !Number.isFinite(Date.parse(e.expiresAt)) ||
    Date.parse(e.expiresAt) <= Date.now() + 86400000
  )
    throw new Error("Invalid milestone, Apple code or expiry.");
  return {
    milestone: e.milestone,
    encrypted: encryptOffer(e.code),
    hash: offerHash(e.code),
    expires: new Date(e.expiresAt),
  };
});
const c = await pool.connect();
try {
  await c.query("BEGIN");
  for (const e of checked)
    await c.query(
      `INSERT INTO referral_offer_codes(milestone,encrypted_code,code_hash,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(code_hash) DO NOTHING`,
      [e.milestone, e.encrypted, e.hash, e.expires],
    );
  await c.query("COMMIT");
  console.info(
    `Processed ${checked.length} offers; duplicate codes were skipped.`,
  );
} catch {
  await c.query("ROLLBACK");
  throw new Error("Import failed; no offers were committed.");
} finally {
  c.release();
  await pool.end();
}
