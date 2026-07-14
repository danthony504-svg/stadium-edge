import type { ReactNode } from "react";

/**
 * @deprecated Startup OTA gate removed — pass-through only so legacy imports compile.
 * Updates are user-initiated via OtaUpdateBanner or Menu → OTA Diagnostics.
 */
export function OtaStartupGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
