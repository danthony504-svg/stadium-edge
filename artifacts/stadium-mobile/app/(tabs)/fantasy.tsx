import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppHeader, PageTitleRow } from "@/components/AppHeader";
import { FantasyPlayerCard } from "@/components/FantasyPlayerCard";
import { Badge, Card, FONT, Pill } from "@/components/ui";
import { useSlipClearance } from "@/components/SlipBar";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { getFantasyNflPlayerHistory, getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { historicalFantasyAnalysis, type HistoricalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";
import { FANTASY_ROSTER_SLOTS, type FantasyRosterSlot } from "@/lib/fantasyRoster";
import { FANTASY_SCORING_LABELS, type FantasyScoringFormat } from "@/lib/fantasyScoring";

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
  const router = useRouter();
  const { defaultRoster, hydrated, addPlayer, movePlayer, removePlayer, setScoringFormat } = useFantasyRoster();
  const [view, setView] = useState<FantasyView>("team");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [analysis, setAnalysis] = useState<Record<string, HistoricalFantasyAnalysis>>({});
  const [injuries, setInjuries] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getInjuries("nfl").then((teams) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const team of teams) for (const entry of team.entries) next[entry.player.trim().toLowerCase()] = entry.status;
      setInjuries(next);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(defaultRoster.players.map(async (player) => {
      const { games } = await getFantasyNflPlayerHistory(player.athleteId);
      return [player.athleteId, historicalFantasyAnalysis(games, defaultRoster.scoringFormat)] as const;
    })).then((rows) => {
      if (!cancelled) setAnalysis(Object.fromEntries(rows));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [defaultRoster.players, defaultRoster.scoringFormat]);

  const findPlayers = async () => {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    try {
      const response = await searchPlayer(term, undefined, { rawMessage: term });
      setResults(response.results.filter((player) => player.sport.toLowerCase() === "nfl").slice(0, 10));
    } catch { setResults([]); } finally { setSearching(false); }
  };
  const rosterIds = useMemo(() => new Set(defaultRoster.players.map((player) => player.athleteId)), [defaultRoster.players]);
  const startSlot = (position: string | null | undefined): FantasyRosterSlot => {
    const normalized = position?.toUpperCase();
    return (["QB", "RB", "WR", "TE", "K", "DEF"].includes(normalized ?? "") ? normalized : "FLEX") as FantasyRosterSlot;
  };

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
              <Pill key={id} label={FANTASY_SCORING_LABELS[id]} active={defaultRoster.scoringFormat === id} onPress={() => setScoringFormat(id)} />
            ))}
          </View>
        </Card>

        {view === "team" || view === "players" ? (
          <>
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16 }}>My Fantasy Team</Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>{hydrated ? `${defaultRoster.players.length} saved` : "Loading…"}</Text>
              </View>
              <Pressable onPress={() => router.push({ pathname: "/coach", params: { autoMsg: "Optimize my fantasy football lineup using only my saved roster. Show starters, bench, FLEX, best floor lineup, highest upside lineup, and recommended changes with projected gain and confidence.", send: "1", ts: String(Date.now()) } })} disabled={!defaultRoster.players.length} style={({ pressed }) => ({ alignItems: "center", backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, opacity: !defaultRoster.players.length ? 0.45 : pressed ? 0.85 : 1 })}>
                <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold }}>Optimize My Lineup</Text>
              </Pressable>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={query} onChangeText={setQuery} placeholder="Search NFL player" placeholderTextColor={colors.mutedForeground} style={{ flex: 1, color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT.body }} />
                <Pressable onPress={findPlayers} style={{ justifyContent: "center", paddingHorizontal: 13, borderRadius: 10, backgroundColor: colors.primary }}>
                  {searching ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="search" size={18} color={colors.primaryForeground} />}
                </Pressable>
              </View>
              {results.map((player) => (
                <Pressable key={player.athleteId} onPress={() => !rosterIds.has(player.athleteId) && addPlayer({ athleteId: player.athleteId, name: player.name, team: player.team, headshot: player.headshot, position: player.position })} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: FONT.medium }}>{player.name} · {[player.position, player.team ?? "Team unavailable"].filter(Boolean).join(" · ")}</Text>
                  <Badge label={rosterIds.has(player.athleteId) ? "ON TEAM" : "ADD"} tone="primary" />
                </Pressable>
              ))}
            </Card>
            {defaultRoster.players.length ? FANTASY_ROSTER_SLOTS.map((slot) => {
              const players = defaultRoster.players.filter((player) => player.rosterSlot === slot);
              if (!players.length && !["QB", "RB", "WR", "TE", "FLEX", "Bench"].includes(slot)) return null;
              return <Card key={slot} style={{ gap: 8 }}>
                <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>{slot.toUpperCase()}</Text>
                {players.length ? players.map((player) => <View key={player.athleteId} style={{ gap: 6 }}>
                  <Pressable onPress={() => setView("players")}><FantasyPlayerCard player={{
                    name: player.name,
                    team: player.team,
                    position: player.position,
                    simulationAverage: analysis[player.athleteId]?.recentAverage,
                    floor: analysis[player.athleteId]?.floor,
                    ceiling: analysis[player.athleteId]?.ceiling,
                    injuryStatus: injuries[player.name.trim().toLowerCase()] ?? null,
                    dataNote: analysis[player.athleteId]?.games
                      ? `ESPN recorded L${analysis[player.athleteId]!.games}: ${analysis[player.athleteId]!.targetsPerGame ?? "—"} targets, ${analysis[player.athleteId]!.carriesPerGame ?? "—"} carries, ${analysis[player.athleteId]!.touchesPerGame ?? "—"} touches/game. Weekly projections, snap share and red-zone usage are unavailable.`
                      : "Recorded ESPN fantasy game logs are unavailable.",
                  }} /></Pressable>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <Pill label="Start" active={false} onPress={() => movePlayer(player.athleteId, startSlot(player.position))} />
                    <Pill label="Bench" active={player.rosterSlot === "Bench"} onPress={() => movePlayer(player.athleteId, "Bench")} />
                    {FANTASY_ROSTER_SLOTS.filter((candidate) => candidate !== "Bench").map((candidate) => <Pill key={candidate} label={`Move ${candidate}`} active={player.rosterSlot === candidate} onPress={() => movePlayer(player.athleteId, candidate)} />)}
                    <Pill label="Drop Player" active={false} onPress={() => removePlayer(player.athleteId)} />
                  </ScrollView>
                </View>) : <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>No players assigned</Text>}
              </Card>;
            }) : <Card><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body }}>Search and add NFL players to save a team to your Stadium Edge account.</Text></Card>}
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
