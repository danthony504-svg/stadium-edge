import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppHeader, PageTitleRow } from "@/components/AppHeader";
import { FantasyPlayerCard } from "@/components/FantasyPlayerCard";
import { Badge, Card, FONT, Pill } from "@/components/ui";
import { useSlipClearance } from "@/components/SlipBar";
import { useColors } from "@/hooks/useColors";
import { searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { FANTASY_SCORING_LABELS, type FantasyScoringFormat } from "@/lib/fantasyScoring";

const ROSTER_KEY = "stadium-edge:fantasy-roster:v1";
type FantasyView = "team" | "lineup" | "startsit" | "waivers" | "trade" | "players";
const features: Array<{ id: FantasyView; title: string; body: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { id: "lineup", title: "Optimize Lineup", body: "Build a starting lineup from your manual roster.", icon: "award" },
  { id: "startsit", title: "Start / Sit", body: "Compare two or more rostered NFL players.", icon: "git-branch" },
  { id: "waivers", title: "Waiver Scanner", body: "Find evidence-backed pickup opportunities.", icon: "search" },
  { id: "trade", title: "Trade Analyzer", body: "Compare Side A and Side B rest-of-season value.", icon: "repeat" },
];

export default function FantasyScreen() {
  const colors = useColors();
  const clearance = useSlipClearance();
  const [view, setView] = useState<FantasyView>("team");
  const [format, setFormat] = useState<FantasyScoringFormat>("ppr");
  const [roster, setRoster] = useState<PlayerSearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(ROSTER_KEY).then((raw) => {
      if (!raw) return;
      try { setRoster(JSON.parse(raw) as PlayerSearchResult[]); } catch { /* ignore legacy/corrupt local roster */ }
    }).catch(() => {});
  }, []);
  const saveRoster = (next: PlayerSearchResult[]) => {
    setRoster(next);
    void AsyncStorage.setItem(ROSTER_KEY, JSON.stringify(next)).catch(() => {});
  };
  const findPlayers = async () => {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    try {
      const response = await searchPlayer(term, undefined, { rawMessage: term });
      setResults(response.results.filter((player) => player.sport.toLowerCase() === "nfl").slice(0, 10));
    } catch { setResults([]); } finally { setSearching(false); }
  };
  const rosterIds = useMemo(() => new Set(roster.map((player) => player.athleteId)), [roster]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader />
      <PageTitleRow icon="award" title="Fantasy Football" subtitle="AI-powered lineup, waiver, trade, and player analysis" />
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: clearance + 24 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(["team", "lineup", "startsit", "waivers", "trade", "players"] as FantasyView[]).map((id) => (
            <Pill key={id} label={id === "startsit" ? "Start / Sit" : id === "team" ? "My Team" : id === "waivers" ? "Waiver Scanner" : id === "players" ? "Fantasy Players" : id[0]!.toUpperCase() + id.slice(1)} active={view === id} onPress={() => setView(id)} />
          ))}
        </ScrollView>
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>Scoring format</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(Object.keys(FANTASY_SCORING_LABELS) as FantasyScoringFormat[]).map((id) => (
              <Pill key={id} label={FANTASY_SCORING_LABELS[id]} active={format === id} onPress={() => setFormat(id)} />
            ))}
          </View>
        </Card>

        {view === "team" || view === "players" ? (
          <>
            <Card style={{ gap: 10 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16 }}>My Team</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={query} onChangeText={setQuery} placeholder="Search NFL player" placeholderTextColor={colors.mutedForeground} style={{ flex: 1, color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT.body }} />
                <Pressable onPress={findPlayers} style={{ justifyContent: "center", paddingHorizontal: 13, borderRadius: 10, backgroundColor: colors.primary }}>
                  {searching ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="search" size={18} color={colors.primaryForeground} />}
                </Pressable>
              </View>
              {results.map((player) => (
                <Pressable key={player.athleteId} onPress={() => !rosterIds.has(player.athleteId) && saveRoster([...roster, player])} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.medium }}>{player.name} · {player.team ?? "Team unavailable"}</Text>
                  <Badge label={rosterIds.has(player.athleteId) ? "ON TEAM" : "ADD"} tone="primary" />
                </Pressable>
              ))}
            </Card>
            {roster.length ? roster.map((player) => (
              <View key={player.athleteId} style={{ gap: 6 }}>
                <FantasyPlayerCard player={{ name: player.name, team: player.team, position: null }} />
                <Pressable onPress={() => saveRoster(roster.filter((item) => item.athleteId !== player.athleteId))}><Text style={{ color: colors.live, fontFamily: FONT.medium, fontSize: 13 }}>Remove from My Team</Text></Pressable>
              </View>
            )) : <Card><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body }}>Add NFL players to begin lineup, start/sit, and trade analysis.</Text></Card>}
          </>
        ) : (
          <>
            {features.filter((feature) => feature.id === view).map((feature) => (
              <Card key={feature.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Feather name={feature.icon} color={colors.primary} size={20} /><Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 18 }}>{feature.title}</Text></View>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body }}>{feature.body}</Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>Data unavailable until real NFL player history and supported targeted simulations are loaded. Open My Team to add players.</Text>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
