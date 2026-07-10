import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader, PageTitleRow } from "@/components/AppHeader";
import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getParkWeather, type ParkWeatherReport } from "@/lib/api";
import {
  conditionIconName,
  gameWeatherEffects,
  impactBannerCopy,
  impactLevelLabel,
  impactLevelTone,
  precipDisplay,
  shortImpactBadge,
  windDisplay,
  type GameEffectCard,
  type ImpactLevel,
} from "@/lib/parkWeatherUi";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type TabKey = "today" | "tomorrow" | "outlook";

const REFETCH_MS = 12 * 60 * 1000;

function impactColors(level: ImpactLevel, colors: ReturnType<typeof useColors>) {
  if (level === "positive") return { border: colors.success, bg: "rgba(34,197,94,0.12)", text: colors.success };
  if (level === "negative") return { border: "#f59e0b", bg: "rgba(245,158,11,0.12)", text: "#f59e0b" };
  return { border: colors.primary, bg: "rgba(59,130,246,0.1)", text: colors.primary };
}

function trendColors(trend: GameEffectCard["trend"], colors: ReturnType<typeof useColors>) {
  if (trend === "INCREASED") return colors.success;
  if (trend === "DECREASED") return colors.live;
  return colors.mutedForeground;
}

function fmtVal(v: number | null, fmt: (n: number) => string): string {
  return v != null ? fmt(v) : "—";
}

