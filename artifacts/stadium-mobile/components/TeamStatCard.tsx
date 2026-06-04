import { useState } from "react";
import { Image, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { TeamHistory, TeamSearchResult } from "@/lib/api";
import { FONT } from "@/components/ui";

// Data assembled in coach.tsx: the team-search hit (name/logo/sport) merged
// with the real ESPN team-history payload. Every number shown is derived from
// real ESPN final scores — nothing is fabricated.
export type TeamStatCardData = {
  resolved: TeamSearchResult;
  history: TeamHistory;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
};

const oppShort = (n: string | null) => {
  if (!n) return "";
  const w = String(n).trim().split(" ");
  return w[w.length - 1];
};

const fmt1 = (v: number | null) => (v == null ? "—" : Number(v).toFixed(1));

export function TeamStatCard({ data }: { data: TeamStatCardData }) {
  const colors = useColors();
  const [imgFailed, setImgFailed] = useState(false);
  const { resolved, history } = data;
  const { name, logo, sport } = resolved;
  const { last10, streak, record, recent = [], season } = history;
  const sportLabel = String(sport || "").toUpperCase();

  const initials = String(name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const showLogo = !!logo && !imgFailed;

  // Headline tiles — last-10 form. Only real, derived figures (record, points
  // for/against averages over the games that have final scores).
  const tiles: { value: string; label: string }[] = [
    { value: last10.games ? `${last10.wins}-${last10.losses}` : "—", label: "L10 REC" },
    { value: fmt1(last10.ptsFor), label: "PTS/G" },
    { value: fmt1(last10.ptsAgainst), label: "OPP/G" },
    {
      value:
        last10.avgMargin == null
          ? "—"
          : `${last10.avgMargin > 0 ? "+" : ""}${last10.avgMargin.toFixed(1)}`,
      label: "MARGIN",
    },
  ];

  const renderRow = (g: TeamHistory["recent"][number], idx: number) => {
    const wl = g.won === true ? "W" : g.won === false ? "L" : "—";
    const wlColor =
      g.won === true ? colors.success : g.won === false ? colors.destructive : colors.mutedForeground;
    return (
      <View
        key={`${g.date}-${idx}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingVertical: 7,
        }}
      >
        <Text style={{ width: 46, color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
          {fmtDate(g.date)}
        </Text>
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: colors.foreground, fontFamily: FONT.body, fontSize: 11 }}
        >
          {g.home ? "vs " : "@ "}
          {oppShort(g.opp)}
        </Text>
        <Text
          style={{
            width: 70,
            textAlign: "right",
            color: colors.foreground,
            fontFamily: FONT.medium,
            fontSize: 11,
            fontVariant: ["tabular-nums"],
          }}
        >
          {g.pts == null || g.oppPts == null ? "—" : `${g.pts}-${g.oppPts}`}
        </Text>
        <Text
          style={{
            width: 22,
            textAlign: "right",
            color: wlColor,
            fontFamily: FONT.medium,
            fontSize: 11,
          }}
        >
          {wl}
        </Text>
      </View>
    );
  };

  return (
    <View
      style={{
        borderRadius: colors.radius,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            backgroundColor: colors.muted,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderWidth: 2,
            borderColor: colors.primary,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.display, fontSize: 14 }}>
            {initials}
          </Text>
          {showLogo && (
            <Image
              source={{ uri: logo! }}
              onError={() => setImgFailed(true)}
              style={{ position: "absolute", width: 40, height: 40 }}
              resizeMode="contain"
            />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 17 }}>
            {history.teamName || name}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 1 }}>
            {sportLabel}
            {record.games ? ` · ${record.wins}-${record.losses} (last ${record.games})` : ""}
          </Text>
          <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 11, marginTop: 2 }}>
            {streak ? `${streak.type}${streak.count} streak` : "Recent form"}
            {season ? ` · ${season} season` : ""}
          </Text>
        </View>
      </View>

      {/* Off-season note: numbers are last season's real results. */}
      {season ? (
        <View
          style={{
            paddingHorizontal: 14,
            paddingVertical: 9,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: "rgba(245,158,11,0.10)",
          }}
        >
          <Text style={{ color: colors.warning, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
            No games this season yet — showing real results from the {season} season.
          </Text>
        </View>
      ) : null}

      {/* Form tiles */}
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {tiles.map((t, i) => (
          <View
            key={t.label}
            style={{
              flex: 1,
              paddingVertical: 12,
              alignItems: "center",
              borderLeftWidth: i === 0 ? 0 : 1,
              borderLeftColor: colors.border,
            }}
          >
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18, fontVariant: ["tabular-nums"] }}>
              {t.value}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, marginTop: 2 }}>
              {t.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Recent games */}
      <View style={{ padding: 12 }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, marginBottom: 4 }}>
          LAST {Math.min(recent.length, 10)} GAMES
        </Text>
        {recent.length > 0 ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 4 }}>
              <Text style={{ width: 46, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
                Date
              </Text>
              <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
                Opp
              </Text>
              <Text style={{ width: 70, textAlign: "right", color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
                Score
              </Text>
              <Text style={{ width: 22, textAlign: "right", color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
                
              </Text>
            </View>
            {recent.slice(0, 10).map(renderRow)}
          </>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
            No recent completed games available from ESPN for this team.
          </Text>
        )}
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, marginTop: 8, letterSpacing: 0.5 }}>
          REAL ESPN RESULTS · NO PROJECTIONS
        </Text>
      </View>
    </View>
  );
}
