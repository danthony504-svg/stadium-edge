/**
 * Persist the last JS fatal so Home can show it when Menu → OTA Diagnostics
 * itself crashes. No Console.app / macOS / Files app required — Copy from Home.
 *
 * Storage is best-effort AsyncStorage; in-memory cache covers the same session.
 * Never throws into the crash path.
 */

export const LAST_STARTUP_FATAL_KEY = "@stadium/last-startup-fatal";

export type LastStartupFatal = {
  message: string;
  stack: string;
  componentStack: string;
  at: number;
  /** updateId known at capture time when available. */
  updateId: string;
  isFatal: boolean;
};

export type LastStartupFatalStorage = {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
};

const MAX_MESSAGE = 400;
const MAX_STACK = 1200;

let memoryCache: LastStartupFatal | null = null;

export function sanitizeFatalText(value: unknown, max: number): string {
  const s = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function emptyLastStartupFatal(): LastStartupFatal {
  return {
    message: "",
    stack: "",
    componentStack: "",
    at: 0,
    updateId: "",
    isFatal: false,
  };
}

export function parseLastStartupFatal(raw: string | null): LastStartupFatal | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastStartupFatal>;
    const message = sanitizeFatalText(parsed.message, MAX_MESSAGE);
    if (!message) return null;
    return {
      message,
      stack: sanitizeFatalText(parsed.stack, MAX_STACK),
      componentStack: sanitizeFatalText(parsed.componentStack, MAX_STACK),
      at: Number.isFinite(Number(parsed.at)) ? Number(parsed.at) : 0,
      updateId: sanitizeFatalText(parsed.updateId, 120),
      isFatal: parsed.isFatal !== false,
    };
  } catch {
    return null;
  }
}

export function formatLastStartupFatalLines(fatal: LastStartupFatal | null): string[] {
  if (!fatal?.message) return ["(no captured JS fatal on this device)"];
  const when = fatal.at
    ? new Date(fatal.at).toISOString()
    : "—";
  const lines = [
    `last JS fatal @ ${when}`,
    `message: ${fatal.message}`,
    `isFatal: ${String(fatal.isFatal)}`,
    `updateIdAtCapture: ${fatal.updateId || "—"}`,
  ];
  if (fatal.stack) {
    lines.push("stack:");
    for (const line of fatal.stack.split("\n").slice(0, 8)) {
      lines.push(`  ${line}`);
    }
  }
  return lines;
}

/** Sync in-memory read (same process / after write). */
export function peekLastStartupFatalMemory(): LastStartupFatal | null {
  return memoryCache;
}

export function rememberLastStartupFatal(input: {
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  updateId?: string | null;
  isFatal?: boolean;
  at?: number;
}): LastStartupFatal | null {
  const message = sanitizeFatalText(input.message, MAX_MESSAGE);
  if (!message) return null;
  const next: LastStartupFatal = {
    message,
    stack: sanitizeFatalText(input.stack, MAX_STACK),
    componentStack: sanitizeFatalText(input.componentStack, MAX_STACK),
    at: input.at ?? Date.now(),
    updateId: sanitizeFatalText(input.updateId, 120),
    isFatal: input.isFatal !== false,
  };
  memoryCache = next;
  return next;
}

export async function writeLastStartupFatal(
  storage: Pick<LastStartupFatalStorage, "write">,
  fatal: LastStartupFatal,
): Promise<void> {
  memoryCache = fatal;
  try {
    await storage.write(JSON.stringify(fatal));
  } catch {
    // best-effort
  }
}

export async function readLastStartupFatal(
  storage: Pick<LastStartupFatalStorage, "read">,
): Promise<LastStartupFatal | null> {
  if (memoryCache) return memoryCache;
  try {
    const parsed = parseLastStartupFatal(await storage.read());
    if (parsed) memoryCache = parsed;
    return parsed;
  } catch {
    return memoryCache;
  }
}

/** Best-effort AsyncStorage adapter (null in Node tests / when native missing). */
export function tryAsyncStorageLastFatal(): LastStartupFatalStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage") as {
      default?: {
        getItem: (k: string) => Promise<string | null>;
        setItem: (k: string, v: string) => Promise<void>;
      };
      getItem?: (k: string) => Promise<string | null>;
      setItem?: (k: string, v: string) => Promise<void>;
    };
    const store = mod.default ?? mod;
    if (typeof store.getItem !== "function" || typeof store.setItem !== "function") {
      return null;
    }
    return {
      read: () => store.getItem!(LAST_STARTUP_FATAL_KEY),
      write: (raw: string) => store.setItem!(LAST_STARTUP_FATAL_KEY, raw),
    };
  } catch {
    return null;
  }
}

/**
 * Capture + persist. Safe from ErrorUtils / ErrorBoundary — never throws.
 * Storage is optional; without it only the in-memory cache is updated.
 * When storage is omitted, tries AsyncStorage automatically.
 */
export function captureLastStartupFatal(
  input: {
    message: string;
    stack?: string | null;
    componentStack?: string | null;
    updateId?: string | null;
    isFatal?: boolean;
  },
  storage?: LastStartupFatalStorage | null,
): void {
  try {
    const next = rememberLastStartupFatal(input);
    if (!next) return;
    const store = storage === undefined ? tryAsyncStorageLastFatal() : storage;
    if (!store) return;
    void writeLastStartupFatal(store, next);
  } catch {
    // never throw into crash handling
  }
}

/** Test helper. */
export function _resetLastStartupFatalForTests(): void {
  memoryCache = null;
}
