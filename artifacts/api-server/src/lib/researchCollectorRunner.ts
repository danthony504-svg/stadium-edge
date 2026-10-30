/**
 * Spawn research collectors with preserved, sanitized failure reasons.
 * Never forwards provider bodies or arbitrary stderr.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ALLOWED_DETAIL =
  /^(context|conference|usage|repair|history|injury|ncaab|pipeline|collector)_[a-z0-9_]+$/;

export function sanitizeCollectorDetail(text: string): string | null {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    // Prefer exact allowlisted codes; ignore narrative console.error text.
    const token = line.split(/\s+/).find((t) => ALLOWED_DETAIL.test(t));
    if (token) return token;
    if (ALLOWED_DETAIL.test(line)) return line;
  }
  return null;
}

export function collectorFailureCode(
  scriptName: string,
  opts: {
    detail?: string | null;
    timedOut?: boolean;
    startFailed?: boolean;
    oomOrKilled?: boolean;
    signalTerminated?: boolean;
    codePrefix?: string;
  } = {},
): string {
  const prefix = opts.codePrefix ?? "pipeline_collector";
  const base = scriptName
    .replace(/\.mjs$/i, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
  if (opts.timedOut) return `${prefix}_${base}_timeout`;
  if (opts.startFailed) return `${prefix}_${base}_start_failed`;
  if (opts.oomOrKilled) return `${prefix}_${base}_oom_or_killed`;
  if (opts.signalTerminated) return `${prefix}_${base}_signal_terminated`;
  if (opts.detail && ALLOWED_DETAIL.test(opts.detail))
    return `${prefix}_${base}_${opts.detail}`;
  return `${prefix}_${base}_failed`;
}

/** Map child termination to a stable, sanitized failure code. */
export function collectorExitFailure(
  scriptName: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
  codePrefix = "pipeline_collector",
): string {
  if (signal === "SIGKILL" || code === 137)
    return collectorFailureCode(scriptName, { oomOrKilled: true, codePrefix });
  if (signal)
    return collectorFailureCode(scriptName, {
      signalTerminated: true,
      codePrefix,
    });
  return collectorFailureCode(scriptName, {
    detail: sanitizeCollectorDetail(stderr),
    codePrefix,
  });
}

export async function runResearchCollector(opts: {
  repoRoot: string;
  scriptName: string;
  args?: string[];
  allowed: Set<string>;
  env?: NodeJS.ProcessEnv;
  heapMb?: number;
  timeoutMs?: number;
  unknownCode?: string;
  codePrefix?: string;
}): Promise<void> {
  const {
    repoRoot,
    scriptName,
    args = [],
    allowed,
    env = process.env,
    heapMb = 384,
    timeoutMs = 8 * 60_000,
    unknownCode = "pipeline_unknown_collector",
    codePrefix = "pipeline_collector",
  } = opts;
  if (!allowed.has(scriptName)) throw Error(unknownCode);

  let stderr = "";
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${heapMb}`,
        resolve(repoRoot, "scripts", scriptName),
        ...args,
        "--execute",
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env,
      },
    );
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        Error(collectorFailureCode(scriptName, { timedOut: true, codePrefix })),
      );
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timeout);
      reject(
        Error(
          collectorFailureCode(scriptName, { startFailed: true, codePrefix }),
        ),
      );
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(
        Error(
          collectorExitFailure(scriptName, code, signal, stderr, codePrefix),
        ),
      );
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    child.once("exit", () => process.off("SIGTERM", stop));
  });
}
