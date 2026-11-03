import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

let active: ChildProcess | null = null,
  lastAttempt = 0,
  shuttingDown = false;

/** No network, SQL or simulation on the caller's request path. */
export function queueNcaabResearchValidation(): boolean {
  if (
    process.env.NCAAB_RESEARCH_PIPELINE_ENABLED !== "true" ||
    shuttingDown ||
    active ||
    Date.now() - lastAttempt < 60_000
  )
    return false;
  lastAttempt = Date.now();
  try {
    const worker = fileURLToPath(
      new URL("./ncaabResearchWorker.mjs", import.meta.url),
    );
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=256", worker],
      { stdio: "ignore", env: process.env },
    );
    active = child;
    const timeout = setTimeout(() => {
      logger.warn("ncaab research worker timed out");
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      force.unref();
      child.once("exit", () => clearTimeout(force));
    }, 12 * 60_000);
    timeout.unref();
    const clear = () => {
      clearTimeout(timeout);
      if (active === child) active = null;
    };
    child.once("error", () => {
      clear();
      logger.warn("ncaab research worker could not start");
    });
    child.once("exit", (code) => {
      clear();
      if (code && code !== 0)
        logger.warn({ code }, "ncaab research worker exited unsuccessfully");
    });
    return true;
  } catch {
    active = null;
    logger.warn("ncaab research worker launch failed");
    return false;
  }
}

export function stopNcaabResearchValidation() {
  shuttingDown = true;
  active?.kill("SIGTERM");
}
