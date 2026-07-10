import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UpcomingGamesFeed } from "@/components/UpcomingGamesFeed";
import { useSlipClearance } from "@/components/SlipBar";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { OddsGame } from "@/lib/api";
import { SPORTS } from "@/lib/sports";

/**
 * In-tab sheet for "View all" upcoming games. Stays inside the tab navigator so
 * we never push the fragile root-stack /upcoming route (which was crashing on
 * navigation-hook invariants during stack transitions).
 */
export function UpcomingGamesModal({
  sportId,
  visible,
  onClose,
}: {
  sportId: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const sportLabel = SPORTS.find((s) => s.id === sportId)?.label ?? sportId ?? "";

  const onSelectGame = (game: OddsGame) => {
    onClose();
    router.push({
      pathname: "/game/[id]",
      params: { id: game.id, sport: game.sport || sportId || "" },
    });
  };

  return (
    <Modal
      visible={visible && !!sportId}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
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
          <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text
            style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }}
            numberOfLines={1}
          >
            Upcoming {sportLabel} games
          </Text>
        </View>
        {sportId ? (
          <UpcomingGamesFeed
            sportId={sportId}
            onSelectGame={onSelectGame}
            contentPaddingBottom={insets.bottom + slipClearance}
          />
        ) : null}
      </View>
    </Modal>
  );
}
