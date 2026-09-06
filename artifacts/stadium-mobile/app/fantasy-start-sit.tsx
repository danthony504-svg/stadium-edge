import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppHeader } from "@/components/AppHeader";
import { Card, FONT, Pill } from "@/components/ui";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { getFantasyNflPlayerHistory, getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { historicalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";

export default function FantasyStartSitScreen() {
  const colors = useColors();
  const router = useRouter();
  const { playerAId } = useLocalSearchParams<{ playerAId?: string }>();
  const { defaultRoster } = useFantasyRoster();
  const [playerB, setPlayerB] = useState<PlayerSearchResult | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const playerA = defaultRoster.players.find((p) => p.athleteId === playerAId) ?? null;

  const findPlayers = async () => {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    try {
      setResults((await searchPlayer(term, undefined, { rawMessage: term })).results.filter((p) => p.sport === "nfl"));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const compare = async () => {
    if (!playerA || !playerB) return;
    const [a, b, injuries] = await Promise.all([getFantasyNflPlayerHistory(playerA.athleteId), getFantasyNflPlayerHistory(playerB.athleteId), getInjuries("nfl")]);
    const aRecent = historicalFantasyAnalysis(a.games, defaultRoster.scoringFormat).recentAverage;
    const bRecent = historicalFantasyAnalysis(b.games, defaultRoster.scoringFormat).recentAverage;
    const unavailable = new Set(injuries.flatMap((team) => team.entries.filter((entry) => !/active|healthy/i.test(entry.status)).map((entry) => entry.player.toLowerCase())));
    setResult(aRecent == null || bRecent == null ? "INSUFFICIENT DATA" : unavailable.has(playerA.name.toLowerCase()) || unavailable.has(playerB.name.toLowerCase()) ? "TOO CLOSE" : aRecent > bRecent + 1 ? "START PLAYER A" : bRecent > aRecent + 1 ? "START PLAYER B" : "TOO CLOSE");
  };

  const canCompare = !!playerA && !!playerB;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 5 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>Start / Sit</Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>Compare recorded NFL production and current injury status.</Text>
        </Card>
        <Card style={{ gap: 5 }}>
          <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 12 }}>PLAYER A</Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 17 }}>{playerA?.name ?? "Saved player unavailable"}</Text>
          {playerA ? <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>{[playerA.position, playerA.team].filter(Boolean).join(" · ")}</Text> : null}
        </Card>
        <Card style={{ gap: 9 }}>
          <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 12 }}>PLAYER B</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput accessibilityLabel="Search NFL player" value={query} onChangeText={setQuery} placeholder="Search NFL player" placeholderTextColor={colors.mutedForeground} style={{ flex: 1, color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT.body }} />
            <Pressable accessibilityLabel="Search players" onPress={findPlayers} style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center" }}>
              {searching ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="search" size={18} color={colors.primaryForeground} />}
            </Pressable>
          </View>
          {playerB ? <Text style={{ color: colors.foreground, fontFamily: FONT.medium }}>{playerB.name} · {[playerB.position, playerB.team].filter(Boolean).join(" · ")}</Text> : null}
          {results.map((player) => <Pill key={player.athleteId} label={`${player.name}${player.position ? ` · ${player.position}` : ""}`} active={playerB?.athleteId === player.athleteId} onPress={() => setPlayerB(player)} />)}
        </Card>
        <Pressable accessibilityLabel="Compare Players" disabled={!canCompare} onPress={compare} style={{ backgroundColor: colors.primary, borderRadius: 10, minHeight: 48, alignItems: "center", justifyContent: "center", opacity: canCompare ? 1 : 0.45 }}>
          <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold }}>Compare Players</Text>
        </Pressable>
        {result ? <Card><Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 20 }}>{result}</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, marginTop: 4 }}>Based on recent performance, injuries, and supported recorded data.</Text></Card> : null}
        <Pressable accessibilityLabel="Back to My Fantasy Team" onPress={() => router.back()} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, minHeight: 46, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>Back to My Fantasy Team</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
