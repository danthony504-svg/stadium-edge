import { OtaUpdateBanner } from "@/components/OtaUpdateBanner";
import { useOtaController } from "@/lib/ota";

/**
 * Sole production owner of OTA update behavior.
 * Loaded only via DeferredOtaRuntime after first paint.
 *
 * Does NOT use the legacy updater hook / recovery / auto-reload stack.
 *
 * Normal production users do not see the blue update banner — background
 * check/download may still run. Set EXPO_PUBLIC_OTA_USER_BANNER=true (or
 * __DEV__) to show Restart UI. reloadAsync remains explicit-only.
 */
function otaUserBannerEnabled(): boolean {
  if (typeof __DEV__ !== "undefined" && __DEV__) return true;
  return (process.env.EXPO_PUBLIC_OTA_USER_BANNER ?? "").trim() === "true";
}

export default function OtaRuntime() {
  const { snapshot, restart } = useOtaController(true);

  if (!otaUserBannerEnabled()) {
    return null;
  }

  return (
    <OtaUpdateBanner
      snapshot={snapshot}
      onRestart={() => {
        void restart();
      }}
    />
  );
}
