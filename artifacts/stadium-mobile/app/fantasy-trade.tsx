import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Card, FONT, Pill } from "@/components/ui";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { useColors } from "@/hooks/useColors";
import { getFantasyNflPlayerHistory, getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { historicalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";
import { analyzeFantasyTrade, type FantasyTradeAnalysis } from "@/lib/fantasyTrade";
import { preselectedTradeGiveIds } from "@/lib/fantasyTradeRoute";
import { blockOtaReload } from "@/lib/otaBlock";

export function canAnalyzeTrade(giveCount: number, receiveCount: number) {
  return giveCount > 0 && receiveCount > 0;
}

export default function FantasyTradeScreen() {
  const colors = useColors(); const router = useRouter();
  const { defaultRoster, rosters, saveTradeAnalysis } = useFantasyRoster();
  const { giveId } = useLocalSearchParams<{ giveId?: string }>();
  const [give, setGive] = useState<string[]>([]); const [receive, setReceive] = useState<PlayerSearchResult[]>([]);
  const [query, setQuery] = useState(""); const [results, setResults] = useState<PlayerSearchResult[]>([]); const [trade, setTrade] = useState<FantasyTradeAnalysis | null>(null); const [searching, setSearching] = useState(false);
  const rosterById = useMemo(() => new Map(defaultRoster.players.map(p => [p.athleteId, p])), [defaultRoster.players]);
  useEffect(() => { setGive(current => preselectedTradeGiveIds(current, giveId, new Set(rosterById.keys()))); }, [giveId, rosterById]);
  const toggleGive = (id: string) => setGive(current => current.includes(id) ? current.filter(x => x !== id) : current.length < 2 ? [...current, id] : current);
  const toggleReceive = (p: PlayerSearchResult) => setReceive(current => current.some(x => x.athleteId === p.athleteId) ? current.filter(x => x.athleteId !== p.athleteId) : current.length < 2 ? [...current, p] : current);
  const findPlayers = async () => { if (!query.trim()) return; setSearching(true); try { setResults((await searchPlayer(query, undefined, { rawMessage: query })).results.filter(p => p.sport === "nfl")); } catch { setResults([]); } finally { setSearching(false); } };
  const run = async () => { const release = blockOtaReload(); try { const givePlayers = give.map(id => rosterById.get(id)!).filter(Boolean); const receivePlayers = receive.map(p => ({ athleteId:p.athleteId,name:p.name,team:p.team,headshot:p.headshot,position:p.position,rosterSlot:"Bench" as const,dateAdded:Date.now() })); const all = [...givePlayers, ...receivePlayers]; const rows = await Promise.all(all.map(async p => [p.athleteId, historicalFantasyAnalysis((await getFantasyNflPlayerHistory(p.athleteId)).games, defaultRoster.scoringFormat)] as const)); const injuries = await getInjuries("nfl").then(teams => Object.fromEntries(teams.flatMap(t => t.entries.map(e => [e.player.toLowerCase(), e.status])))).catch(() => ({})); const next = analyzeFantasyTrade({ give:givePlayers, receive:receivePlayers, roster:defaultRoster, analysis:Object.fromEntries(rows), injuries }); setTrade(next); saveTradeAnalysis(next); } finally { release(); } };
  const canAnalyze = canAnalyzeTrade(give.length, receive.length);
  return <View style={{ flex: 1, backgroundColor: colors.background }}><AppHeader/><ScrollView contentContainerStyle={{ padding:16, gap:12, paddingBottom:36 }} keyboardShouldPersistTaps="handled">
    <Card style={{gap:5}}><Text style={{color:colors.foreground,fontFamily:FONT.display,fontSize:22}}>Should I Trade?</Text><Text style={{color:colors.mutedForeground,fontFamily:FONT.body,fontSize:13}}>Based on recent performance, injuries, and roster fit</Text></Card>
    <Card style={{gap:8}}><Text style={{color:colors.primary,fontFamily:FONT.bold,fontSize:12}}>PLAYERS YOU GIVE (UP TO 2)</Text>{defaultRoster.players.map(p=><Pill key={p.athleteId} label={p.name} active={give.includes(p.athleteId)} onPress={()=>toggleGive(p.athleteId)}/>)}</Card>
    <Card style={{gap:9}}><Text style={{color:colors.primary,fontFamily:FONT.bold,fontSize:12}}>PLAYERS YOU RECEIVE (UP TO 2)</Text><View style={{flexDirection:"row",gap:8}}><TextInput accessibilityLabel="Search receive player" value={query} onChangeText={setQuery} placeholder="Search NFL player" placeholderTextColor={colors.mutedForeground} style={{flex:1,color:colors.foreground,borderWidth:1,borderColor:colors.border,borderRadius:10,paddingHorizontal:12,paddingVertical:10,fontFamily:FONT.body}}/><Pressable accessibilityLabel="Search receive players" onPress={findPlayers} style={{backgroundColor:colors.primary,borderRadius:10,paddingHorizontal:14,justifyContent:"center"}}>{searching?<ActivityIndicator color={colors.primaryForeground}/>:<Feather name="search" color={colors.primaryForeground} size={18}/>}</Pressable></View>{results.map(p=><Pill key={p.athleteId} label={`${p.name}${p.position?` · ${p.position}`:""}`} active={receive.some(x=>x.athleteId===p.athleteId)} onPress={()=>toggleReceive(p)}/>)}</Card>
    <Pressable accessibilityLabel="Analyze Trade" disabled={!canAnalyze} onPress={run} style={{backgroundColor:canAnalyze?colors.primary:colors.card,borderWidth:canAnalyze?0:1,borderColor:colors.border,borderRadius:10,minHeight:48,alignItems:"center",justifyContent:"center",opacity:canAnalyze?1:.65}}><Text style={{color:canAnalyze?colors.primaryForeground:colors.mutedForeground,fontFamily:FONT.bold}}>Analyze Trade</Text></Pressable>
    {trade&&<Card style={{gap:6}}><Text style={{color:colors.foreground,fontFamily:FONT.display,fontSize:20}}>{trade.verdict}</Text><Text style={{color:colors.mutedForeground}}>Give: {trade.giveRecentPoints?.toFixed(1)??"Unavailable"} recent fantasy points/game</Text><Text style={{color:colors.mutedForeground}}>Receive: {trade.receiveRecentPoints?.toFixed(1)??"Unavailable"} recent fantasy points/game</Text><Text style={{color:colors.mutedForeground}}>{trade.rosterNeed}</Text><Text style={{color:colors.mutedForeground}}>{trade.explanation}</Text></Card>}
    {(rosters.tradeHistory??[]).length>0&&<Card><Text style={{color:colors.foreground,fontFamily:FONT.bold}}>Recent Trades</Text>{rosters.tradeHistory!.map(t=><Pressable key={t.id} onPress={()=>setTrade(t)}><Text style={{color:colors.primary}}>{new Date(t.createdAt).toLocaleDateString()} · {t.verdict}</Text></Pressable>)}</Card>}
    <Pressable accessibilityLabel="Back to My Fantasy Team" onPress={()=>router.back()} style={{borderWidth:1,borderColor:colors.border,borderRadius:10,minHeight:46,alignItems:"center",justifyContent:"center"}}><Text style={{color:colors.primary,fontFamily:FONT.semibold}}>Back to My Fantasy Team</Text></Pressable>
  </ScrollView></View>;
}
