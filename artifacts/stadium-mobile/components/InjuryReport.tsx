import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getInjuries } from "@/lib/api";
import {
  friendlyInjury,
  injuriesForMatchup,
  injuryEdge,
  injuryImpact,
  summarizeTeamInjuries,
  type InjuryImpactTier,
} from "@/lib/injuries";

// A real-data injury report card, reused on the game-detail page (both teams,
// with an injury edge) and on the player-prop page (the single opponent the
// player is facing). Every player, status, and description comes straight from
// ESPN's injury feed — nothing is fabricated. "Impact" is the same deterministic
// severity × position guide used elsewhere, never a player rating, and we never
// invent who replaces an injured player (ESPN doesn't publish that).
export function InjuryReport({
  sport,
  teams,
  title = "INJURY REPORT",
  caption,
  framing = "matchup",
}: {
  sport: string;
  // One or two team names (from the odds feed). Two → shows the injury edge.
  teams: string[];
  title?: string;
  // Optional plain-English lead-in shown under the title.
  caption?: string;
  framing?: "matchup" | "facing";
}) {
  const colors = useColors();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const impactColor = (tier: InjuryImpactTier): string =>
    tier === "high"
      ? colors.destructive
      : tier === "med"
        ? "#f97316"
        : tier === "low"
          ? colors.warning
          : colors.success;
  const impactLabel = (tier: InjuryImpactTier): string =>
    tier === "high"
      ? "High impact"
      : tier === "med"
        ? "Med impact"
        : tier === "low"
          ? "Low impact"
          : "Minimal";

  const injuriesQ = useQuery({
    queryKey: ["injuries", sport],
    enabled: !!sport,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getInjuries(sport, signal),
  });

  const wantedTeams = useMemo(() => teams.filter((t) => t && t.trim()), [teams]);
  const matchupInjuries = useMemo(
    () => injuriesForMatchup(injuriesQ.data, wantedTeams),
    [injuriesQ.data, wantedTeams],
  );
  const summaries = useMemo(
    () => matchupInjuries.map((t) => summarizeTeamInjuries(sport, t)),
    [matchupInjuries, sport],
  );
  const edge = useMemo(() => injuryEdge(summaries), [summaries]);

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        padding: 14,
        gap: 12,
      }}
    >
      <View style={{ gap: 4 }}>
        <Text
          style={{
            color: colors.foreground,
            fontFamily: FONT.bold,
            fontSize: 12,
            letterSpacing: 0.6,
          }}
        >
          {title}
        </Text>
        {caption ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
            {caption}
          </Text>
        ) : null}
      </View>

      {injuriesQ.isLoading ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          Checking the ESPN injury report…
        </Text>
      ) : matchupInjuries.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
          {injuriesQ.isError
            ? "Couldn't reach the ESPN injury report."
            : framing === "facing"
              ? "No injuries reported for the opponent."
              : "No injuries reported for either side."}
        </Text>
      ) : (
        <View style={{ gap: 14 }}>
          {/* Injury edge — only meaningful with both sides resolved. */}
          {matchupInjuries.length === 2 ? (
            <View
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                padding: 12,
                gap: 6,
              }}
            >
              <Text
                style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6 }}
              >
                INJURY EDGE
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: edge.kind === "advantage" ? colors.success : colors.mutedForeground,
                  }}
                />
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
                  {edge.kind === "advantage" ? `Advantage: ${edge.team}` : "Even — minimal injury edge"}
                </Text>
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
                {(() => {
                  if (edge.kind !== "advantage") return "Both sides have comparable injury impact.";
                  const oppHigh = summaries.find((s) => s.team === edge.opp)?.highCount ?? 0;
                  const ownHigh = summaries.find((s) => s.team === edge.team)?.highCount ?? 0;
                  // Only cite high-impact counts when they differ — the edge is
                  // total-impact-driven, so equal high-counts would read wrong.
                  return oppHigh > ownHigh
                    ? `${edge.opp} is more banged up (${oppHigh} high-impact vs ${ownHigh}), which tilts this game toward ${edge.team}.`
                    : `${edge.opp} carries more total injury impact across the roster, tilting this game toward ${edge.team}.`;
                })()}
              </Text>
            </View>
          ) : null}

          {matchupInjuries.map((t) => {
            const summary = summaries.find((s) => s.team === t.team);
            const sorted = [...t.entries].sort(
              (a, b) => injuryImpact(sport, b).score - injuryImpact(sport, a).score,
            );
            const isOpen = !!open[t.team];
            const shown = isOpen ? sorted : sorted.slice(0, 6);
            return (
              <View key={t.team} style={{ gap: 6 }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.3 }}>
                  {t.team} · {t.entries.length}
                </Text>
                {summary && summary.groups.length > 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
                    {summary.groups.map((g) => `${g.group} ${g.count}`).join("  ·  ")}
                  </Text>
                ) : null}
                {shown.map((e, i) => {
                  const { tier } = injuryImpact(sport, e);
                  const c = impactColor(tier);
                  const friendly = friendlyInjury(e.status);
                  // ESPN's own description ("what injury") — skip generic
                  // boilerplate so we never show a meaningless "No description".
                  const desc =
                    e.description && !/^no description$/i.test(e.description.trim())
                      ? e.description.trim()
                      : null;
                  return (
                    <View key={`${e.player}-${i}`} style={{ gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
                        <Text
                          style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 12, flex: 1 }}
                          numberOfLines={1}
                        >
                          {e.player}
                          {e.position ? ` (${e.position})` : ""}
                        </Text>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: c, fontFamily: FONT.bold, fontSize: 11 }}>{friendly.label}</Text>
                          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9 }}>
                            {impactLabel(tier)}
                          </Text>
                        </View>
                      </View>
                      {desc ? (
                        <Text
                          style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, lineHeight: 14, marginLeft: 15 }}
                          numberOfLines={2}
                        >
                          {desc}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
                {t.entries.length > 6 ? (
                  <Pressable
                    onPress={() => setOpen((prev) => ({ ...prev, [t.team]: !prev[t.team] }))}
                    hitSlop={6}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 2 }}
                  >
                    <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 11 }}>
                      {isOpen ? "Show less" : `View all ${t.entries.length} injuries`}
                    </Text>
                    <Feather name={isOpen ? "chevron-up" : "arrow-right"} size={12} color={colors.primary} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9, lineHeight: 13 }}>
            Impact = ESPN injury severity + position — a quick betting guide, not a player rating.
            {framing === "facing" ? " Who replaces an injured player isn't published, so we don't show a substitute." : ""}
          </Text>
        </View>
      )}
    </View>
  );
}
