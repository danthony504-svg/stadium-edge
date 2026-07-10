import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ErrorFallbackProps } from "@/components/ErrorFallback";
import { UpcomingGamesFeed } from "@/components/UpcomingGamesFeed";
import { useSlipClearance } from "@/components/SlipBar";
import { EmptyState, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { OddsGame } from "@/lib/api";
import { SPORTS } from "@/lib/sports";

function UpcomingFeedErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 17, textAlign: "center" }}>
        Couldn't load upcoming games
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 13,
          textAlign: "center",
          lineHeight: 19,
        }}
      >
        Tap retry, or go back and pull to refresh on Home.
      </Text>
      {error.message ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.medium,
            fontSize: 11,
            textAlign: "center",
            opacity: 0.75,
          }}
          numberOfLines={3}
        >
          {error.message}
        </Text>
      ) : null}
      <Pressable
        onPress={resetError}
        style={({ pressed }) => ({
          alignSelf: "center",
          backgroundColor: colors.primary,
          borderRadius: 10,
          paddingVertical: 12,
          paddingHorizontal: 28,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Text style={{ color: colors.primaryForeground, fontFamily: FONT.semibold, fontSize: 14 }}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

function UpcomingScreenBody() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const { sport } = useLocalSearchParams<{ sport: string | string[] }>();
  const sportId = String((Array.isArray(sport) ? sport[0] : sport) || "").toLowerCase();
  const sportLabel = SPORTS.find((s) => s.id === sportId)?.label ?? sportId;

  const onSelectGame = (game: OddsGame) => {
    router.push({
      pathname: "/game/[id]",
      params: { id: game.id, sport: game.sport || sportId },
    });
  };

  if (!sportId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <EmptyState icon="calendar" title="No league selected" subtitle="Go back and pick a sport on Home." />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text
          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }}
          numberOfLines={1}
        >
          Upcoming {sportLabel} games
        </Text>
      </View>
      <UpcomingGamesFeed
        sportId={sportId}
        onSelectGame={onSelectGame}
        contentPaddingBottom={insets.bottom + slipClearance}
      />
    </View>
  );
}

/** Deep-link / legacy route — prefer UpcomingGamesModal from Home for "View all". */
export default function UpcomingScreen() {
  return (
    <ErrorBoundary FallbackComponent={UpcomingFeedErrorFallback}>
      <UpcomingScreenBody />
    </ErrorBoundary>
  );
}