function fmtFirstPitch(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function WeatherScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("today");
  const [venueOpen, setVenueOpen] = useState(false);

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader bottomGap={0}>
        <PageTitleRow
          icon="cloud-drizzle"
          title="Park Weather Report"
          subtitle="Real-time weather impact for today's games"
        />
      </AppHeader>

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
          <ErrorCard onRetry={() => q.refetch()} />
        ) : reports.length === 0 ? (
          <Card>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
              No MLB games today
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, marginTop: 4 }}>
              There are no MLB games on today&apos;s slate with a known ballpark right now.
            </Text>
          </Card>
        ) : (
          <>
            <TabRow tab={tab} onTab={setTab} />

            {selected && (
              <>
                <VenueSelector
                  report={selected}
                  reports={reports}
                  open={venueOpen}
                  onToggle={() => setVenueOpen((v) => !v)}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setVenueOpen(false);
                  }}
                />

                {tab === "today" && (
                  <>
                    <HeroWeatherCard report={selected} />
                    <ImpactBanner report={selected} />
                    <SectionTitle>Detailed Conditions</SectionTitle>
                    <DetailGrid report={selected} />
                    <SectionTitle>How This Affects The Game</SectionTitle>
                    <GameEffectsGrid report={selected} />
                  </>
                )}

                {tab === "tomorrow" && <TomorrowPanel report={selected} />}
                {tab === "outlook" && <OutlookPanel report={selected} />}
              </>
            )}

            <SectionTitle style={{ marginTop: 22 }}>Today&apos;s Games</SectionTitle>
            {reports.map((r) => (
              <GameListRow
                key={r.gameId}
                report={r}
                active={selected?.gameId === r.gameId}
                onPress={() => {
                  setSelectedId(r.gameId);
                  setTab("today");
                  setVenueOpen(false);
                }}
              />
            ))}

            <View style={{ marginTop: 18, alignItems: "center", gap: 4 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                Weather updates every 15 minutes
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
                Weather powered by OpenWeather
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ children, style }: { children: string; style?: object }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.foreground,
        fontFamily: FONT.semibold,
        fontSize: 15,
        marginTop: 18,
        marginBottom: 10,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

function TabRow({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
  const items: { id: TabKey; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "outlook", label: "5-Day Outlook" },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
      {items.map((item) => (
        <TabPill key={item.id} label={item.label} active={tab === item.id} onPress={() => onTab(item.id)} />
      ))}
    </View>
  );
}

function TabPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? "rgba(59,130,246,0.14)" : colors.card,
        alignItems: "center",
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

function VenueSelector({
  report,
  reports,
  open,
  onToggle,
  onSelect,
}: {
  report: ParkWeatherReport;
  reports: ParkWeatherReport[];
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => ({
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: "rgba(59,130,246,0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="map-pin" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
            {report.parkName}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
            {report.city}
            {fmtFirstPitch(report.commenceTime) ? ` · ${report.awayAbbr} @ ${report.homeAbbr}` : ""}
          </Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        <View
          style={{
            marginTop: 8,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {reports.map((r, i) => (
            <Pressable
              key={r.gameId}
              onPress={() => onSelect(r.gameId)}
              style={({ pressed }) => ({
                padding: 12,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: report.gameId === r.gameId ? "rgba(59,130,246,0.08)" : "transparent",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                {r.parkName}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>
                {r.awayAbbr} @ {r.homeAbbr} · {r.city}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HeroWeatherCard({ report }: { report: ParkWeatherReport }) {
  const colors = useColors();
  const c = report.current;
  const icon = conditionIconName(c.condition);
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 48, lineHeight: 52 }}>
            {fmtVal(c.tempF, (n) => `${Math.round(n)}°F`)}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, marginTop: 2 }}>
            Feels like {fmtVal(c.feelsLikeF, (n) => `${Math.round(n)}°F`)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Feather name={icon} size={36} color={colors.primary} />
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            {c.condition ?? "Conditions"}
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          marginTop: 16,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <HeroStat label="Wind" value={windDisplay(c)} />
        <HeroStat label="Humidity" value={fmtVal(c.humidity, (n) => `${n}%`)} />
        <HeroStat label="Precip" value={precipDisplay(c)} />
      </View>
    </Card>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Text>
      <Text
        style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13, marginTop: 4 }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function ImpactBanner({ report }: { report: ParkWeatherReport }) {
  const colors = useColors();
  const level = impactLevelTone(report.impact.rating);
  const theme = impactColors(level, colors);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.bg,
        borderRadius: 14,
        padding: 14,
        marginBottom: 4,
      }}
    >
      <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.5 }}>
        TODAY&apos;S IMPACT: {impactLevelLabel(report.impact.rating)}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.body,
          fontSize: 14,
          lineHeight: 20,
          marginTop: 8,
        }}
      >
        {impactBannerCopy(report.impact.rating, report.climateControlled)}
      </Text>
    </View>
  );
}

function DetailGrid({ report }: { report: ParkWeatherReport }) {
  const colors = useColors();
  const c = report.current;
  const tiles = [
    { label: "Temp", value: fmtVal(c.tempF, (n) => `${Math.round(n)}°F`), icon: "thermometer" as FeatherName },
    { label: "Feels Like", value: fmtVal(c.feelsLikeF, (n) => `${Math.round(n)}°F`), icon: "thermometer" },
    { label: "Wind", value: windDisplay(c), icon: "wind" },
    { label: "Gusts", value: fmtVal(c.gustMph, (n) => `${Math.round(n)} mph`), icon: "wind" },
    { label: "Humidity", value: fmtVal(c.humidity, (n) => `${n}%`), icon: "droplet" },
    { label: "Pressure", value: fmtVal(c.pressureInHg, (n) => `${n.toFixed(2)} in`), icon: "bar-chart-2" },
    { label: "Cloud Cover", value: fmtVal(c.cloudCoverPct, (n) => `${n}%`), icon: "cloud" },
    { label: "Precip Chance", value: fmtVal(c.precipChancePct, (n) => `${n}%`), icon: "cloud-rain" },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {tiles.map((t) => (
        <View
          key={t.label}
          style={{
            width: "48%",
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Feather name={t.icon} size={13} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>{t.label}</Text>
          </View>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 17 }}>{t.value}</Text>
        </View>
      ))}
    </View>
  );
}

function GameEffectsGrid({ report }: { report: ParkWeatherReport }) {
  const colors = useColors();
  const effects = gameWeatherEffects(report);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {effects.map((e) => (
        <GameEffectTile key={e.label} effect={e} />
      ))}
    </View>
  );
}

function GameEffectTile({ effect }: { effect: GameEffectCard }) {
  const colors = useColors();
  const tone = trendColors(effect.trend, colors);
  return (
    <View
      style={{
        width: "48%",
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>{effect.label}</Text>
      <Text style={{ color: tone, fontFamily: FONT.bold, fontSize: 13, marginTop: 6, letterSpacing: 0.3 }}>
        {effect.trend}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 4 }}>
        {effect.detail}
      </Text>
    </View>
  );
}

function GameListRow({
  report,
  active,
  onPress,
}: {
  report: ParkWeatherReport;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const c = report.current;
  const badge = shortImpactBadge(report.impact.rating);
  const badgeTone = impactLevelTone(report.impact.rating);
  const badgeColor = impactColors(badgeTone, colors).text;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 8 })}>
      <Card
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderColor: active ? colors.primary : colors.border,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
            {report.awayAbbr} @ {report.homeAbbr}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
            {fmtFirstPitch(report.commenceTime)}
            {c.tempF != null ? ` · ${Math.round(c.tempF)}°F` : ""}
            {c.windMph != null ? ` · ${Math.round(c.windMph)} mph` : ""}
          </Text>
        </View>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: badgeColor + "22",
          }}
        >
          <Text style={{ color: badgeColor, fontFamily: FONT.bold, fontSize: 10 }}>{badge}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function TomorrowPanel({ report }: { report: ParkWeatherReport }) {
  const colors = useColors();
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
  return <ForecastCard day={day} />;
}

function OutlookPanel({ report }: { report: ParkWeatherReport }) {
  const days = report.forecast.filter((d) => d.label !== "Today").slice(0, 5);
  const colors = useColors();
  if (!days.length) {
    return (
      <Card>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          A multi-day outlook isn&apos;t available from the feed right now.
        </Text>
      </Card>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {days.map((d) => (
        <ForecastCard key={d.date} day={d} />
      ))}
    </View>
  );
}

function ForecastCard({ day }: { day: ParkWeatherReport["forecast"][number] }) {
  const colors = useColors();
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>{day.label}</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
          {[day.condition, day.precipChancePct != null ? `${day.precipChancePct}% precip` : null, day.windMph != null ? `${Math.round(day.windMph)} mph wind` : null]
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

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return (
    <Card>
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
        Couldn&apos;t load weather
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, marginTop: 4 }}>
        The live weather feed is unavailable right now. Pull to refresh to try again.
      </Text>
      <Pressable
        onPress={onRetry}
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
        <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>Retry</Text>
      </Pressable>
    </Card>
  );
}
