import { OtaDiagnosticsBanner } from "@/components/OtaDiagnosticsBanner";
import { OtaUpdateBanner } from "@/components/OtaUpdateBanner";
import { useOtaUpdater } from "@/lib/otaUpdater";

/**
 * Every expo-updates dependency the running app needs lives behind this module.
 * It is only ever reached through the deferred loader, so nothing here is
 * evaluated while the root bundle is still being evaluated — a throw at that
 * point happens before any error boundary exists and native error recovery
 * records the whole update as a failed launch.
 */
export default function OtaRuntime() {
  useOtaUpdater(true);
  return (
    <>
      <OtaUpdateBanner />
      <OtaDiagnosticsBanner />
    </>
  );
}
