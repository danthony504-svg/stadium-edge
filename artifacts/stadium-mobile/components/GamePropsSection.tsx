import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { PropRow } from "@/components/PlayerPropRow";
import { PlayerPropsSheet, type PlayerSheetData } from "@/components/PlayerPropsSheet";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { getProps, PROPS_SPORTS, type OddsGame, type PlayerProp } from "@/lib/api";

// Player-props section for the game-detail screen. It mirrors the Props tab's
// real-prices-only rules: every line comes from getProps (real book prices),
// rows reuse the SHARED PropRow so the slip pick-string stays byte-identical
// (dedupe parity with the Props tab + Coach), and an honest empty state shows
// when a game has no props (club-league soccer, tennis, ufc) — never fabricated.
export function GamePropsSection({ game }: { game: OddsGame }) {
  const colors = useColors();
  const [sheet, setSheet] = useState<PlayerSheetData | null>(null);
  // Hide (don't close) the sheet when it sends the user to the full breakdown
  // route, then restore it on focus — same pattern the Props tab uses so back
  // lands on the sheet instead of a dead modal.
  const [sheetHidden, setSheetHidden] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setSheetHidden(false);
    }, []),
  );

  const supported = PROPS_SPORTS.includes(game.sport);
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;

  const q = useQuery({
    queryKey: ["game-props", game.sport, game.id],
    queryFn: ({ signal }) =>
      getProps({ sport: game.sport, eventId: game.id, home: game.homeTeam, away: game.awayTeam }, signal),
    enabled: supported,
    staleTime: 60_000,
  });

  // Sports that never serve props skip the section entirely (no empty noise).
  if (!supported) return null;

  const all = (q.data?.props ?? []).filter((p) => p.overPrice != null || p.underPrice != null);
  const mains = all.filter((p) => !p.alt);

  // Gather every market this player has in the game so the sheet can show its
  // metric pills + line list (matches the Props tab's openSheet).
  const openSheet = (prop: PlayerProp) => {
    const playerProps = all.filter((p) => p.player === prop.player);
    setSheet({
      player: prop.player,
      athleteId: prop.athleteId ?? null,
      headshot: prop.headshot ?? null,
      playerTeamId: prop.playerTeamId ?? null,
      teamAbbr: null,
      sport: game.sport,
      gameLabel,
      startsAt: game.commenceTime ?? "",
      initialMarket: prop.market,
      props: playerProps,
    });
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 16 }}>
        Player Props
      </Text>

      {q.isLoading ? (
        <View style={{ paddingVertical: 16, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : q.isError ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          Couldn’t load player props. Pull to refresh or try again shortly.
        </Text>
      ) : mains.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          No player props posted for this game.
        </Text>
      ) : (
        mains.map((p, idx) => (
          <PropRow
            key={`${p.player}-${p.market}-${p.line}-${idx}`}
            prop={p}
            alts={all
              .filter((a) => a.alt && a.player === p.player && a.market === p.market)
              .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))}
            gameLabel={gameLabel}
            sport={game.sport}
            onOpen={() => openSheet(p)}
          />
        ))
      )}

      <PlayerPropsSheet
        data={sheet}
        active={!sheetHidden}
        onHide={() => setSheetHidden(true)}
        onClose={() => {
          setSheet(null);
          setSheetHidden(false);
        }}
      />
    </View>
  );
}
