import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MINUTE, offsetDay, readFirstBasketArchiveDay, slateDate } from "../src/lib/nbaFirstBasketArchive.js";
import { collectFirstBasket, fetchFirstBasketArchiveOdds } from "../src/lib/nbaFirstBasketCollector.js";
import { readFirstBasketCapture } from "../src/lib/nbaFirstBasketInput.js";
import { auditFirstBasketSlate, expectedFirstBasketGames, refreshStagingFirstBasketCapture, stagingFirstBasketWeek } from "../src/lib/nbaFirstBasketStaging.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function positive(name: string, fallback: number) {
  const supplied = process.env[name];
  if (supplied === undefined) return fallback;
  const value = Number(supplied);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}
async function signal(url: string, body?: { text: string }) {
  if (new URL(url).protocol !== "https:") throw new Error("First Basket alert endpoints require HTTPS");
  const response = await fetch(url, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(8_000),
  } : { redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("First Basket monitoring endpoint returned an error");
}
const root = required("NBA_FIRST_BASKET_ARCHIVE_DIR");
const limits = { creditsPerGame: positive("NBA_FIRST_BASKET_GAME_CREDIT_BUDGET", 45), reserve: positive("NBA_FIRST_BASKET_ODDS_RESERVE", 100) };
if (process.argv[2] === "--week") {
  console.log(JSON.stringify(await stagingFirstBasketWeek(root, process.argv[3] ?? offsetDay(slateDate(Date.now()), -1), limits), null, 2));
} else {
  const file = required("NBA_FIRST_BASKET_CAPTURE");
  const source = required("NBA_FIRST_BASKET_CAPTURE_URL");
  const sourceToken = required("NBA_FIRST_BASKET_CAPTURE_TOKEN");
  const oddsKey = required("ODDS_API_KEY");
  const alert = required("NBA_FIRST_BASKET_ALERT_WEBHOOK");
  const heartbeat = required("NBA_FIRST_BASKET_HEARTBEAT_URL");
  const fastReserve = positive("NBA_FIRST_BASKET_FAST_RESERVE", 0) || undefined;
  await mkdir(root, { recursive: true });
  await mkdir(dirname(file), { recursive: true });
  const startMarker = join(root, "staging-started");
  await writeFile(startMarker, slateDate(Date.now()), { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const firstSlate = await readFile(startMarker, "utf8");
  let stopping = false;
  let wait = new AbortController();
  process.once("SIGTERM", () => { stopping = true; wait.abort(); });
  process.once("SIGINT", () => { stopping = true; wait.abort(); });
  let nextAuditAttempt = 0;
  while (!stopping) {
    const at = Date.now();
    wait = new AbortController();
    try {
      await refreshStagingFirstBasketCapture(file, source, sourceToken);
      const input = await readFirstBasketCapture();
      if (!input) throw new Error("Missing lineup capture");
      const result = await collectFirstBasket(root, input, { now: Date.now, fastReserve,
        requestOdds: id => fetchFirstBasketArchiveOdds(oddsKey, id) });
      console.log(JSON.stringify({ at, ...result }));
      await signal(heartbeat);
    } catch {
      console.error(JSON.stringify({ at, status: "first_basket_poll_failed" }));
    }
    if (!stopping && at >= nextAuditAttempt) {
      nextAuditAttempt = at + 15 * MINUTE;
      const day = offsetDay(slateDate(at), -1);
      const marker = join(root, `slate-audited-${day}`);
      if (day >= firstSlate && !existsSync(marker)) {
        try {
          const [expected, records] = await Promise.all([expectedFirstBasketGames(day), readFirstBasketArchiveDay(root, day)]);
          const result = auditFirstBasketSlate(records, expected, limits);
          if (!result.passed) await signal(alert, { text: `Stadium Edge First Basket staging: ${day} did not pass capture or quota checks. Missing events: ${result.missingEventIds.join(", ") || "none"}. See worker logs.` });
          console.log(JSON.stringify({ day, ...result }));
          await writeFile(marker, JSON.stringify(result) + "\n", { flag: "wx", mode: 0o600 });
        } catch {
          console.error(JSON.stringify({ day, status: "first_basket_daily_audit_failed" }));
        }
      }
    }
    if (!stopping) await delay(Math.max(0, MINUTE - (Date.now() - at)), undefined, { signal: wait.signal }).catch(() => {});
  }
}
