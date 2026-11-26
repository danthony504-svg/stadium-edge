import { rng } from "./sportSim/eventKernels.js";

export function wilson95(hits: number, count: number): [number, number] | null {
  if (count === 0) return null;
  const p = hits / count, z = 1.959963984540054;
  const scale = 1 + z ** 2 / count;
  const center = (p + z ** 2 / (2 * count)) / scale;
  const half = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * count)) / count) / scale;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

type GamePair = { baselineLoss: number; selectedLoss: number; outcomes: number };

export function pairedGameLossBootstrap(pairs: readonly GamePair[], draws = 20_000) {
  if (!pairs.length) return null;
  const sum = pairs.reduce((total, row) => ({
    baselineLoss: total.baselineLoss + row.baselineLoss,
    selectedLoss: total.selectedLoss + row.selectedLoss,
    outcomes: total.outcomes + row.outcomes,
  }), { baselineLoss: 0, selectedLoss: 0, outcomes: 0 });
  const gain = (sum.baselineLoss - sum.selectedLoss) / sum.outcomes;
  const result = { games: pairs.length, outcomes: sum.outcomes, gain,
    relativeGainPct: sum.baselineLoss > 0 ? 100 * gain * sum.outcomes / sum.baselineLoss : null };
  if (pairs.length < 2) return { ...result, interval95: null, relativeInterval95: null, draws: 0 };
  const random = rng(84101);
  const gains: number[] = [], relative: number[] = [];
  for (let replicate = 0; replicate < draws; replicate++) {
    let baseline = 0, selected = 0, outcomes = 0;
    for (let game = 0; game < pairs.length; game++) {
      const row = pairs[Math.floor(random() * pairs.length)]!;
      baseline += row.baselineLoss;
      selected += row.selectedLoss;
      outcomes += row.outcomes;
    }
    gains.push((baseline - selected) / outcomes);
    if (baseline > 0) relative.push(100 * (baseline - selected) / baseline);
  }
  const interval = (values: number[]): [number, number] | null => {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    return [values[Math.floor(.025 * (values.length - 1))]!, values[Math.ceil(.975 * (values.length - 1))]!];
  };
  return { ...result, interval95: interval(gains), relativeInterval95: interval(relative), draws };
}
