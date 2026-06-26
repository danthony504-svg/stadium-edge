import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge, Card, FONT, Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getParkWeather, type ParkWeatherReport } from "@/lib/api";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type TabKey = "today" | "tomorrow" | "outlook";

// Auto-refresh cadence — within the 10–15 min window the feature calls for. The
// server caches each park's OpenWeather reading for ~10–12 min, so this lines up
// with fresh upstream data without hammering the API.
const REFETCH_MS = 12 * 60 * 1000;

// Map the deterministic, calc-only impact rating to a theme colour. Order runs
// from best to worst; anything unexpected falls back to a neutral tone.
function ratingTone(rating: string, colors: ReturnType<typeof useColors>) {
  switch (rating) {
    case "Very Favorable":
    case "Favorable":
      return colors.success;
    case "Unfavorable":
      return "#f59e0b"; // amber-500
    case "Very Unfavorable":
      return colors.live;
    default:
      return colors.primary; // Neutral
  }
}

function fmtFirstPitch(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Format a possibly-null reading. We NEVER substitute a fabricated value: when
// OpenWeather omitted the field we show "Not reported" instead of guessing.
function fmtVal(v: number | null, fmt: (n: number) => string): string {
  return v != null ? fmt(v) : "Not reported";
}

export default function WeatherScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("today");

  const q = useQuery({
    queryKey: ["parkWeather", "mlb"],
    queryFn: ({ signal }) => getParkWeather("mlb", signal),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: REFETCH_MS,
  });

  const reports = q.data ?? [];
  const selected = useMemo<ParkWeatherReport | undefined>(
    () => reports.find((r) => r.gameId === selectedId) ?? reports[0],
    [reports, selectedId],
  );

  const lastUpdated = q.dataUpdatedAt
    ? new Date(q.dataUpdatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Fixed header — logo + screen title, pinned above the scroll view. */}
      <View style={{ paddingTop: insets.top + 6, backgroundColor: colors.background }}>
        <View style={{ paddingHorizontal: 16, marginBottom: 4, alignItems: "center" }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: "100%", height: 110, marginTop: -8 }}
            resizeMode="contain"
            fadeDuration={0}
            accessibilityLabel="Stadium Edge"
          />
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="cloud-drizzle" size={20} color={colors.primary} />
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
              Park Weather Report
            </Text>
          </View>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.body,
              fontSize: 13,
              marginTop: 2,
            }}
          >
            Real OpenWeather conditions for today&apos;s MLB ballparks
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching && !q.isLoading}
            onRefresh={() => q.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {q.isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center", gap: 12 }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
              Loading live park conditions…
            </Text>
          </View>
        ) : q.isError ? (
          <Card>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
              Couldn&apos;t load weather
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.body,
                fontSize: 13,
                marginTop: 4,
              }}
            >
              The live weather feed is unavailable right now. Pull to refresh to try again.
            </Text>
            <Pressable
              onPress={() => q.refetch()}
              style={({ pressed }) => ({
                marginTop: 12,
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 999,
                backgroundColor: "rgba(59,130,246,0.12)",
                borderWidth: 1,
                borderColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Feather name="refresh-cw" size={14} color={colors.primary} />
              <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>
                Retry
              </Text>
            </Pressable>
          </Card>
        ) : reports.length === 0 ? (
          <Card>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
              No MLB games today
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.body,
                fontSize: 13,
                marginTop: 4,
              }}
            >
              There are no MLB games on today&apos;s slate with a known ballpark, so there&apos;s no
              park weather to show right now.
            </Text>
          </Card>
        ) : (
          <>
            {/* Park selector — one chip per game on today's slate. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
              style={{ marginBottom: 14 }}
            >
              {reports.map((r) => (
                <Pill
                  key={r.gameId}
                  label={`${r.awayAbbr} @ ${r.homeAbbr}`}
                  active={selected?.gameId === r.gameId}
                  onPress={() => setSelectedId(r.gameId)}
                />
              ))}
            </ScrollView>

            {selected && (
              <>
                {/* Game header line */}
                <View style={{ marginBottom: 12 }}>
                  <Text
                    style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16 }}
                  >
                    {selected.awayTeam} @ {selected.homeTeam}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: FONT.body,
                      fontSize: 13,
                      marginTop: 2,
                    }}
                  >
                    {selected.parkName} · {selected.city}
                    {fmtFirstPitch(selected.commenceTime)
                      ? ` · First pitch ${fmtFirstPitch(selected.commenceTime)}`
                      : ""}
                  </Text>
                </View>

                {/* AI Weather Impact — deterministic rating computed from real values. */}
                <ImpactCard report={selected} colors={colors} />

                {/* Today / Tomorrow / Outlook tabs */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 16, marginBottom: 12 }}>
                  <TabPill label="Today" active={tab === "today"} onPress={() => setTab("today")} />
                  <TabPill
                    label="Tomorrow"
                    active={tab === "tomorrow"}
                    onPress={() => setTab("tomorrow")}
                  />
                  <TabPill
                    label="3-Day Outlook"
                    active={tab === "outlook"}
                    onPress={() => setTab("outlook")}
                  />
                </View>

                {tab === "today" && <TodayConditions report={selected} colors={colors} />}
                {tab === "tomorrow" && <TomorrowForecast report={selected} colors={colors} />}
                {tab === "outlook" && <OutlookForecast report={selected} colors={colors} />}
              </>
            )}

            {/* Today's games quick list */}
            <Text
              style={{
                color: colors.foreground,
                fontFamily: FONT.semibold,
                fontSize: 15,
                marginTop: 22,
                marginBottom: 10,
              }}
            >
              Today&apos;s Games
            </Text>
            {reports.map((r) => {
              const tone = ratingTone(r.impact.rating, colors);
              const active = selected?.gameId === r.gameId;
              return (
                <Pressable
                  key={r.gameId}
                  onPress={() => setSelectedId(r.gameId)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 8 })}
                >
                  <Card
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text
                        style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}
                      >
                        {r.awayAbbr} @ {r.homeAbbr}
                      </Text>
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: FONT.body,
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {[
                          r.parkName,
                          r.current.tempF != null ? `${Math.round(r.current.tempF)}°F` : null,
                          r.current.condition,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 9,
                        paddingVertical: 5,
                        borderRadius: 8,
                        backgroundColor: tone + "22",
                      }}
                    >
                      <Text style={{ color: tone, fontFamily: FONT.bold, fontSize: 11 }}>
                        {r.impact.rating}
                      </Text>
                    </View>
                  </Card>
                </Pressable>
              );
            })}

            {/* Provenance + auto-update note */}
            <View style={{ marginTop: 16, alignItems: "center", gap: 2 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                Live data from OpenWeather · auto-updates every ~12 min
              </Text>
              {lastUpdated && (
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                  Last updated {lastUpdated}
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function TabPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? "rgba(59,130,246,0.12)" : colors.card,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: active ? colors.primary : colors.mutedForeground,
          fontFamily: active ? FONT.bold : FONT.medium,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ImpactCard({
  report,
  colors,
}: {
  report: ParkWeatherReport;
  colors: ReturnType<typeof useColors>;
}) {
  const tone = ratingTone(report.impact.rating, colors);
  return (
    <Card style={{ borderColor: tone + "55" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Feather name="activity" size={16} color={tone} />
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.bold,
            fontSize: 11,
            letterSpacing: 0.6,
          }}
        >
          AI WEATHER IMPACT
        </Text>
      </View>
      <View
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 8,
          backgroundColor: tone + "22",
          marginBottom: 10,
        }}
      >
        <Text style={{ color: tone, fontFamily: FONT.display, fontSize: 18 }}>
          {report.impact.rating}
        </Text>
      </View>
      <Text
        style={{ color: colors.foreground, fontFamily: FONT.body, fontSize: 14, lineHeight: 20 }}
      >
        {report.impact.summary}
      </Text>
      {report.climateControlled && (
        <View style={{ marginTop: 10 }}>
          <Badge label="ROOF / CLIMATE CONTROLLED" tone="muted" />
        </View>
      )}
    </Card>
  );
}

function StatTile({
  label,
  value,
  icon,
  colors,
}: {
  label: string;
  value: string;
  icon: FeatherName;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        width: "48%",
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Feather name={icon} size={13} color={colors.mutedForeground} />
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 11,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 18 }}>
        {value}
      </Text>
    </View>
  );
}

