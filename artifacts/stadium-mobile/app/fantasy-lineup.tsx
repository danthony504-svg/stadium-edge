import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Card, FONT } from "@/components/ui";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { FANTASY_ROSTER_SLOTS, positionEligibleForSlot, type FantasyRosterSlot } from "@/lib/fantasyRoster";
import { getFantasyNflPlayerHistory, getInjuries } from "@/lib/api";
import { historicalFantasyAnalysis, type HistoricalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";
import { selectFantasyStarter } from "@/lib/fantasyRecommendation";

const STARTER_SLOTS: FantasyRosterSlot[] = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

export default function FantasyLineupScreen() {
  const colors = useColors(); const router = useRouter(); const { defaultRoster } = useFantasyRoster();
  const [analysis, setAnalysis] = useState<Record<string, HistoricalFantasyAnalysis | undefined>>({});
  const [injuries, setInjuries] = useState<Record<string, string | undefined>>({});
  useEffect(() => { void Promise.all([
    Promise.all(defaultRoster.players.map(async (player) => [player.athleteId, historicalFantasyAnalysis((await getFantasyNflPlayerHistory(player.athleteId)).games, defaultRoster.scoringFormat)] as const)),
    getInjuries("nfl"),
  ]).then(([rows, teams]) => { setAnalysis(Object.fromEntries(rows)); setInjuries(Object.fromEntries(teams.flatMap((team) => team.entries.map((entry) => [entry.player.toLowerCase(), entry.status])))); }).catch(() => {}); }, [defaultRoster.players, defaultRoster.scoringFormat]);
  const starters = useMemo(() => {
    const used = new Set<string>();
    return STARTER_SLOTS.map((slot) => {
      const selected = selectFantasyStarter(defaultRoster.players.filter((candidate) => !used.has(candidate.athleteId)), slot, analysis, injuries);
      if (selected.winner) used.add(selected.winner.player.athleteId);
      return { slot, player: selected.winner?.player, recommendation: selected.winner?.recommendation, alternative: selected.alternative?.player };
    });
  }, [analysis, defaultRoster.players, injuries]);
  const missing = starters.filter((row) => !row.player).map((row) => row.slot);
  return <View style={{flex:1,backgroundColor:colors.background}}><AppHeader/><ScrollView contentContainerStyle={{padding:16,gap:12,paddingBottom:36}}>
    <Card style={{gap:5}}><Text style={{color:colors.foreground,fontFamily:FONT.display,fontSize:22}}>Best Lineup This Week</Text><Text style={{color:colors.mutedForeground,fontFamily:FONT.body}}>Uses only your saved roster and {defaultRoster.scoringFormat.toUpperCase()} scoring.</Text></Card>
    {starters.map(({slot,player,recommendation,alternative})=><Card key={slot} style={{gap:4}}><Text style={{color:colors.primary,fontFamily:FONT.bold,fontSize:12}}>{slot}</Text>{player?<><Text style={{color:colors.foreground,fontFamily:FONT.semibold,fontSize:17}}>{player.name}</Text><Text style={{color:colors.mutedForeground}}>{[player.position,player.team].filter(Boolean).join(" · ")}</Text><Text style={{color:colors.mutedForeground,fontFamily:FONT.body,fontSize:12}}>START — {recommendation?.reason}</Text>{slot==="FLEX"&&alternative?<Text style={{color:colors.mutedForeground,fontFamily:FONT.body,fontSize:12}}>Start {player.name} over {alternative.name}</Text>:null}</>:<Text style={{color:colors.mutedForeground}}>Missing eligible {slot} player on your saved roster.</Text>}</Card>)}
    {missing.length?<Card><Text style={{color:colors.mutedForeground}}>Incomplete roster: {missing.join(", ")} cannot be filled from saved players.</Text></Card>:null}
    <Card><Text style={{color:colors.mutedForeground}}>Matchup ranking unavailable — recommendations use saved-roster eligibility. Add supported player data for production, usage, injury, opponent, and projections.</Text></Card>
    <Pressable onPress={()=>router.back()} style={{borderWidth:1,borderColor:colors.border,borderRadius:10,minHeight:46,alignItems:"center",justifyContent:"center"}}><Text style={{color:colors.primary,fontFamily:FONT.semibold}}>Back to My Fantasy Team</Text></Pressable>
  </ScrollView></View>;
}
