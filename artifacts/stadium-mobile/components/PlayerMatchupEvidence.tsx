import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { getPlayerHistory, getTeamDefense, searchTeam } from "@/lib/api";
import { explainMatchup } from "@/lib/matchupEvidence";
import { resolveEvidenceSides } from "@/lib/playerMatchupContext";

/** Read-only, shared by Player Props and Coach. Fetch only after explicit expansion. */
export function PlayerMatchupEvidence(p: {
  position?: string | null;
  sport: string; athleteId?: string | null; playerTeamId?: string | null;
  game: string; startsAt?: string | null; market: string; line: number; side: "Over" | "Under";
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const history = useQuery({
    queryKey: ["player-history", p.sport, p.athleteId, null],
    enabled: expanded && !!p.sport && !!p.athleteId,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) => getPlayerHistory({ sport: p.sport, athleteId: p.athleteId! }, signal),
  });
  const context = useQuery({
    queryKey: ["player-matchup-evidence", p.sport, p.game, p.playerTeamId, "positions-v1"],
    enabled: expanded && !!p.playerTeamId && !!p.sport,
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
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)}>
      <Text style={{ color: colors.primary, fontWeight: "600" }}>{expanded ? "Hide matchup evidence" : "Why this matchup · evidence & cautions"}</Text>
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
