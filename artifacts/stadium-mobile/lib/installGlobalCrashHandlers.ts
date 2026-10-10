/**
 * Phase A global JS exception hooks (OTA-safe, runtime 1.1.0).
 * Chains the previous ErrorUtils handler so fatal handling is never suppressed.
 * Skips errors already reported by ErrorBoundary to avoid duplicate POSTs.
 */

import {
  markBoundaryReported,
  reportCrash,
  wasBoundaryReported,
} from "./crashReporter.ts";

export type RnErrorUtils = {
  getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

type InstallOptions = {
  /** Injectable ErrorUtils for unit tests. */
  errorUtils?: RnErrorUtils | null;
  /** Injectable unhandledrejection target (defaults to globalThis). */
  rejectionTarget?: {
    addEventListener?: (type: string, listener: (ev: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (ev: unknown) => void) => void;
    onunhandledrejection?: ((ev: unknown) => void) | null;
  };
  report?: typeof reportCrash;
};

let installed = false;
let uninstallRejection: (() => void) | null = null;

/** Test helper. */
export function _resetGlobalCrashHandlersForTests(): void {
  installed = false;
  if (uninstallRejection) {
    try {
      uninstallRejection();
    } catch {
      // ignore
    }
    uninstallRejection = null;
  }
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" ? reason : "Unhandled promise rejection");
}

function reportSafely(
  error: Error,
  report: typeof reportCrash,
): void {
  try {
    if (wasBoundaryReported(error.message, error.stack)) return;
    report({
      errorMessage: error.message || String(error),
      errorStack: error.stack ?? null,
    });
  } catch {
    // Never let the reporter break fatal handling.
  }
}

/**
 * Install once. Safe to call from module scope — never throws.
 * Returns true when a global ErrorUtils handler was chained.
 */
export function installGlobalCrashHandlers(opts: InstallOptions = {}): boolean {
  if (installed) return true;
  installed = true;
  const report = opts.report ?? reportCrash;

  let chained = false;
  try {
    let errorUtils = opts.errorUtils;
    if (errorUtils === undefined) {
      try {
        // Dynamic require keeps node:test free of the RN native module graph.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const rn = require("react-native") as { ErrorUtils?: RnErrorUtils };
        errorUtils = rn.ErrorUtils ?? null;
      } catch {
        errorUtils = null;
      }
    }

    if (errorUtils && typeof errorUtils.getGlobalHandler === "function") {
      const previous = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        reportSafely(error, report);
        // Never suppress normal fatal-error handling.
        if (typeof previous === "function") {
          previous(error, isFatal);
        }
      });
      chained = true;
    }
  } catch {
    // Leave previous handler alone.
  }

  try {
    const target = opts.rejectionTarget ?? (globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: (ev: unknown) => void) => void;
      removeEventListener?: (type: string, listener: (ev: unknown) => void) => void;
      onunhandledrejection?: ((ev: unknown) => void) | null;
    });

    if (typeof target.addEventListener === "function") {
      const listener = (ev: unknown) => {
        const reason =
          ev && typeof ev === "object" && "reason" in ev
            ? (ev as { reason: unknown }).reason
            : ev;
        reportSafely(toError(reason), report);
        // Do not preventDefault — allow default rejection handling to continue.
      };
      target.addEventListener("unhandledrejection", listener);
      uninstallRejection = () => {
        target.removeEventListener?.("unhandledrejection", listener);
      };
    } else if ("onunhandledrejection" in target || opts.rejectionTarget) {
      const prev = target.onunhandledrejection ?? null;
      const handler = (ev: unknown) => {
        const reason =
          ev && typeof ev === "object" && "reason" in ev
            ? (ev as { reason: unknown }).reason
            : ev;
        reportSafely(toError(reason), report);
        if (typeof prev === "function") {
          try {
            prev(ev);
          } catch {
            // ignore chained failure
          }
        }
      };
      target.onunhandledrejection = handler;
      uninstallRejection = () => {
        target.onunhandledrejection = prev;
      };
    }
  } catch {
    // Optional path — ErrorUtils chain is the primary capture.
  }

  return chained;
}

/** Re-export for ErrorBoundary wiring tests. */
export { markBoundaryReported };
