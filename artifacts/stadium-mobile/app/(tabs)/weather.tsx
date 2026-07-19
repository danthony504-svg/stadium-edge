import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { getGames, getParkWeather, type EspnGame, type ParkWeatherReport } from "@/lib/api";
import { mlbTeamLogoUrl } from "@/lib/mlbTeamLogo";
import {
  conditionIconName,
  gameWeatherEffects,
  impactBannerCopy,
  impactLevelLabel,
  impactLevelTone,
  precipDisplay,
  windCarryLabel,
  windDisplay,
  type GameEffectCard,
  type ImpactLevel,
} from "@/lib/parkWeatherUi";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type TabKey = "today" | "tomorrow" | "outlook";

const REFETCH_MS = 12 * 60 * 1000;
const FAV_PARKS_KEY = "weather:favoriteParks";

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
  const [favoriteParks, setFavoriteParks] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FAV_PARKS_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw) as string[];
          if (Array.isArray(parsed)) setFavoriteParks(new Set(parsed));
        }
      } catch {
        /* ignore corrupt cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFavorite = useCallback(async (homeAbbr: string) => {
    setFavoriteParks((prev) => {
      const next = new Set(prev);
      if (next.has(homeAbbr)) next.delete(homeAbbr);
      else next.add(homeAbbr);
      void AsyncStorage.setItem(FAV_PARKS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const q = useQuery({
    queryKey: ["parkWeather", "mlb"],
    queryFn: ({ signal }) => getParkWeather("mlb", signal),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: REFETCH_MS,
  });

  const gamesQ = useQuery({
    queryKey: ["games", "mlb"],
    queryFn: ({ signal }) => getGames("mlb", signal),
    staleTime: REFETCH_MS,
  });

  const reports = q.data ?? [];

  const games = useMemo((): EspnGame[] => {
    const raw = gamesQ.data as EspnGame[] | { games?: EspnGame[] } | null | undefined;
    return Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.games)
        ? raw.games
        : [];
  }, [gamesQ.data]);

  const logoByAbbr = useMemo(() => {
    const map = new Map<string, string | null>();

    for (const g of games) {
      if (g?.awayAbbr) {
        map.set(g.awayAbbr.toUpperCase(), g.awayLogo ?? null);
      }

      if (g?.homeAbbr) {
        map.set(g.homeAbbr.toUpperCase(), g.homeLogo ?? null);
      }
    }

    return map;
  }, [games]);

  const selected = useMemo<ParkWeatherReport | undefined>(
    () => reports.find((r) => r.gameId === selectedId) ?? reports[0],
    [reports, selectedId],
  );

  useEffect(() => {
    if (reports.length > 0 && selectedId && !reports.some((r) => r.gameId === selectedId)) {
      setSelectedId(reports[0]!.gameId);
    }
  }, [reports, selectedId]);

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

            <MatchupSelector
              reports={reports}
              selectedId={selected?.gameId ?? null}
              logoByAbbr={logoByAbbr}
              onSelect={(id) => {
                setSelectedId(id);
                setVenueOpen(false);
              }}
            />

            {selected && (
              <>
                <VenueSelector
                  report={selected}
                  reports={reports}
                  open={venueOpen}
                  favorite={favoriteParks.has(selected.homeAbbr)}
                  onToggleFavorite={() => toggleFavorite(selected.homeAbbr)}
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

const LOGO_SIZE = 26;
const LOGO_TEXT_GAP = 9;

function MatchupLogo({ uri, abbr }: { uri: string; abbr: string }) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (!uri || failed) {
    return (
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 11,
          minWidth: LOGO_SIZE,
          textAlign: "center",
        }}
      >
        {abbr}
      </Text>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width: LOGO_SIZE, height: LOGO_SIZE }}
      contentFit="contain"
      transition={150}
      onError={() => setFailed(true)}
    />
  );
}

function MatchupSelector({
  reports,
  selectedId,
  logoByAbbr,
  onSelect,
}: {
  reports: ParkWeatherReport[];
  selectedId: string | null;
  logoByAbbr: Map<string, string | null>;
  onSelect: (gameId: string) => void;
}) {
  const colors = useColors();
  if (reports.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingBottom: 14 }}
      style={{ marginBottom: 2 }}
    >
      {reports.map((r) => {
        const active = r.gameId === selectedId;
        const awayLogo =
          logoByAbbr.get(r.awayAbbr.toUpperCase()) ?? mlbTeamLogoUrl(r.awayAbbr);
        const homeLogo =
          logoByAbbr.get(r.homeAbbr.toUpperCase()) ?? mlbTeamLogoUrl(r.homeAbbr);
        return (
          <Pressable
            key={r.gameId}
            onPress={() => onSelect(r.gameId)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? "rgba(59,130,246,0.14)" : colors.card,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <MatchupLogo uri={awayLogo} abbr={r.awayAbbr} />
              <Text
                style={{
                  color: active ? colors.primary : colors.mutedForeground,
                  fontFamily: FONT.bold,
                  fontSize: 11,
                }}
              >
                @
              </Text>
              <MatchupLogo uri={homeLogo} abbr={r.homeAbbr} />
            </View>
            <Text
              style={{
                color: active ? colors.foreground : colors.mutedForeground,
                fontFamily: active ? FONT.bold : FONT.semibold,
                fontSize: 13,
                marginLeft: LOGO_TEXT_GAP,
              }}
            >
              {r.awayAbbr} @ {r.homeAbbr}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function VenueSelector({
  report,
  reports,
  open,
  favorite,
  onToggleFavorite,
  onToggle,
  onSelect,
}: {
  report: ParkWeatherReport;
  reports: ParkWeatherReport[];
  open: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: 12 }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => ({
            flex: 1,
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
        </Pressable>
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, padding: 4 })}
        >
          <Feather name="star" size={18} color={favorite ? "#fbbf24" : colors.mutedForeground} />
        </Pressable>
        <Pressable onPress={onToggle} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, padding: 2 })}>
          <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
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
        <HeroStat label="Wind" value={windDisplay(c, report.homeAbbr)} />
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
  const carry = windCarryLabel(report.current.windDeg, report.current.windMph, report.homeAbbr);
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
      <Text style={{ color: theme.text, fontFamily: FONT.bold, fontSize: 12, letterSpacing: 0.3 }}>
        today&apos;s verdict? {impactLevelLabel(report.impact.rating)}
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
        {impactBannerCopy(report.impact.rating, report.climateControlled, carry)}
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
    { label: "Wind", value: windDisplay(c, report.homeAbbr), icon: "wind" },
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
        {effect.pct != null ? ` ${effect.pct > 0 ? "+" : ""}${effect.pct}%` : ""}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 4 }}>
        {effect.detail}
      </Text>
    </View>
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
