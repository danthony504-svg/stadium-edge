import { nbaLineProbability, simulateNbaPossessions, summarizeNbaDraws, type NbaPregame } from "./nbaPossessionV3.js";

type BacktestGame = {
  snapshot: NbaPregame;
  final: { home: number; away: number; availableAt: number };
  open?: { homeSpread: number; availableAt: number };
  close?: {
    fairHomeWin: number;
    fairHomeCoverAtOpenLine?: number;
    homeSpread: number;
    availableAt: number;
  };
};

type Prediction = { p: number; actual: number; close?: number };
function scores(rows: readonly Prediction[]) {
  const average = (values: number[]) => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  const logLoss = (p: number, actual: number) => -Math.log(Math.max(1e-12, actual ? p : 1 - p));
  const paired = rows.filter(r => r.close != null);
  return {
    settled: rows.length,
    brier: average(rows.map(r => (r.p - r.actual) ** 2)),
    logLoss: average(rows.map(r => logLoss(r.p, r.actual))),
    paired: paired.length,
    pairedModelBrier: average(paired.map(r => (r.p - r.actual) ** 2)),
    pairedClosingBrier: average(paired.map(r => (r.close! - r.actual) ** 2)),
    pairedModelLogLoss: average(paired.map(r => logLoss(r.p, r.actual))),
    pairedClosingLogLoss: average(paired.map(r => logLoss(r.close!, r.actual))),
    calibration: Array.from({ length: 10 }, (_, i) => {
      const bucket = rows.filter(r => Math.min(9, Math.floor(r.p * 10)) === i);
      return { from: i / 10, count: bucket.length, forecast: average(bucket.map(r => r.p)), actual: average(bucket.map(r => r.actual)) };
    }),
  };
}

export function backtestNbaPossessions(games: readonly BacktestGame[]) {
  const ids = new Set<string>();
  const wins: Prediction[] = [], covers: Prediction[] = [];
  let marginWithin = 0, totalWithin = 0, pushes = 0, movement = 0, movementCount = 0;
  for (const { snapshot, final, open, close } of games) {
    const probability = (p: number) => Number.isFinite(p) && p > 0 && p < 1;
    if (ids.has(snapshot.eventId) || ![final.home, final.away].every(s => Number.isInteger(s) && s >= 0) ||
        final.home === final.away || !Number.isFinite(final.availableAt) || final.availableAt <= snapshot.startsAt ||
        (open && (!Number.isFinite(open.homeSpread) || !Number.isFinite(open.availableAt) || open.availableAt > snapshot.availableAt)) ||
        (close && (!Number.isFinite(close.homeSpread) || !probability(close.fairHomeWin) ||
          (close.fairHomeCoverAtOpenLine != null && (!open || !probability(close.fairHomeCoverAtOpenLine))) ||
          !Number.isFinite(close.availableAt) || close.availableAt <= snapshot.availableAt || close.availableAt >= snapshot.startsAt))) {
      throw new RangeError("Invalid or duplicate NBA backtest record");
    }
    ids.add(snapshot.eventId);
    const draws = simulateNbaPossessions(snapshot);
    const summary = summarizeNbaDraws(draws, [], false);
    const margin = final.home - final.away, total = final.home + final.away;
    wins.push({ p: summary.homeWinProbability, actual: Number(margin > 0), close: close?.fairHomeWin });
    const { marginRange80, totalRange80 } = summary.nbaPossessions;
    if (margin >= marginRange80[0]! && margin <= marginRange80[1]!) marginWithin++;
    if (total >= totalRange80[0]! && total <= totalRange80[1]!) totalWithin++;
    if (!open) continue;
    const cover = nbaLineProbability(draws, { id: "home", kind: "spread", teamSide: "home", line: open.homeSpread })!;
    const p = cover.win / (1 - cover.push);
    const result = margin + open.homeSpread;
    if (result === 0) pushes++;
    else if (Number.isFinite(p)) covers.push({ p, actual: Number(result > 0), close: close?.fairHomeCoverAtOpenLine });
    if (close && Number.isFinite(p) && p !== 0.5) {
      // A more negative closing home handicap favors an earlier home selection.
      movement += (open.homeSpread - close.homeSpread) * (p > 0.5 ? 1 : -1);
      movementCount++;
    }
  }
  return {
    games: ids.size, win: scores(wins), cover: scores(covers), pushes,
    marginCoverage80: ids.size ? marginWithin / ids.size : null,
    totalCoverage80: ids.size ? totalWithin / ids.size : null,
    closingSpreadMovement: { count: movementCount, meanPoints: movementCount ? movement / movementCount : null },
  };
}
