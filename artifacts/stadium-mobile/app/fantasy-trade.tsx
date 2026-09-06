import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Card, FONT, Pill } from "@/components/ui";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { getFantasyNflPlayerHistory, getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { historicalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";
import { analyzeFantasyTrade, type FantasyTradeAnalysis } from "@/lib/fantasyTrade";
import { preselectedTradeGiveIds } from "@/lib/fantasyTradeRoute";
import { blockOtaReload } from "@/lib/otaBlock";

export default function FantasyTradeScreen() {
  const router = useRouter(); const { defaultRoster, rosters, saveTradeAnalysis } = useFantasyRoster();
  const { giveId } = useLocalSearchParams<{ giveId?: string }>();
  const [give, setGive] = useState<string[]>([]); const [receive, setReceive] = useState<PlayerSearchResult[]>([]);
  const [query, setQuery] = useState(""); const [results, setResults] = useState<PlayerSearchResult[]>([]); const [trade, setTrade] = useState<FantasyTradeAnalysis | null>(null);
  const rosterById = useMemo(() => new Map(defaultRoster.players.map(p => [p.athleteId, p])), [defaultRoster.players]);
  useEffect(() => {
    setGive((current) => preselectedTradeGiveIds(current, giveId, new Set(rosterById.keys())));
  }, [giveId, rosterById]);
  const toggleGive = (id: string) => setGive(current => current.includes(id) ? current.filter(x => x !== id) : current.length < 2 ? [...current, id] : current);
  const toggleReceive = (p: PlayerSearchResult) => setReceive(current => current.some(x => x.athleteId === p.athleteId) ? current.filter(x => x.athleteId !== p.athleteId) : current.length < 2 ? [...current, p] : current);
  const run = async () => {
    const releaseOtaBlock = blockOtaReload();
    try {
    const givePlayers = give.map(id => rosterById.get(id)!).filter(Boolean);
    const receivePlayers = receive.map(p => ({ athleteId:p.athleteId,name:p.name,team:p.team,headshot:p.headshot,position:p.position,rosterSlot:"Bench" as const,dateAdded:Date.now() }));
    const all = [...givePlayers, ...receivePlayers]; const rows = await Promise.all(all.map(async p => [p.athleteId, historicalFantasyAnalysis((await getFantasyNflPlayerHistory(p.athleteId)).games, defaultRoster.scoringFormat)] as const));
    const injuries = await getInjuries("nfl").then(teams => Object.fromEntries(teams.flatMap(t => t.entries.map(e => [e.player.toLowerCase(), e.status])))).catch(() => ({}));
    const next = analyzeFantasyTrade({ give:givePlayers, receive:receivePlayers, roster:defaultRoster, analysis:Object.fromEntries(rows), injuries }); setTrade(next); saveTradeAnalysis(next);
    } finally {
      releaseOtaBlock();
    }
  };
  return <View style={{flex:1}}><AppHeader/><ScrollView contentContainerStyle={{padding:16,gap:12}}><Card><Text style={{fontFamily:FONT.display,fontSize:22}}>Should I Trade?</Text><Text style={{fontFamily:FONT.body}}>Based on recent performance, injuries, and roster fit</Text></Card>
    <Card style={{gap:8}}><Text style={{fontFamily:FONT.bold}}>Players you give (up to 2)</Text>{defaultRoster.players.map(p=><Pill key={p.athleteId} label={p.name} active={give.includes(p.athleteId)} onPress={()=>toggleGive(p.athleteId)}/>)}</Card>
    <Card style={{gap:8}}><Text style={{fontFamily:FONT.bold}}>Players you receive (up to 2)</Text><View style={{flexDirection:"row"}}><TextInput value={query} onChangeText={setQuery} placeholder="Search NFL players" style={{flex:1}}/><Pressable onPress={async()=>setResults((await searchPlayer(query,undefined,{rawMessage:query})).results.filter(p=>p.sport==="nfl"))}><Text>Search</Text></Pressable></View>{results.map(p=><Pill key={p.athleteId} label={p.name} active={receive.some(x=>x.athleteId===p.athleteId)} onPress={()=>toggleReceive(p)}/>)}</Card>
    <Pressable disabled={!give.length||!receive.length} onPress={run}><Text>Analyze trade</Text></Pressable>
    {trade&&<Card style={{gap:6}}><Text style={{fontFamily:FONT.display,fontSize:20}}>{trade.verdict}</Text><Text>Give: {trade.giveRecentPoints?.toFixed(1) ?? "Unavailable"} recent fantasy points/game</Text><Text>Receive: {trade.receiveRecentPoints?.toFixed(1) ?? "Unavailable"} recent fantasy points/game</Text><Text>{trade.rosterNeed}</Text><Text>{trade.injuredPlayers.length?`Injury risk: ${trade.injuredPlayers.join(", ")}`:"No reported injury status in this analysis."}</Text><Text>{trade.explanation}</Text></Card>}
    {(rosters.tradeHistory??[]).length>0&&<Card><Text style={{fontFamily:FONT.bold}}>Recent Trades</Text>{rosters.tradeHistory!.map(t=><Pressable key={t.id} onPress={()=>setTrade(t)}><Text>{new Date(t.createdAt).toLocaleDateString()} · {t.verdict}</Text></Pressable>)}</Card>}
  </ScrollView></View>;
}
