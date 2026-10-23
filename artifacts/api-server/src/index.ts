import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { applyNotificationLogMigration } from "./lib/notificationLogMigration.js";
import { applyOperationalSchemaMigration } from "./lib/operationalSchemaMigration.js";
import app from "./app";
import {
  queueNcaafResearchValidation,
  stopNcaafResearchValidation,
} from "./lib/ncaafResearchScheduler.js";
import { logger } from "./lib/logger";
import { getCronHealth } from "./lib/notifyJobs";

// On boot, surface the state of the Scheduled Deployment that drives every
// time-based feature (push triggers + abandoned-Coach-build sweeper). If a
// heartbeat exists but is stale, the schedule likely stopped firing — warn
// loudly so a silent stall is noticed. A brand-new deploy that has never run is
// expected, so that case is logged at info level (not a warning).
async function logCronHealthOnBoot(): Promise<void> {
  try {
    const health = await getCronHealth();
    if (!health.everRan) {
      logger.info(
        { health },
        "cron heartbeat: no run recorded yet (awaiting first Scheduled Deployment tick)",
      );
    } else if (health.stale) {
      logger.warn(
        { health },
        "cron heartbeat STALE — notification Scheduled Deployment may have stopped firing",
      );
    } else {
      logger.info({ health }, "cron heartbeat healthy");
    }
  } catch (err) {
    logger.warn({ err }, "cron heartbeat check on boot failed");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Explicit opt-in for the missing production notification dedupe table.
// Read from the repository relative to the built dist/index.mjs entry point.
if (process.env.APPLY_NOTIF_LOG_MIGRATION === "true") {
  const client = await pool.connect();
  try {
    await applyNotificationLogMigration(
      client,
      await readFile(
        new URL(
          "../../../lib/db/migrations/20261023_create_notif_log.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    logger.info("notification dedupe schema migration complete");
  } finally {
    client.release();
  }
}

// One-time, production-name-guarded repair of missing operational tables.
if (process.env.APPLY_OPERATIONAL_SCHEMA_MIGRATION === "true") {
  const client = await pool.connect();
  try {
    await applyOperationalSchemaMigration(client, await readFile(new URL(
      "../../../lib/db/migrations/20261023_create_missing_operational_tables.sql", import.meta.url), "utf8"));
    logger.info("operational schema migration complete");
  } finally { client.release(); }
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void logCronHealthOnBoot();
  queueNcaafResearchValidation();
});

process.once("SIGTERM", () => {
  stopNcaafResearchValidation();
  server.close(() => process.exit(0));
  const deadline = setTimeout(() => process.exit(0), 25_000);
  deadline.unref();
});
