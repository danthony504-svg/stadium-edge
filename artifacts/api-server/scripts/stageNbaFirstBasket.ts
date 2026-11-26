import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MINUTE, offsetDay, readFirstBasketArchiveDay, slateDate } from "../src/lib/nbaFirstBasketArchive.js";
import { collectFirstBasket, fetchFirstBasketArchiveOdds, firstBasketRemainingCredits } from "../src/lib/nbaFirstBasketCollector.js";
import { readFirstBasketCapture } from "../src/lib/nbaFirstBasketInput.js";
import { auditFirstBasketSlate, createFirstBasketMonitoredPoll, expectedFirstBasketGames, firstBasketDiskFree, refreshStagingFirstBasketCapture, stagingFirstBasketWeek } from "../src/lib/nbaFirstBasketStaging.js";

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
async function smoke(root: string) {
  const directory = join(root, "smoke");
  await mkdir(directory, { recursive: true });
  const minimumBytes = positive("NBA_FIRST_BASKET_MIN_FREE_MIB", 64) * 1024 * 1024;
  const realFreeBytes = await firstBasketDiskFree(directory);
  if (realFreeBytes < minimumBytes) throw new Error("Insufficient staging disk space");
  let freeBytes = realFreeBytes;
  let heartbeats = 0;
  let alerts = 0;
  let collections = 0;
  const poll = createFirstBasketMonitoredPoll({
    minimumBytes, freeBytes: async () => freeBytes,
    collect: async () => { collections++; },
    alert: async () => { alerts++; },
    heartbeat: async () => { heartbeats++; },
  });
  if (await poll() !== "healthy") throw new Error("Initial staging heartbeat failed");
  freeBytes = minimumBytes - 1;
  if (await poll() !== "disk_stop" || await poll() !== "disk_stop") throw new Error("Low disk did not stop collection");
  const heartbeatWithheld = heartbeats === 1 && collections === 1;
  freeBytes = realFreeBytes;
  if (await poll() !== "healthy" || !heartbeatWithheld || heartbeats !== 2 || alerts !== 1 || collections !== 2) {
    throw new Error("Unexpected staging monitoring signals");
  }
  const receipt = { status: "first_basket_smoke_passed", at: Date.now(), heartbeats, alerts, heartbeatWithheld, paidRequests: 0 };
  await writeFile(join(directory, "receipt.json"), JSON.stringify(receipt) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(receipt));
  if (process.argv[2] === "--smoke-once") return;
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  while (!stop.signal.aborted) {
    await delay(MINUTE, undefined, { signal: stop.signal }).catch(() => {});
    if (!stop.signal.aborted) console.log(JSON.stringify({ status: "first_basket_smoke_heartbeat", at: Date.now() }));
  }
}

const root = required("NBA_FIRST_BASKET_ARCHIVE_DIR");
const limits = {
  creditsPerGame: positive("NBA_FIRST_BASKET_GAME_CREDIT_BUDGET", 45),
  creditsPerSlate: positive("NBA_FIRST_BASKET_SLATE_CREDIT_BUDGET", 675),
  reserve: positive("NBA_FIRST_BASKET_ODDS_RESERVE", 100),
};
if (process.argv[2] === "--week") {
  console.log(JSON.stringify(await stagingFirstBasketWeek(root, process.argv[3] ?? offsetDay(slateDate(Date.now()), -1), limits), null, 2));
} else if (process.env.NBA_FIRST_BASKET_SMOKE_MODE === "1") {
  await smoke(root);
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
  const secrets = [source, sourceToken, oddsKey, alert, heartbeat];
  const poll = createFirstBasketMonitoredPoll({
    freeBytes: () => firstBasketDiskFree(root),
    minimumBytes: positive("NBA_FIRST_BASKET_MIN_FREE_MIB", 64) * 1024 * 1024,
    alert: () => signal(alert, { text: "Stadium Edge First Basket staging stopped collection because archive disk space is below its configured minimum." }),
    heartbeat: () => signal(heartbeat),
    collect: async () => {
      await refreshStagingFirstBasketCapture(file, source, sourceToken, secrets);
      const input = await readFirstBasketCapture();
      if (!input) throw new Error("Missing lineup capture");
      const result = await collectFirstBasket(root, input, { now: Date.now, fastReserve, limits, secrets,
        readRemaining: () => firstBasketRemainingCredits(oddsKey),
        requestOdds: id => fetchFirstBasketArchiveOdds(oddsKey, id) });
      console.log(JSON.stringify({ at: Date.now(), ...result }));
      if (result.stops.quotaUnavailable > 0) throw new Error("Quota read unavailable");
    },
  });
  while (!stopping) {
    const at = Date.now();
    wait = new AbortController();
    try {
      const status = await poll();
      if (status === "disk_stop") console.error(JSON.stringify({ at, status: "first_basket_disk_stop" }));
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
