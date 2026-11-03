/** Exact empirical full-game total queries over an immutable saved draw set.
 * Prices, grades and gates are never cached. Period/race/spread paths bypass.
 */
import type { GameCoverQuery } from './gameSimScoring.ts';
type Outcomes = { homeScores: number[]; awayScores: number[] };
type Index = { home: number[]; away: number[]; length: number; series: Map<string, number[]> };
const indexes = new WeakMap<Outcomes, Index>();

export function fullGameTotalHitRate(outcomes: Outcomes, q: GameCoverQuery): number | undefined {
  if ((q.period != null && q.period !== 'fg') || !['total', 'teamTotal'].includes(q.kind)) return undefined;
  const n = outcomes.homeScores.length;
  if (!n || n !== outcomes.awayScores.length) return undefined;
  if (q.totalSide !== 'over' && q.totalSide !== 'under') return 0;
  const line = q.line ?? 0;
  if (Number.isNaN(line)) return 0;
  let index = indexes.get(outcomes);
  if (!index || index.home !== outcomes.homeScores || index.away !== outcomes.awayScores || index.length !== n) {
    index = { home: outcomes.homeScores, away: outcomes.awayScores, length: n, series: new Map() };
    indexes.set(outcomes, index);
  }
  const key = q.kind === 'total' ? 'total' : q.teamSide === 'home' ? 'home' : 'away';
  let values = index.series.get(key);
  if (!values) {
    values = [];
    for (let i = 0; i < n; i++) {
      const h = outcomes.homeScores[i]!, a = outcomes.awayScores[i]!;
      // Match coverQueryHits: invalid pairs cannot hit, but remain in denominator.
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
      values.push(key === 'total' ? h + a : key === 'home' ? h : a);
    }
    values.sort((a,b) => a-b);
    index.series.set(key, values);
  }
  let lo = 0, hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // upper_bound for Over (strict >); lower_bound for Under (strict <).
    if (q.totalSide === 'over' ? values[mid]! <= line : values[mid]! < line) lo = mid + 1;
    else hi = mid;
  }
  const hits = q.totalSide === 'over' ? values.length - lo : lo;
  return Math.round((hits / n) * 1000) / 1000;
}
