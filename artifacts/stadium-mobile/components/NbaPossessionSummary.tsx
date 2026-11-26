import { Text, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { EventSimulationDetails, GameCoverQueryInput, NbaPossessionDetails } from "@/lib/api";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (number: number) => number > 0 ? `+${number}` : String(number);

type Matchup = { home: string; away: string; lines: GameCoverQueryInput[] };

function ModelDistribution({ data, home, away, lines, drawProbability }: Matchup & {
  data: NbaPossessionDetails | EventSimulationDetails;
  drawProbability?: number | null;
}) {
  const colors = useColors();
  const spread = lines.find(line => line.kind === "spread" && line.teamSide === "home") ??
    lines.find(line => line.kind === "spread" && line.teamSide === "away");
  const postedMargin = spread?.line == null ? null : spread.line * (spread.teamSide === "home" ? -1 : 1);
  const totalLine = !spread && "totalHistogram" in data ? lines.find(line => line.kind === "total")?.line : null;
  const marginChart = totalLine == null || !("totalHistogram" in data);
  const histogram = marginChart || !("totalHistogram" in data) ? data.marginHistogram : data.totalHistogram;
  const marker = marginChart ? postedMargin : totalLine;
  const range = marginChart ? data.marginRange80 : data.totalRange80;
  const start = Math.min(histogram[0]?.from ?? 0, marker ?? Infinity);
  const end = Math.max((histogram.at(-1)?.through ?? 0) + 1, marker ?? -Infinity);
  const peak = Math.max(1, ...histogram.map(bin => bin.count));
  const x = (score: number) => (score - start) / Math.max(1, end - start) * 280 + 4;
  const headline = { color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 };
  const detail = { color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 };
  return (
      <Card style={{ gap: 8 }}>
        <Text style={headline}>{marginChart ? "Final margin distribution" : "Final total distribution"}</Text>
        <Text style={detail}>{marginChart ? `${home} score minus ${away} score` : "Combined score"} · middle 80% from {range[0]} to {range[1]}</Text>
        <Svg width="100%" height={100} viewBox="0 0 288 100" accessible accessibilityLabel={marginChart ? "Histogram of simulated final margins" : "Histogram of simulated final totals"}>
          {histogram.map(bin => {
            const height = bin.count / peak * 90;
            return <Rect key={bin.from} x={x(bin.from)} y={94 - height} width={Math.max(1, x(bin.through + 1) - x(bin.from) - 1)} height={height} fill={colors.primary} />;
          })}
          {marker != null && <Line x1={x(marker)} x2={x(marker)} y1={0} y2={98} stroke={colors.foreground} strokeWidth={2} />}
        </Svg>
        <Text style={detail}>{start} to {end - 1}{marker != null ? ` · posted ${marginChart ? "spread" : "total"} marker at ${marker}` : ""}</Text>
        <Text style={detail}>{home} win chance · 80% range {data.homeWinRange80?.map(percent).join(" to ") ?? "unavailable"}</Text>
        {lines.map(line => {
          const result = data.lines[line.id];
          if (!result || line.line == null) return null;
          const label = line.kind === "spread"
            ? `${line.teamSide === "home" ? home : away} ${signed(line.line)}`
            : `${line.totalSide === "over" ? "Over" : "Under"} ${line.line}`;
          return <Text key={line.id} style={detail}>
            {label} · {percent(result.win)} hit · 80% range {result.ci80.map(percent).join(" to ")}
            {Number.isInteger(line.line) ? ` · ${percent(result.push)} push` : ""}
          </Text>;
        })}
        {drawProbability != null && <Text style={detail}>Regulation draw · {percent(drawProbability)}</Text>}
        {"retirementProbability" in data && data.retirementProbability > 0 && (
          <Text style={detail}>Retirement in simulation · {percent(data.retirementProbability)}. Line estimates use completed matches.</Text>
        )}
        <Text style={detail}>Research estimates · 400 rating sets × 25 games</Text>
      </Card>
  );
}

export function NbaPossessionSummary({ data, home, away, lines }: Matchup & { data: NbaPossessionDetails }) {
  const colors = useColors();
  const headline = { color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 };
  const detail = { color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 };
  return (
    <View style={{ gap: 12, marginBottom: 16 }}>
      <ModelDistribution data={data} home={home} away={away} lines={lines} />
      <Card style={{ gap: 8 }}>
        <Text style={headline}>Replay box score</Text>
        {(["away", "home"] as const).map(side => (
          <View key={side} style={{ gap: 4 }}>
            <Text style={headline}>{side === "home" ? home : away} · {data.representative[side].reduce((sum, player) => sum + player.points, 0)} points</Text>
            {data.representative[side].filter(player => player.minutes > 0).map(player => (
              <Text key={player.id} style={detail}>{player.name} · {player.minutes} MIN · {player.points} PTS · {player.rebounds} REB · {player.assists} AST</Text>
            ))}
          </View>
        ))}
      </Card>
    </View>
  );
}

const statLabels: Record<string, string> = {
  points: "PTS", passYards: "PASS YDS", recYards: "REC YDS", rushYards: "RUSH YDS", targets: "TGT",
  td: "TD", runs: "R", hits: "H", strikeouts: "SO", pitcherK: "K", pa: "PA", goals: "G",
  shots: "SH", onTarget: "SOT", assists: "AST", servePoints: "SERVE PTS", aces: "ACE",
  doubleFaults: "DF", games: "GAMES", sets: "SETS",
};

export function EventSimulationSummary({ data, home, away, lines, drawProbability }: Matchup & {
  data: EventSimulationDetails; drawProbability: number | null;
}) {
  const colors = useColors();
  const detail = { color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 };
  return (
    <View style={{ gap: 12, marginBottom: 16 }}>
      <ModelDistribution data={data} home={home} away={away} lines={lines} drawProbability={drawProbability} />
      {!!data.setScoreRates?.length && <Card style={{ gap: 5 }}>
        <Text style={{ ...detail, color: colors.foreground }}>Set scores · {home} first</Text>
        {data.setScoreRates.map(row => <Text key={row.score} style={detail}>{row.score} · {percent(row.probability)}</Text>)}
      </Card>}
      {data.representative.teams.map((team, i) => (
        <Card key={i} style={{ gap: 4 }}>
          <Text style={{ ...detail, color: colors.foreground }}>{i === 0 ? home : away} replay stats</Text>
          {team.filter(player => Object.keys(player.stats).length > 0).map(player =>
            <Text key={player.id} style={detail}>{player.name} · {Object.entries(player.stats).map(([stat, count]) =>
              `${count} ${statLabels[stat] ?? stat}`).join(" · ")}</Text>,
          )}
        </Card>
      ))}
    </View>
  );
}
