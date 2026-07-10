import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { FighterAvatar } from "@/components/FighterAvatar";
import { type GameMeta } from "@/components/GameCard";
import { EmptyState, FONT, Loading } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  getGames,
  getOdds,
  getTennisFlags,
  isPickable,
  resolveTennisFlag,
  type EspnGame,
  type OddsGame,
  type TennisFlag,
} from "@/lib/api";
import { cachedUpcomingGames } from "@/lib/discoverSessionCache";
import { formatAmerican } from "@/lib/format";
import {
  espnPayloadFromQuery,
  isRenderableOddsGame,
  oddsPayloadFromQuery,
  type SportFeedPayload,
} from "@/lib/sportFeed";
import { SPORTS } from "@/lib/sports";
import { buildUfcFeedPhotoMap, withUfcFightPhotos } from "@/lib/ufcFighterPhotos";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

function buildMetaMap(games: EspnGame[]): Map<string, GameMeta> {
  const map = new Map<string, GameMeta>();
  for (const g of games) {
    const home = g.homeTeam || g.homeAbbr || "";
    const away = g.awayTeam || g.awayAbbr || "";
    if (!home || !away) continue;
    const key = `${nickname(away)}|${nickname(home)}`.toLowerCase();
    map.set(key, {
      homeLogo: g.homeLogo,
      awayLogo: g.awayLogo,
      live: g.state === "in",
      awayScore: g.awayScore,
      homeScore: g.homeScore,
      periodLabel: g.periodLabel,
    });
  }
  return map;
}

function withTennisFlags(
  base: GameMeta | undefined,
  flags: Record<string, TennisFlag> | undefined,
  g: OddsGame,
): GameMeta | undefined {
  if (!flags) return base;
  const awayFlag = resolveTennisFlag(flags, g.awayTeam);
  const homeFlag = resolveTennisFlag(flags, g.homeTeam);
  if (!awayFlag && !homeFlag) return base;
  return {
    ...(base ?? {}),
    awayLogo: awayFlag ?? base?.awayLogo ?? null,
    homeLogo: homeFlag ?? base?.homeLogo ?? null,
  };
}

function UpcomingGameRow({
  game,
  meta,
  onPress,
  isUfc = false,
}: {
  game: OddsGame;
  meta?: GameMeta;
  onPress: () => void;
  isUfc?: boolean;
}) {
  const colors = useColors();
  const h2h = game.markets?.find((m) => m.key === "h2h");
  const awayML = h2h?.outcomes?.find((o) => o.name === game.awayTeam)?.price;
  const homeML = h2h?.outcomes?.find((o) => o.name === game.homeTeam)?.price;
  const rows = [
    { name: game.awayTeam, logo: meta?.awayLogo, ml: awayML },
    { name: game.homeTeam, logo: meta?.homeLogo, ml: homeML },
  ];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        padding: 14,
        gap: 10,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.semibold,
            fontSize: 12,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {nickname(game.awayTeam)} @ {nickname(game.homeTeam)}
        </Text>
        {game.commenceTime ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
            {new Date(game.commenceTime).toLocaleString([], {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
      </View>

      {rows.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <FighterAvatar uri={t.logo} name={t.name} size={24} photo={isUfc} />
          <Text
            style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15, flex: 1 }}
            numberOfLines={1}
          >
            {t.name}
          </Text>
          {t.ml != null ? (
            <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
              {formatAmerican(t.ml)}
            </Text>
          ) : null}
        </View>
      ))}
    </Pressable>
  );
}

