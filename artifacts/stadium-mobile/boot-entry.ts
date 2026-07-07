// Register odds selector compat before any route modules — stale OTAs may call getOddsSelector.
import { installOddsSelectorCompat } from "@/lib/oddsQuerySelectors";
import "@/lib/homeFeedQueries";
import "@/lib/browseOddsQueries";

installOddsSelectorCompat();

void (async () => {
  const { applyPreBootOtaIfNeeded } = await import("@/lib/preBootOta");
  await applyPreBootOtaIfNeeded();
  await import("expo-router/entry");
})();
