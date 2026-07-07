// Register odds selector compat before any route modules — stale OTAs may call getOddsSelector.
import { installOddsSelectorCompat } from "@/lib/oddsQuerySelectors";
import "@/lib/homeFeedQueries";
import "@/lib/browseOddsQueries";

installOddsSelectorCompat();

import "expo-router/entry";
