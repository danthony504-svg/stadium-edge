import { Text, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { Card, FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import type { GameCoverQueryInput, NbaPossessionDetails } from "@/lib/api";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const signed = (number: number) => number > 0 ? `+${number}` : String(number);

export function NbaPossessionSummary({ data, home, away, lines }: {
  data: NbaPossessionDetails;
  home: string;
  away: string;
  lines: GameCoverQueryInput[];
}) {
  const colors = useColors();
  const spread = lines.find(line => line.kind === "spread" && line.teamSide === "home") ??
    lines.find(line => line.kind === "spread" && line.teamSide === "away");
  const postedMargin = spread?.line == null ? null : spread.line * (spread.teamSide === "home" ? -1 : 1);
  const histogram = data.marginHistogram;
  const start = Math.min(histogram[0]?.from ?? 0, postedMargin ?? Infinity);
  const end = Math.max((histogram.at(-1)?.through ?? 0) + 1, postedMargin ?? -Infinity);
  const peak = Math.max(1, ...histogram.map(bin => bin.count));
  const x = (score: number) => (score - start) / Math.max(1, end - start) * 280 + 4;
  const headline = { color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 };
  const detail = { color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 };
  return (
    <View style={{ gap: 12, marginBottom: 16 }}>
      <Card style={{ gap: 8 }}>
        <Text style={headline}>Final margin distribution</Text>
        <Text style={detail}>{home} score minus {away} score · middle 80% from {signed(data.marginRange80[0])} to {signed(data.marginRange80[1])}</Text>
        <Svg width="100%" height={100} viewBox="0 0 288 100" accessible accessibilityLabel="Histogram of simulated final margins">
          {histogram.map(bin => {
            const height = bin.count / peak * 90;
            return <Rect key={bin.from} x={x(bin.from)} y={94 - height} width={Math.max(1, x(bin.through + 1) - x(bin.from) - 1)} height={height} fill={colors.primary} />;
          })}
          {postedMargin != null && <Line x1={x(postedMargin)} x2={x(postedMargin)} y1={0} y2={98} stroke={colors.foreground} strokeWidth={2} />}
        </Svg>
        <Text style={detail}>{signed(start)} to {signed(end - 1)}{postedMargin != null ? ` · marker at ${signed(postedMargin)} for the posted spread` : ""}</Text>
        <Text style={detail}>{home} win chance · 80% range {data.homeWinRange80.map(percent).join(" to ")}</Text>
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
        <Text style={detail}>Research estimates · {data.ratingDraws} rating sets × {data.gamesPerRating} games</Text>
      </Card>
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
