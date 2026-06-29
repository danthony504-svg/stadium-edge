import Svg, { Polyline } from "react-native-svg";

type Props = {
  series: number[];
  width?: number;
  height?: number;
  color?: string;
};

/** Real rolling win-rate sparkline (0–100). Renders nothing until ≥2 points. */
export function PerformanceSparkline({
  series,
  width = 92,
  height = 52,
  color = "#3b82f6",
}: Props) {
  if (series.length < 2) return null;

  const padY = 4;
  const innerH = height - padY * 2;
  const points = series
    .map((value, i) => {
      const x = (i / (series.length - 1)) * width;
      const clamped = Math.max(0, Math.min(100, value));
      const y = padY + innerH - (clamped / 100) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
