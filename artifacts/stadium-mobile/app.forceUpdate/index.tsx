/**
 * Expo Router requires an index route. The force-update root layout already
 * paints the full-screen gate; this route is intentionally empty.
 */
import { View } from "react-native";

export default function ForceUpdateIndex() {
  return <View style={{ flex: 1, backgroundColor: "#0f172a" }} />;
}