/** Shared upcoming-games list — no expo-router navigation hooks (safe inside modals). */
export function UpcomingGamesFeed({
  sportId,
  onSelectGame,
  contentPaddingBottom = 0,
}: {
  sportId: string;
  onSelectGame: (game: OddsGame) => void;
  contentPaddingBottom?: number;
}) {
  const colors = useColors();

  const oddsPlaceholder = useMemo((): SportFeedPayload<OddsGame> | undefined => {
    const cached = cachedUpcomingGames(sportId);
    if (!Array.isArray(cached) || cached.length === 0) return undefined;
    const rows = cached.filter(isRenderableOddsGame);
    return rows.length > 0 ? { gen: 0, league: sportId, rows } : undefined;
  }, [sportId]);

  const oddsQ = useQuery<SportFeedPayload<OddsGame>>({
    queryKey: ["upcoming-odds", sportId],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      try {
        const rows = await getOdds(league, signal);
        return { gen: 0, league, rows: rows.filter(isRenderableOddsGame) };
      } catch {
        return { gen: 0, league, rows: [] as OddsGame[] };
      }
    },
    staleTime: 60_000,
    enabled: !!sportId,
    placeholderData: oddsPlaceholder,
    structuralSharing: false,
    select: (data) => oddsPayloadFromQuery(data, sportId),
  });

  const gamesQ = useQuery<SportFeedPayload<EspnGame>>({
    queryKey: ["upcoming-games", sportId],
    queryFn: async ({ signal, queryKey }) => {
      const league = String(queryKey[1] ?? "");
      try {
        const rows = await getGames(league, signal);
        return { gen: 0, league, rows };
      } catch {
        return { gen: 0, league, rows: [] as EspnGame[] };
      }
    },
    staleTime: 60_000,
    enabled: !!sportId,
    structuralSharing: false,
    select: (data) => espnPayloadFromQuery(data, sportId),
  });

  const tennisFlagsQ = useQuery({
    queryKey: ["tennis-flags"],
    queryFn: ({ signal }) => getTennisFlags(signal),
    staleTime: 5 * 60_000,
    enabled: sportId === "tennis",
    retry: false,
  });

  const espnGames = useMemo(() => gamesQ.data?.rows ?? [], [gamesQ.data]);
  const metaMap = useMemo(() => buildMetaMap(espnGames), [espnGames]);

  const liveKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const g of espnGames) {
      if (g.state !== "in") continue;
      const home = g.homeTeam || g.homeAbbr || "";
      const away = g.awayTeam || g.awayAbbr || "";
      if (!home || !away) continue;
      s.add(`${nickname(away)}|${nickname(home)}`.toLowerCase());
    }
    return s;
  }, [espnGames]);

  const games: OddsGame[] = useMemo(() => {
    return (oddsQ.data?.rows ?? [])
      .filter((g) => isPickable(g.commenceTime))
      .filter(
        (g) => !liveKeySet.has(`${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase()),
      )
      .sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  }, [oddsQ.data, liveKeySet]);

  const ufcPhotoKey = useMemo(
    () =>
      games
        .map((g) => `${g.awayTeam}|${g.homeTeam}`)
        .sort()
        .join(";"),
    [games],
  );

  const ufcPhotosQ = useQuery({
    queryKey: ["ufc-feed-photos", ufcPhotoKey],
    queryFn: ({ signal }) =>
      buildUfcFeedPhotoMap(
        games.map((g) => ({ awayTeam: g.awayTeam, homeTeam: g.homeTeam })),
        signal,
      ),
    staleTime: 24 * 60 * 60_000,
    enabled: sportId === "ufc" && games.length > 0,
  });

  const sportLabel = SPORTS.find((s) => s.id === sportId)?.label ?? sportId;
  const feedLoading = oddsQ.isFetching && games.length === 0;

  if (!sportId) {
    return (
      <EmptyState icon="calendar" title="No league selected" subtitle="Pick a sport on Home first." />
    );
  }

  if (feedLoading) {
    return <Loading label="Loading live odds…" />;
  }

  if (games.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        title="No games in the window"
        subtitle={`No ${sportLabel} games are within the next 48 hours. Try another league.`}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 16,
        paddingBottom: 16 + contentPaddingBottom,
        gap: 12,
      }}
    >
      {games.map((g) => {
        const baseMeta = metaMap.get(
          `${nickname(g.awayTeam)}|${nickname(g.homeTeam)}`.toLowerCase(),
        );
        const meta =
          sportId === "tennis"
            ? withTennisFlags(baseMeta, tennisFlagsQ.data, g)
            : sportId === "ufc"
              ? (withUfcFightPhotos(baseMeta, ufcPhotosQ.data, g.awayTeam, g.homeTeam) as GameMeta)
              : baseMeta;
        const row = { ...g, sport: g.sport || sportId };
        return (
          <UpcomingGameRow
            key={g.id}
            game={row}
            meta={meta}
            onPress={() => onSelectGame(row)}
            isUfc={sportId === "ufc"}
          />
        );
      })}
    </ScrollView>
  );
}
