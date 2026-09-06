import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Card, FONT } from "@/components/ui";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { FANTASY_ROSTER_SLOTS, positionEligibleForSlot, type FantasyRosterSlot } from "@/lib/fantasyRoster";

const STARTER_SLOTS: FantasyRosterSlot[] = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

export default function FantasyLineupScreen() {
  const colors = useColors(); const router = useRouter(); const { defaultRoster } = useFantasyRoster();
  const starters = useMemo(() => {
    const used = new Set<string>();
    return STARTER_SLOTS.map((slot) => {
      const player = defaultRoster.players.find((candidate) => !used.has(candidate.athleteId) && positionEligibleForSlot(candidate.position, slot));
      if (player) used.add(player.athleteId);
      return { slot, player };
    });
  }, [defaultRoster.players]);
  const missing = starters.filter((row) => !row.player).map((row) => row.slot);
  return <View style={{flex:1,backgroundColor:colors.background}}><AppHeader/><ScrollView contentContainerStyle={{padding:16,gap:12,paddingBottom:36}}>
    <Card style={{gap:5}}><Text style={{color:colors.foreground,fontFamily:FONT.display,fontSize:22}}>Best Lineup This Week</Text><Text style={{color:colors.mutedForeground,fontFamily:FONT.body}}>Uses only your saved roster and {defaultRoster.scoringFormat.toUpperCase()} scoring.</Text></Card>
    {starters.map(({slot,player})=><Card key={slot} style={{gap:4}}><Text style={{color:colors.primary,fontFamily:FONT.bold,fontSize:12}}>{slot}</Text>{player?<><Text style={{color:colors.foreground,fontFamily:FONT.semibold,fontSize:17}}>{player.name}</Text><Text style={{color:colors.mutedForeground}}>{[player.position,player.team].filter(Boolean).join(" · ")}</Text><Text style={{color:colors.mutedForeground,fontFamily:FONT.body,fontSize:12}}>START — recorded production and weekly matchup data are unavailable for this player.</Text></>:<Text style={{color:colors.mutedForeground}}>Missing eligible {slot} player on your saved roster.</Text>}</Card>)}
    {missing.length?<Card><Text style={{color:colors.mutedForeground}}>Incomplete roster: {missing.join(", ")} cannot be filled from saved players.</Text></Card>:null}
    <Card><Text style={{color:colors.mutedForeground}}>Matchup ranking unavailable — recommendations use saved-roster eligibility. Add supported player data for production, usage, injury, opponent, and projections.</Text></Card>
    <Pressable onPress={()=>router.back()} style={{borderWidth:1,borderColor:colors.border,borderRadius:10,minHeight:46,alignItems:"center",justifyContent:"center"}}><Text style={{color:colors.primary,fontFamily:FONT.semibold}}>Back to My Fantasy Team</Text></Pressable>
  </ScrollView></View>;
}
