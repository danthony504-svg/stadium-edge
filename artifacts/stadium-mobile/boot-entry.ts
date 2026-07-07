// Load odds query compat before any route modules — stale OTAs may import this path.
import "@/lib/oddsQuerySelectors";

import "expo-router/entry";