function TodayConditions({
  report,
  colors,
}: {
  report: ParkWeatherReport;
  colors: ReturnType<typeof useColors>;
}) {
  const c = report.current;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
        {c.condition ? `Current Conditions — ${c.condition}` : "Current Conditions"}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <StatTile label="TEMPERATURE" value={fmtVal(c.tempF, (n) => `${Math.round(n)}°F`)} icon="thermometer" colors={colors} />
        <StatTile label="FEELS LIKE" value={fmtVal(c.feelsLikeF, (n) => `${Math.round(n)}°F`)} icon="thermometer" colors={colors} />
        <StatTile label="WIND SPEED" value={fmtVal(c.windMph, (n) => `${Math.round(n)} mph`)} icon="wind" colors={colors} />
        <StatTile
          label="WIND DIRECTION"
          value={
            c.windDir != null && c.windDeg != null
              ? `${c.windDir} · ${Math.round(c.windDeg)}°`
              : "Not reported"
          }
          icon="compass"
          colors={colors}
        />
        <StatTile label="GUSTS" value={fmtVal(c.gustMph, (n) => `${Math.round(n)} mph`)} icon="wind" colors={colors} />
        <StatTile label="HUMIDITY" value={fmtVal(c.humidity, (n) => `${n}%`)} icon="droplet" colors={colors} />
        <StatTile label="PRESSURE" value={fmtVal(c.pressureInHg, (n) => `${n.toFixed(2)} inHg`)} icon="bar-chart-2" colors={colors} />
        <StatTile label="CLOUD COVER" value={fmtVal(c.cloudCoverPct, (n) => `${n}%`)} icon="cloud" colors={colors} />
        <StatTile label="PRECIP CHANCE" value={fmtVal(c.precipChancePct, (n) => `${n}%`)} icon="cloud-rain" colors={colors} />
      </View>
    </View>
  );
}

