import { useState } from "react";
import { Image, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { PlayerHistory, PlayerSearchResult } from "@/lib/api";
import {
  MLB_PITCHER_COLS,
  MLB_PITCHER_SUMMARY,
  STAT_SUMMARY,
  STAT_TABLE_COLS,
} from "@/lib/statLookup";
import { FONT } from "@/components/ui";

// Data assembled in coach.tsx: the player-search hit (name/team/sport/headshot)
// merged with the real ESPN player-history payload, plus what the user asked
// about (requested stat columns / opponent / period intent).
export type PlayerStatCardData = {
  resolved: PlayerSearchResult;
  history: PlayerHistory;
  requestedStatCols?: string[] | null;
  opponentRequested?: string | null;
  periodRequested?: boolean;
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

export function PlayerStatCard({ data }: { data: PlayerStatCardData }) {
  const colors = useColors();
  const [imgFailed, setImgFailed] = useState(false);
  const { resolved, history } = data;
  const { name, team, sport, headshot } = resolved;
  const {
    labels = [],
    recent = [],
    vsOpponent = [],
    vsOpponentName,
    season,
    availableSeasons = [],
    seasonSummary: summary = { games: 0, averages: {}, totals: {} },
  } = history;
  const sportLabel = String(sport || "").toUpperCase();
  const opponentRequested = data.opponentRequested || null;
  const periodRequested = !!data.periodRequested;

  const initials = String(name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // MLB pitchers/hitters have different stat profiles — pick the pitcher set
  // when the log carries an "IP" column.
  const isPitcher = String(sport).toLowerCase() === "mlb" && labels.includes("IP");
  const tableColsSrc = isPitcher ? MLB_PITCHER_COLS : STAT_TABLE_COLS[sport] || [];
  const summarySrc = isPitcher ? MLB_PITCHER_SUMMARY : STAT_SUMMARY[sport] || [];
  const requestedCols = (data.requestedStatCols || []).filter((c) => labels.includes(c));

  // Recent-games table columns — float the requested stat to the FRONT.
  let cols = tableColsSrc.filter((c) => labels.includes(c));
  if (cols.length < 3) cols = labels.slice(0, 7);
  if (requestedCols.length) cols = [...requestedCols, ...cols.filter((c) => !requestedCols.includes(c))];
  cols = cols.slice(0, 7);

  // Season summary tiles — lead with the requested counting stat when real.
  let summaryCfg = summarySrc.filter(
    ([k, mode]) => (mode === "total" ? summary.totals : summary.averages)?.[k] != null,
  );
  for (const c of requestedCols.slice().reverse()) {
    if (!summaryCfg.some(([k]) => k === c) && summary.totals?.[c] != null) {
      summaryCfg = [[c, "total"], ...summaryCfg];
    }
  }
  summaryCfg = summaryCfg.slice(0, 4);
  const fmtNum = (v: number, mode: "avg" | "total") =>
    mode === "total" ? String(Math.round(Number(v))) : Number(v).toFixed(1);

  const cellWidth = 34;
  const showHeadshot = !!headshot && !imgFailed;

  const renderRow = (g: PlayerHistory["recent"][number], idx: number) => (
    <View
      key={g.eventId || idx}
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
        {g.isHome === false ? "@ " : g.isHome === true ? "vs " : ""}
        {oppShort(g.opponentName)}
      </Text>
      {cols.map((c) => (
        <Text
          key={c}
          style={{
            width: cellWidth,
            textAlign: "right",
            color: colors.foreground,
            fontFamily: FONT.medium,
            fontSize: 11,
            fontVariant: ["tabular-nums"],
          }}
        >
          {g.stats?.[c] ?? "—"}
        </Text>
      ))}
    </View>
  );

  const tableHeader = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 4 }}>
      <Text style={{ width: 46, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
        Date
      </Text>
      <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10 }}>
        Opp
      </Text>
      {cols.map((c) => (
        <Text
          key={c}
          style={{
            width: cellWidth,
            textAlign: "right",
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 10,
          }}
        >
          {c}
        </Text>
      ))}
    </View>
  );

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
          {showHeadshot && (
            <Image
              source={{ uri: headshot! }}
              onError={() => setImgFailed(true)}
              style={{ position: "absolute", width: 54, height: 54 }}
              resizeMode="cover"
            />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 17 }}>
            {name}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 1 }}>
            {[team, sportLabel].filter(Boolean).join(" · ")}
          </Text>
          <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 11, marginTop: 2 }}>
            {season ? `${season} season` : "Current season"}
            {summary.games ? ` · ${summary.games} GP` : ""}
          </Text>
        </View>
      </View>

      {/* Opponent meetings (this season) */}
      {opponentRequested ? (
        vsOpponent.length > 0 ? (
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ color: colors.primary, fontFamily: FONT.medium, fontSize: 10, marginBottom: 6 }}>
              VS {oppShort(vsOpponentName) || opponentRequested} · {season || "this season"} ·{" "}
              {vsOpponent.length} meeting{vsOpponent.length === 1 ? "" : "s"}
            </Text>
            {tableHeader}
            {vsOpponent.map(renderRow)}
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, marginTop: 6 }}>
              Real ESPN game-log lines from this season&apos;s head-to-head — full game log below.
            </Text>
          </View>
        ) : (
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: "rgba(245,158,11,0.10)",
            }}
          >
            <Text style={{ color: colors.warning, fontFamily: FONT.body, fontSize: 11, lineHeight: 16 }}>
              No game vs {opponentRequested} in ESPN&apos;s {season || "current-season"} log for {name}{" "}
              (they may not have met yet this season). The full game log is below.
            </Text>
          </View>
        )
      ) : null}

      {/* Period intent: ESPN game logs are full-game only — honest note. */}
      {periodRequested ? (
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
            ESPN&apos;s game log only has full-game totals — I can&apos;t break these down by quarter,
            half, or period. The numbers below are full-game, not a single-period split.
          </Text>
        </View>
      ) : null}

      {/* Season summary tiles */}
      {summaryCfg.length > 0 && (
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
          {summaryCfg.map(([k, mode], i) => (
            <View
              key={k}
              style={{
                flex: 1,
                paddingVertical: 12,
                alignItems: "center",
                borderLeftWidth: i === 0 ? 0 : 1,
                borderLeftColor: colors.border,
              }}
            >
              <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20, fontVariant: ["tabular-nums"] }}>
                {fmtNum((mode === "total" ? summary.totals : summary.averages)[k], mode)}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, marginTop: 2 }}>
                {k}
                {mode === "avg" ? "/G" : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent games table */}
      <View style={{ padding: 12 }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, marginBottom: 4 }}>
          LAST {Math.min(recent.length, 10)} GAMES{season ? ` · ${season}` : ""}
        </Text>
        {recent.length > 0 ? (
          <>
            {tableHeader}
            {recent.slice(0, 10).map(renderRow)}
          </>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
            No recent game log available from ESPN for this player.
          </Text>
        )}
        {availableSeasons.length > 1 && (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, marginTop: 8 }}>
            Other seasons available: {availableSeasons.slice(0, 8).join(", ")} — ask for any of them.
          </Text>
        )}
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, marginTop: 8, letterSpacing: 0.5 }}>
          REAL ESPN GAME LOG · NO PROJECTIONS
        </Text>
      </View>
    </View>
  );
}
