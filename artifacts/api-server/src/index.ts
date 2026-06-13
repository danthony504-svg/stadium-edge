import app from "./app";
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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void logCronHealthOnBoot();
});
