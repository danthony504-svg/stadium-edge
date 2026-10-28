import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { getPlayerHistory, getTeamDefense, searchTeam } from "@/lib/api";
import { explainMatchup } from "@/lib/matchupEvidence";
import { resolveEvidenceSides } from "@/lib/playerMatchupContext";

/** Read-only, shared by Player Props and Coach. Show evidence on delivered cards; requests do not block ticket construction. */
export function PlayerMatchupEvidence(p: {
  position?: string | null;
  sport: string; athleteId?: string | null; playerTeamId?: string | null;
  game: string; startsAt?: string | null; market: string; line: number; side: "Over" | "Under";
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const history = useQuery({
    queryKey: ["player-history", p.sport, p.athleteId, null],
    enabled: !!p.sport && !!p.athleteId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getPlayerHistory({ sport: p.sport, athleteId: p.athleteId! }, signal),
  });
  const context = useQuery({
    queryKey: ["player-matchup-evidence", p.sport, p.game, p.playerTeamId, "positions-v2"],
    enabled: !!p.playerTeamId && !!p.sport,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const names = p.game.split(/\s+(?:@|vs\.?|at)\s+/i);
      if (names.length !== 2) return null;
      const [a, h] = await Promise.all(names.map(n => searchTeam(n, signal)));
      const sides = resolveEvidenceSides(p.sport, p.playerTeamId, names[0]!, names[1]!, [...a.results, ...h.results]);
      if (!sides) return null;
      const defense = await getTeamDefense(p.sport, sides.opponent.teamId, signal, true);
      return { ...sides, defense };
    },
  });
  const evidence = explainMatchup({
    position: p.position,
    sport: p.sport, athleteId: p.athleteId ?? null, market: p.market, line: p.line, side: p.side,
    startsAt: p.startsAt ?? "", history: history.data,
    isHome: context.data?.isHome, opponentId: context.data?.opponent.teamId,
    opponentName: context.data?.opponent.name ?? "Opponent", opponentDefense: context.data?.defense,
  });
  const style = { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 };
  return <View style={{ padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 16 }}>
    <Text style={{ color: colors.foreground, fontWeight: "600" }}>Why this matchup</Text>
    {evidence.observations.filter(t => t.startsWith("Exact-market history:") || t.startsWith("Playing time:") || t.includes("allowed at least one opposing")).slice(0, 3).map((t, i) => <Text key={`key${i}`} style={style}>{t.startsWith("Exact-market history:") ? t.replace("Exact-market history:", "Recent form:").replace(/ \(last .*$/, ".") : t.startsWith("Playing time:") ? t.replace(/; logged MIN\)/, ")").replace(/ Future minutes.*$/, "") : t.replace(/ with complete verified.*$/, ". Each game counts once; not a player hit rate.")}</Text>)}
    {(history.isFetching || context.isFetching) && <Text style={style}>Loading matchup highlights…</Text>}
    {(history.isError || context.isError) && <Text style={style}>Some evidence could not load.</Text>}
    <Text style={style}>Historical results; calibration unverified. {evidence.missing.length > 0 ? `${evidence.missing.length} evidence gaps — see details.` : ""}</Text>
    <Pressable style={{ minHeight: 44, justifyContent: "center" }} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)}>
      <Text style={{ color: colors.primary, fontWeight: "600" }}>{expanded ? "Read less" : "Read more · full evidence & cautions"}</Text>
    </Pressable>
    {expanded && <>
      {(history.isFetching || context.isFetching) && <Text style={style}>Loading verified matchup evidence…</Text>}
      {(history.isError || context.isError) && <Text style={style}>Some evidence could not load. No missing data is inferred.</Text>}
      {evidence.observations.map((t, i) => <Text key={`o${i}`} style={style}>{t}</Text>)}
      <Text style={style}>CAUTIONS</Text>
      {evidence.cautions.map((t, i) => <Text key={`c${i}`} style={style}>{t}</Text>)}
      <Text style={style}>MISSING EVIDENCE</Text>
      {evidence.missing.map((t, i) => <Text key={`m${i}`} style={style}>{t}</Text>)}
      <Text style={style}>{evidence.source}</Text>
    </>}
  </View>;
}
