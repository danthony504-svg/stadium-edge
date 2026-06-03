import type { ComponentProps } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";

type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export type Sport = {
  id: string;
  label: string;
  short: string;
  icon: MCIName;
};

// The sports the app surfaces. The API returns only what's actually live, so
// off-season leagues simply come back empty — we never fabricate fixtures.
export const SPORTS: Sport[] = [
  { id: "mlb", label: "MLB", short: "MLB", icon: "baseball" },
  { id: "wnba", label: "WNBA", short: "WNBA", icon: "basketball" },
  { id: "nba", label: "NBA", short: "NBA", icon: "basketball" },
  { id: "nhl", label: "NHL", short: "NHL", icon: "hockey-puck" },
  { id: "soccer", label: "Soccer", short: "SOC", icon: "soccer" },
  { id: "ufc", label: "UFC", short: "UFC", icon: "mixed-martial-arts" },
  { id: "tennis", label: "Tennis", short: "TEN", icon: "tennis" },
  { id: "nfl", label: "NFL", short: "NFL", icon: "football" },
  { id: "ncaaf", label: "CFB", short: "CFB", icon: "football" },
  { id: "ncaab", label: "CBB", short: "CBB", icon: "basketball" },
];

export const DEFAULT_SPORTS = ["mlb", "wnba", "nba", "nhl", "soccer"];

export function sportLabel(id: string): string {
  return SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();
}
