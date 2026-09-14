import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppHeader } from "@/components/AppHeader";
import { FantasyPlayerCard } from "@/components/FantasyPlayerCard";
import { Badge, Card, FONT, Pill } from "@/components/ui";
import { useSlipClearance } from "@/components/SlipBar";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { getFantasyNflPlayerHistory, getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { historicalFantasyAnalysis, type HistoricalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";
import { FANTASY_ROSTER_SLOTS, type FantasyRosterSlot } from "@/lib/fantasyRoster";
import { FANTASY_SCORING_LABELS, type FantasyScoringFormat } from "@/lib/fantasyScoring";

type FantasyView = "overview" | "team" | "lineup" | "startsit" | "waivers" | "trade" | "players";
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
  const [view, setView] = useState<FantasyView>("overview");
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
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: clearance + 24 }}>
        {view === "overview" ? (
          <>
            <LinearGradient
              colors={["#082f49", "#0c4a6e", "#020617"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ minHeight: 164, borderRadius: 16, padding: 18, overflow: "hidden", borderWidth: 1, borderColor: "#0369a1" }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Feather name="award" size={17} color="#38bdf8" />
                <Text style={{ color: "#e0f2fe", fontFamily: FONT.bold, fontSize: 13, letterSpacing: 0.6 }}>FANTASY FOOTBALL</Text>
              </View>
              <Text style={{ color: "#f8fafc", fontFamily: FONT.display, fontSize: 25, marginTop: 12 }}>Smarter Decisions.</Text>
              <Text style={{ color: "#38bdf8", fontFamily: FONT.display, fontSize: 25 }}>A Stronger Season.</Text>
              <Text style={{ color: "#cbd5e1", fontFamily: FONT.body, fontSize: 13, lineHeight: 19, marginTop: 8, maxWidth: "72%" }}>
                Player rankings, lineup analysis, and AI-powered insights for your fantasy league.
              </Text>
              <Text style={{ position: "absolute", right: 14, bottom: 12, fontSize: 60, opacity: 0.7 }}>🏈</Text>
            </LinearGradient>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {([
                ["overview", "Overview", "home"],
                ["players", "Rankings", "list"],
                ["lineup", "Projections", "bar-chart-2"],
                ["startsit", "Matchups", "calendar"],
                ["waivers", "Waiver Wire", "plus-circle"],
                ["trade", "Trade Analyzer", "repeat"],
              ] as Array<[FantasyView, string, React.ComponentProps<typeof Feather>["name"]]>).map(([id, label, icon]) => (
                <Pressable key={id} onPress={() => id === "trade" ? router.push("/fantasy-trade") : setView(id)} style={({ pressed }) => ({ width: 76, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 11, borderWidth: 1, borderColor: view === id ? colors.primary : colors.border, backgroundColor: view === id ? "#0c4a6e" : colors.card, opacity: pressed ? 0.8 : 1 })}>
                  <Feather name={icon} size={17} color={view === id ? "#38bdf8" : colors.mutedForeground} />
                  <Text style={{ color: view === id ? colors.foreground : colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, textAlign: "center" }}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Card style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View><Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 19 }}>My Fantasy Team</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>{hydrated ? `${defaultRoster.players.length} players saved to your profile` : "Loading your team…"}</Text></View>
                <Pressable onPress={() => router.push("/fantasy-team")}><Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 13 }}>View team ›</Text></Pressable>
              </View>
              {defaultRoster.players.slice(0, 5).map((player, index) => <Pressable key={player.athleteId} onPress={() => router.push("/fantasy-team")} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 10 }}>
                <Text style={{ width: 18, color: colors.mutedForeground, fontFamily: FONT.bold }}>{index + 1}</Text>
                <View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{player.name}</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>{[player.position, player.team].filter(Boolean).join(" · ")}</Text></View>
                <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 12 }}>{player.rosterSlot}</Text>
              </Pressable>)}
              {!defaultRoster.players.length ? <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>Add your roster to unlock personalized lineup tools.</Text> : null}
            </Card>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setView("lineup")} style={{ flex: 1, padding: 14, borderWidth: 1, borderColor: "#0369a1", borderRadius: 12, backgroundColor: "#082f49" }}><Feather name="calendar" size={19} color="#38bdf8" /><Text style={{ color: colors.foreground, fontFamily: FONT.semibold, marginTop: 8 }}>Week 1 Matchups</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>Lineup decisions ›</Text></Pressable>
              <Pressable onPress={() => setView("waivers")} style={{ flex: 1, padding: 14, borderWidth: 1, borderColor: "#0369a1", borderRadius: 12, backgroundColor: "#082f49" }}><Feather name="plus-circle" size={19} color="#38bdf8" /><Text style={{ color: colors.foreground, fontFamily: FONT.semibold, marginTop: 8 }}>Waiver Wire</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>Find pickups ›</Text></Pressable>
            </View>
          </>
        ) : null}
        {view !== "overview" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {(["overview", "team", "lineup", "startsit", "waivers", "trade", "players"] as FantasyView[]).map((id) => (
            <Pill key={id} label={id === "startsit" ? "Start / Sit" : id === "team" ? "My Team" : id === "waivers" ? "Waiver Scanner" : id === "players" ? "Fantasy Players" : id === "overview" ? "Overview" : id[0]!.toUpperCase() + id.slice(1)} active={view === id} onPress={() => setView(id)} />
          ))}
        </ScrollView> : null}
        {view !== "overview" ? <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>Scoring format</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(Object.keys(FANTASY_SCORING_LABELS) as FantasyScoringFormat[]).map((id) => (
              <Pill key={id} label={FANTASY_SCORING_LABELS[id]} active={defaultRoster.scoringFormat === id} onPress={() => setScoringFormat(id)} />
            ))}
          </View>
        </Card> : null}

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
