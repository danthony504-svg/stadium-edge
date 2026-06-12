import { useMemo } from "react";
import { ScrollView } from "react-native";

import { Pill } from "@/components/ui";
import { PROPS_SPORTS } from "@/lib/api";
import { SPORTS } from "@/lib/sports";

// Leagues shown as browse-only pills (no prop feed — moneyline matches list).
// Kept here so the pill row is a single source of truth for both the Props tab
// and the Golf board (which reuses this row for switching between surfaces).
export const BROWSE_ONLY_SPORTS = ["tennis"];

export const PILL_SPORT_IDS = [...PROPS_SPORTS, ...BROWSE_ONLY_SPORTS];

export function isPillSport(id: string): boolean {
  return PILL_SPORT_IDS.includes(id);
}

// Golf is deliberately NOT a member of SPORTS (it would break odds/coach/arb/
// validators), so it is surfaced as a standalone pill that navigates to the
// dedicated /golf board instead of selecting an in-page sport.
export function SportPills({
  activeId,
  onSelectSport,
  onSelectGolf,
}: {
  activeId: string | null;
  onSelectSport: (id: string) => void;
  onSelectGolf: () => void;
}) {
  const pillSports = useMemo(
    () => SPORTS.filter((s) => PROPS_SPORTS.includes(s.id) || BROWSE_ONLY_SPORTS.includes(s.id)),
    [],
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}
    >
      {pillSports.map((s) => (
        <Pill key={s.id} label={s.label} active={activeId === s.id} onPress={() => onSelectSport(s.id)} />
      ))}
      <Pill label="Golf" active={activeId === "golf"} onPress={onSelectGolf} />
    </ScrollView>
  );
}
