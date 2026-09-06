import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppHeader } from "@/components/AppHeader";
import { Badge, Card, FONT, Pill } from "@/components/ui";
import { useSlipClearance } from "@/components/SlipBar";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { FANTASY_ROSTER_SLOTS, type FantasyRosterSlot } from "@/lib/fantasyRoster";
import { FANTASY_SCORING_LABELS, type FantasyScoringFormat } from "@/lib/fantasyScoring";

const SLOT_LABEL: Record<FantasyRosterSlot, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX: "FLEX", K: "K", DEF: "DST", Bench: "Bench", IR: "IR" };

export default function FantasyTeamScreen() {
  const colors = useColors();
  const clearance = useSlipClearance();
  const router = useRouter();
  const { defaultRoster, hydrated, addPlayer, movePlayer, removePlayer, setScoringFormat } = useFantasyRoster();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [injuries, setInjuries] = useState<Record<string, string>>({});
  const ids = useMemo(() => new Set(defaultRoster.players.map((p) => p.athleteId)), [defaultRoster.players]);

  useEffect(() => {
    void getInjuries("nfl").then((teams) => {
      const next: Record<string, string> = {};
      for (const team of teams) for (const entry of team.entries) next[entry.player.trim().toLowerCase()] = entry.status;
      setInjuries(next);
    }).catch(() => {});
  }, []);

  const findPlayers = async () => {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    try {
      const response = await searchPlayer(term, undefined, { rawMessage: term });
      setResults(response.results.filter((p) => p.sport.toLowerCase() === "nfl").slice(0, 10));
    } catch { setResults([]); } finally { setSearching(false); }
  };
  const askCoach = (prompt: string) => {
    const tradePlayer = prompt.match(/^Analyze whether I should trade (.+) from my saved fantasy roster/)?.[1];
    const player = tradePlayer ? defaultRoster.players.find((candidate) => candidate.name === tradePlayer) : null;
    if (player) {
      router.push({ pathname: "/fantasy-trade", params: { giveId: player.athleteId } });
      return;
    }
    // Fantasy actions do not enter the Sports AI Coach request pipeline.
    return;
  };
  const suggestedSlot = (position?: string | null): FantasyRosterSlot =>
    (["QB", "RB", "WR", "TE", "K", "DEF"].includes(position?.toUpperCase() ?? "") ? position!.toUpperCase() : "FLEX") as FantasyRosterSlot;

  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <AppHeader />
    <ScrollView contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: clearance + 24 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View><Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>My Fantasy Team</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>{hydrated ? `${defaultRoster.players.length} players saved to your profile` : "Loading saved roster…"}</Text></View>
          <Pressable onPress={() => router.back()}><Feather name="x" size={21} color={colors.mutedForeground} /></Pressable>
        </View>
        <Pressable disabled={!defaultRoster.players.length} onPress={() => askCoach("Optimize my fantasy football lineup using only my saved roster. Show starters, bench, FLEX, best floor lineup, highest upside lineup, and recommended changes with confidence.")} style={{ backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center", opacity: defaultRoster.players.length ? 1 : 0.45 }}>
          <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold }}>Set My Best Lineup</Text>
        </Pressable>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>Uses your saved roster. Weekly projections are shown only when a supported provider supplies them.</Text>
      </Card>
      <Card style={{ gap: 8 }}><Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>Scoring format</Text><View style={{ flexDirection: "row", gap: 7 }}>{(Object.keys(FANTASY_SCORING_LABELS) as FantasyScoringFormat[]).map((format) => <Pill key={format} label={FANTASY_SCORING_LABELS[format]} active={defaultRoster.scoringFormat === format} onPress={() => setScoringFormat(format)} />)}</View></Card>
      <Card style={{ gap: 9 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>Add NFL players</Text>
        <View style={{ flexDirection: "row", gap: 8 }}><TextInput value={query} onChangeText={setQuery} placeholder="Search player name" placeholderTextColor={colors.mutedForeground} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, color: colors.foreground, borderRadius: 10, padding: 10, fontFamily: FONT.body }} /><Pressable onPress={findPlayers} style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 11 }}>{searching ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="search" color={colors.primaryForeground} size={18} />}</Pressable></View>
        {results.map((p) => <Pressable key={p.athleteId} disabled={ids.has(p.athleteId)} onPress={() => addPlayer({ athleteId: p.athleteId, name: p.name, team: p.team, headshot: p.headshot, position: p.position })} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }}><Text style={{ color: colors.foreground, fontFamily: FONT.medium }}>{p.name} · {[p.position, p.team ?? "Team unavailable"].filter(Boolean).join(" · ")}</Text><Badge label={ids.has(p.athleteId) ? "ON TEAM" : "ADD"} tone="primary" /></Pressable>)}
      </Card>
      {FANTASY_ROSTER_SLOTS.filter((slot) => slot !== "IR" || defaultRoster.players.some((p) => p.rosterSlot === slot)).map((slot) => {
        const players = defaultRoster.players.filter((p) => p.rosterSlot === slot);
        return <Card key={slot} style={{ gap: 8 }}><Text style={{ color: colors.primary, fontFamily: FONT.bold }}>{SLOT_LABEL[slot]}</Text>{players.length ? players.map((p) => <View key={p.athleteId} style={{ gap: 7, borderTopWidth: 1, borderColor: colors.border, paddingTop: 8 }}><View><Text style={{ color: colors.foreground, fontFamily: FONT.semibold }}>{p.name}</Text><Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>{[p.position, p.team ?? "Team unavailable", injuries[p.name.trim().toLowerCase()]].filter(Boolean).join(" · ")}</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}><Pill label="Start/Sit" active={false} onPress={() => askCoach(`Should I start or sit ${p.name} from my saved fantasy roster? Use only supported data.`)} /><Pill label="Compare" active={false} onPress={() => askCoach(`Compare ${p.name} with my saved fantasy roster for a start/sit decision using only supported data.`)} /><Pill label="Should I Trade?" active={false} onPress={() => askCoach(`Analyze whether I should trade ${p.name} from my saved fantasy roster. State unavailable data honestly.`)} /><Pill label="Remove" active={false} onPress={() => removePlayer(p.athleteId)} />{FANTASY_ROSTER_SLOTS.filter((candidate) => candidate !== slot).map((candidate) => <Pill key={candidate} label={`Move ${SLOT_LABEL[candidate]}`} active={false} onPress={() => movePlayer(p.athleteId, candidate)} />)}</ScrollView></View>) : <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12 }}>No players assigned</Text>}</Card>;
      })}
    </ScrollView>
  </View>;
}
