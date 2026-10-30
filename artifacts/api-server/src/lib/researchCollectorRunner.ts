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
    // Usage/conference diagnostics often emit one compact JSON object on stderr.
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const parsed = JSON.parse(line) as {
          failureCode?: unknown;
          reason?: unknown;
        };
        for (const candidate of [parsed.failureCode, parsed.reason]) {
          if (typeof candidate === "string" && ALLOWED_DETAIL.test(candidate))
            return candidate;
        }
      } catch {
        // Ignore non-JSON noise; fall through to token scan.
      }
    }
    // Prefer exact allowlisted codes; ignore narrative console.error text.
    const token = line.split(/\s+/).find((t) => ALLOWED_DETAIL.test(t));
    if (token) return token;
    if (ALLOWED_DETAIL.test(line)) return line;
  }
  // Truncated or pretty-printed JSON: pull only the allowlisted failureCode field.
  const embedded = String(text ?? "").match(
    /"failureCode"\s*:\s*"((?:context|conference|usage|repair|history|injury|ncaab|pipeline|collector)_[a-z0-9_]+)"/,
  );
  return embedded?.[1] ?? null;
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

  await new Promise<void>((resolveRun, reject) => {
    let settled = false;
    let stderr = "";
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let stderrClosed = false;
    let stderrWait: ReturnType<typeof setTimeout> | undefined;

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

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stderrWait) clearTimeout(stderrWait);
      process.off("SIGTERM", onTerm);
      action();
    };

    const finishAfterStderr = () => {
      if (!exited || !stderrClosed || settled) return;
      if (exitCode === 0 && !exitSignal) {
        settle(() => resolveRun());
        return;
      }
      settle(() =>
        reject(
          Error(
            collectorExitFailure(
              scriptName,
              exitCode,
              exitSignal,
              stderr,
              codePrefix,
            ),
          ),
        ),
      );
    };

    const markStderrClosed = () => {
      stderrClosed = true;
      finishAfterStderr();
    };

    if (!child.stderr) {
      markStderrClosed();
    } else {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8000);
      });
      // Prefer 'close' so buffered bytes are drained before we classify failures.
      child.stderr.once("close", markStderrClosed);
      child.stderr.once("error", markStderrClosed);
    }

    const timeout = setTimeout(() => {
      // Child may have already exited while we drain stderr; never override that.
      if (exited || settled) return;
      child.kill("SIGKILL");
      settle(() =>
        reject(
          Error(
            collectorFailureCode(scriptName, { timedOut: true, codePrefix }),
          ),
        ),
      );
    }, timeoutMs);

    child.once("error", () => {
      settle(() =>
        reject(
          Error(
            collectorFailureCode(scriptName, {
              startFailed: true,
              codePrefix,
            }),
          ),
        ),
      );
    });

    child.once("exit", (code, signal) => {
      // Disarm the wall-clock timer immediately so a near-deadline exit (including
      // success) cannot be SIGKILL'd / rejected as *_timeout during stderr drain.
      clearTimeout(timeout);
      exited = true;
      exitCode = code;
      exitSignal = signal;
      // SIGKILL / abrupt close can skip stderr 'close'; bound the wait.
      stderrWait = setTimeout(() => {
        if (!stderrClosed) markStderrClosed();
      }, 100);
      finishAfterStderr();
    });

    const onTerm = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      // A process SIGTERM listener disables Node's default exit. Forward to the
      // child, then exit so freeze/journal cannot continue past scheduler shutdown.
      settle(() => {
        process.exitCode = 143;
        process.exit(143);
      });
    };
    process.once("SIGTERM", onTerm);
  });
}
