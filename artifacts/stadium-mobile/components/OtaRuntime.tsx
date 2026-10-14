import { OtaUpdateBanner } from "@/components/OtaUpdateBanner";
import { useOtaController } from "@/lib/ota";

/**
 * Sole production owner of OTA update behavior.
 * Loaded only via DeferredOtaRuntime after first paint.
 *
 * Does NOT use the legacy updater hook / recovery / auto-reload stack.
 *
 * Recovery default: show Restart banner in production unless explicitly
 * disabled with EXPO_PUBLIC_OTA_USER_BANNER=false. Build 78 apply loops need
 * a visible Restart path; reloadAsync remains explicit-only.
 */
function otaUserBannerEnabled(): boolean {
  if (typeof __DEV__ !== "undefined" && __DEV__) return true;
  const raw = (process.env.EXPO_PUBLIC_OTA_USER_BANNER ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
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
