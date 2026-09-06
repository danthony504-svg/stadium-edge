import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Card, FONT, Pill } from "@/components/ui";
import { useFantasyRoster } from "@/context/FantasyRosterContext";
import { getFantasyNflPlayerHistory, getInjuries, searchPlayer, type PlayerSearchResult } from "@/lib/api";
import { historicalFantasyAnalysis } from "@/lib/fantasyNflAnalysis";

export default function FantasyStartSitScreen() {
  const router=useRouter(); const { playerAId }=useLocalSearchParams<{playerAId?:string}>(); const {defaultRoster}=useFantasyRoster();
  const [playerB,setPlayerB]=useState<PlayerSearchResult|null>(null); const [query,setQuery]=useState(""); const [results,setResults]=useState<PlayerSearchResult[]>([]); const [result,setResult]=useState<string|null>(null);
  const playerA=defaultRoster.players.find(p=>p.athleteId===playerAId)??null;
  const compare=async()=>{if(!playerA||!playerB)return; const [a,b,inj]=await Promise.all([getFantasyNflPlayerHistory(playerA.athleteId),getFantasyNflPlayerHistory(playerB.athleteId),getInjuries("nfl")]);const aa=historicalFantasyAnalysis(a.games,defaultRoster.scoringFormat).recentAverage,bb=historicalFantasyAnalysis(b.games,defaultRoster.scoringFormat).recentAverage;const injured=new Set(inj.flatMap(t=>t.entries.filter(e=>!/active|healthy/i.test(e.status)).map(e=>e.player.toLowerCase())));setResult(aa==null||bb==null?"INSUFFICIENT DATA":injured.has(playerA.name.toLowerCase())||injured.has(playerB.name.toLowerCase())?"TOO CLOSE":aa>bb+1?"START PLAYER A":bb>aa+1?"START PLAYER B":"TOO CLOSE");};
  return <View style={{flex:1}}><AppHeader/><ScrollView contentContainerStyle={{padding:16,gap:12}}><Card><Text style={{fontFamily:FONT.display,fontSize:22}}>Start / Sit</Text><Text>Uses recorded NFL production and injury status only.</Text></Card><Card><Text style={{fontFamily:FONT.bold}}>Player A</Text><Text>{playerA?.name??"Saved player unavailable"}</Text></Card><Card><Text style={{fontFamily:FONT.bold}}>Player B</Text><TextInput value={query} onChangeText={setQuery} placeholder="Search NFL player"/><Pressable onPress={async()=>setResults((await searchPlayer(query,undefined,{rawMessage:query})).results.filter(p=>p.sport==="nfl"))}><Text>Search</Text></Pressable>{results.map(p=><Pill key={p.athleteId} label={p.name} active={playerB?.athleteId===p.athleteId} onPress={()=>setPlayerB(p)}/>)}</Card><Pressable onPress={compare}><Text>Compare players</Text></Pressable>{result&&<Card><Text style={{fontFamily:FONT.display,fontSize:20}}>{result}</Text><Text>Based on recent performance, injuries, and supported recorded data.</Text></Card>}<Pressable onPress={()=>router.back()}><Text>Back to My Fantasy Team</Text></Pressable></ScrollView></View>;
}
