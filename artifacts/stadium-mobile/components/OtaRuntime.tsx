import { OtaUpdateBanner } from "@/components/OtaUpdateBanner";
import { useOtaController } from "@/lib/ota";

/**
 * Sole production owner of OTA update behavior.
 * Loaded only via DeferredOtaRuntime after first paint.
 *
 * Does NOT use the legacy updater hook / recovery / auto-reload stack.
 */
export default function OtaRuntime() {
  const { snapshot, restart } = useOtaController(true);

  return (
    <OtaUpdateBanner
      snapshot={snapshot}
      onRestart={() => {
        void restart();
      }}
    />
  );
}
