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
  { id: "tabletennis", label: "Table Tennis", short: "TT", icon: "table-tennis" },
  { id: "nfl", label: "NFL", short: "NFL", icon: "football" },
  { id: "ncaaf", label: "CFB", short: "CFB", icon: "football" },
  { id: "ncaab", label: "CBB", short: "CBB", icon: "basketball" },
];

// The AI Coach pulls its parlay pool from EVERY sport the app surfaces — not a
// hand-picked subset — so NFL, college football/basketball, UFC and tennis legs
// are eligible too. This is safe because cost is bounded by the live window, not
// the raw game count: the context build keeps only in-progress + next-48h games
// (isPickable), the odds route caps per-event alt/period fetches at 12 within-48h
// events per sport, and everything is cached ~5 min. Off-season leagues simply
// come back empty through the same window filter — we never fabricate fixtures.
export const DEFAULT_SPORTS = SPORTS.map((s) => s.id);

export function sportLabel(id: string): string {
  return SPORTS.find((s) => s.id === id)?.label ?? id.toUpperCase();
}