function ForecastRow({
  day,
  colors,
}: {
  day: ParkWeatherReport["forecast"][number];
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Card
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
      }}
    >
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
          {day.label}
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.body,
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {[
            day.condition,
            day.precipChancePct != null ? `${day.precipChancePct}% precip` : null,
            day.windMph != null ? `${Math.round(day.windMph)} mph wind` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Limited forecast data"}
        </Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
        {Math.round(day.hiF)}° / {Math.round(day.loF)}°
      </Text>
    </Card>
  );
}

function TomorrowForecast({
  report,
  colors,
}: {
  report: ParkWeatherReport;
  colors: ReturnType<typeof useColors>;
}) {
  const day = report.forecast.find((d) => d.label === "Tomorrow");
  if (!day) {
    return (
      <Card>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          Tomorrow&apos;s forecast isn&apos;t available from the feed yet.
        </Text>
      </Card>
    );
  }
  return <ForecastRow day={day} colors={colors} />;
}

function OutlookForecast({
  report,
  colors,
}: {
  report: ParkWeatherReport;
  colors: ReturnType<typeof useColors>;
}) {
  // Skip "Today"; show the next available days (the feed returns up to ~5).
  const days = report.forecast.filter((d) => d.label !== "Today").slice(0, 3);
  if (days.length === 0) {
    return (
      <Card>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          A multi-day outlook isn&apos;t available from the feed right now.
        </Text>
      </Card>
    );
  }
  return (
    <View>
      {days.map((d) => (
        <ForecastRow key={d.date} day={d} colors={colors} />
      ))}
    </View>
  );
}
