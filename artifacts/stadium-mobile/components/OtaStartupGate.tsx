import type { ReactNode } from "react";

/** @deprecated Startup OTA removed — pass-through only. */
export function OtaStartupGate({ children }: { children: ReactNode }) {
  return children;
}
