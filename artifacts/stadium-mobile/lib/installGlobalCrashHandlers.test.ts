import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  _resetCrashReporterForTests,
  markBoundaryReported,
  wasBoundaryReported,
} from "./crashReporter.ts";
import {
  _resetGlobalCrashHandlersForTests,
  installGlobalCrashHandlers,
  type RnErrorUtils,
} from "./installGlobalCrashHandlers.ts";

test("handler chaining preserves previous ErrorUtils handler and reports once", () => {
  _resetCrashReporterForTests();
  _resetGlobalCrashHandlersForTests();

  const reports: string[] = [];
  let previousCalls = 0;
  let currentHandler: ((error: Error, isFatal?: boolean) => void) | undefined = (
    _error,
    _isFatal,
  ) => {
    previousCalls += 1;
  };

  const errorUtils: RnErrorUtils = {
    getGlobalHandler: () => currentHandler,
    setGlobalHandler: (handler) => {
      currentHandler = handler;
    },
  };

  const chained = installGlobalCrashHandlers({
    errorUtils,
    report: (input) => {
      reports.push(input.errorMessage);
    },
  });
  assert.equal(chained, true);

  const err = new Error("global-boom");
  currentHandler?.(err, true);
  assert.equal(reports.length, 1);
  assert.equal(reports[0], "global-boom");
  assert.equal(previousCalls, 1, "previous fatal handler must still run");
});

test("ErrorBoundary-marked errors are not double-reported by global handler", () => {
  _resetCrashReporterForTests();
  _resetGlobalCrashHandlersForTests();

  const reports: string[] = [];
  let currentHandler: ((error: Error, isFatal?: boolean) => void) | undefined =
    () => {};

  const errorUtils: RnErrorUtils = {
    getGlobalHandler: () => currentHandler,
    setGlobalHandler: (handler) => {
      currentHandler = handler;
    },
  };

  installGlobalCrashHandlers({
    errorUtils,
    report: (input) => {
      reports.push(input.errorMessage);
    },
  });

  const err = new Error("boundary-already");
  markBoundaryReported(err.message, err.stack);
  assert.equal(wasBoundaryReported(err.message, err.stack), true);
  currentHandler?.(err, false);
  assert.equal(reports.length, 0, "global handler must skip boundary-marked crashes");
});

test("reporter failure never suppresses previous fatal handler", () => {
  _resetCrashReporterForTests();
  _resetGlobalCrashHandlersForTests();

  let previousCalls = 0;
  let currentHandler: ((error: Error, isFatal?: boolean) => void) | undefined = () => {
    previousCalls += 1;
  };

  const errorUtils: RnErrorUtils = {
    getGlobalHandler: () => currentHandler,
    setGlobalHandler: (handler) => {
      currentHandler = handler;
    },
  };

  installGlobalCrashHandlers({
    errorUtils,
    report: () => {
      throw new Error("reporter exploded");
    },
  });

  assert.doesNotThrow(() => currentHandler?.(new Error("fatal-x"), true));
  assert.equal(previousCalls, 1);
});

test("unhandledrejection path reports and chains prior handler", () => {
  _resetCrashReporterForTests();
  _resetGlobalCrashHandlersForTests();

  const reports: string[] = [];
  let prior = 0;
  const target: {
    onunhandledrejection: ((ev: unknown) => void) | null;
  } = {
    onunhandledrejection: () => {
      prior += 1;
    },
  };

  installGlobalCrashHandlers({
    errorUtils: null,
    rejectionTarget: target,
    report: (input) => {
      reports.push(input.errorMessage);
    },
  });

  target.onunhandledrejection?.({ reason: new Error("reject-me") });
  assert.equal(reports.length, 1);
  assert.equal(reports[0], "reject-me");
  assert.equal(prior, 1);
});

test("root layout installs global crash handlers", () => {
  const src = readFileSync(join(process.cwd(), "app/_layout.tsx"), "utf8");
  assert.match(src, /installGlobalCrashHandlers/);
});
