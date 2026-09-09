import React, { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";

import { pushOtaLog } from "@/lib/otaLaunchLog";

/**
 * Dynamic import: Metro keeps the module in the same bundle but defers its
 * evaluation to the first call, which keeps expo-updates out of the root
 * bundle evaluation graph.
 */
const OtaRuntime = lazy(() => import("@/components/OtaRuntime"));

type BoundaryState = { failed: boolean };

/**
 * A broken updater must never take the app down with it — the previous shape
 * turned any expo-updates initialization failure into a startup abort, which
 * the native side then counted as a failed launch for the whole update.
 */
class OtaRuntimeBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    const detail = `updater init failed: ${error?.message ?? String(error)}`;
    pushOtaLog("checkForUpdateAsync", false, detail);
    console.warn(`[ota] ${detail}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Starts the OTA updater and mounts its banners after the first paint.
 * The state flip happens in an effect, so the first committed frame is
 * rendered before any expo-updates code is loaded or run.
 */
export function DeferredOtaRuntime() {
  const [afterFirstPaint, setAfterFirstPaint] = useState(false);

  useEffect(() => {
    setAfterFirstPaint(true);
  }, []);

  if (!afterFirstPaint) return null;

  return (
    <OtaRuntimeBoundary>
      <Suspense fallback={null}>
        <OtaRuntime />
      </Suspense>
    </OtaRuntimeBoundary>
  );
}
