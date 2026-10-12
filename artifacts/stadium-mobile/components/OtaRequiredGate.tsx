import type { ReactNode } from "react";

/**
 * LEGACY — disabled.
 * Full-screen forced-restart gate used native isUpdatePending and reloadAsync.
 * Production banner/restart is owned solely by OtaController + OtaUpdateBanner.
 */
export function OtaRequiredGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
