import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";
let active: ChildProcess | null = null,
  lastAttempt = 0,
  shuttingDown = false;
/** No network, SQL or simulation on the caller's request path. */
export function queueNcaafResearchValidation(): boolean {
  if (
    process.env.NCAAF_RESEARCH_PIPELINE_ENABLED !== "true" ||
    shuttingDown ||
    active ||
    Date.now() - lastAttempt < 60_000
  )
    return false;
  lastAttempt = Date.now();
  try {
    const worker = fileURLToPath(
      new URL("./ncaafResearchWorker.mjs", import.meta.url),
    );
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=256", worker],
      { stdio: "ignore", env: process.env },
    );
    active = child;
    const timeout = setTimeout(() => {
      logger.warn("ncaaf research worker timed out");
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
      logger.warn("ncaaf research worker could not start");
    });
    child.once("exit", (code) => {
      clear();
      if (code && code !== 0)
        logger.warn({ code }, "ncaaf research worker exited unsuccessfully");
    });
    return true;
  } catch {
    active = null;
    logger.warn("ncaaf research worker launch failed");
    return false;
  }
}
export function stopNcaafResearchValidation() {
  shuttingDown = true;
  active?.kill("SIGTERM");
}
