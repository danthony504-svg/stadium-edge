import { researchLine, simulateEventResearch, summarizeEventResearch } from "./eventSimResearch.js";
import type { EventSnapshot } from "./eventKernels.js";

type Score = { p: number; hit: number; closing?: number };
type Closed = { kind: "regulation" | "full_game" | "completed_match";
  home: number; away: number; winner: "home" | "away" | "draw"; availableAt: number; retired?: boolean; };
type Case = {
  snapshot: EventSnapshot; final: Closed;
  open?: { spread: number; availableAt: number };
  close?: { fairHomeWin: number; fairCoverAtOpen?: number; spread?: number; availableAt: number };
};

const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const brier = (p: number, hit: number) => (p - hit) ** 2;
const loss = (p: number, hit: number) => -Math.log(Math.max(1e-12, hit ? p : 1 - p));
const probability = (p: number) => Number.isFinite(p) && p >= 0 && p <= 1;

function report(samples: Score[]) {
  const paired = samples.filter(s => s.closing != null);
  return {
    settled: samples.length, brier: average(samples.map(s => brier(s.p, s.hit))),
    logLoss: average(samples.map(s => loss(s.p, s.hit))),
    paired: paired.length, pairedModelBrier: average(paired.map(s => brier(s.p, s.hit))),
    pairedClosingBrier: average(paired.map(s => brier(s.closing!, s.hit))),
    pairedModelLogLoss: average(paired.map(s => loss(s.p, s.hit))),
    pairedClosingLogLoss: average(paired.map(s => loss(s.closing!, s.hit))),
    calibration: Array.from({ length: 10 }, (_, i) => {
      const bucket = samples.filter(s => Math.min(9, Math.floor(s.p * 10)) === i);
      return { lower: i / 10, count: bucket.length, predicted: average(bucket.map(s => s.p)), observed: average(bucket.map(s => s.hit)) };
    }),
  };
}

export function backtestEventSim(rows: readonly Case[]) {
  const sportReports = new Map<string, { win: Score[]; covers: Score[]; draw: Score[]; margin: number[]; total: number[]; movement: number[]; pushes: number; retired: number }>();
  const seen = new Set<string>();
  for (const { snapshot, final, open, close } of rows) {
    const key = JSON.stringify([snapshot.sport, snapshot.eventId]);
    const requiredBasis = snapshot.sport === "soccer" ? "regulation" : snapshot.sport === "tennis" ? "completed_match" : "full_game";
    const retirementAllowed = final.retired != null ? snapshot.sport === "tennis" && typeof final.retired === "boolean" : true;
    if (seen.has(key) || final.kind !== requiredBasis || !retirementAllowed ||
        ![final.home, final.away].every(n => Number.isSafeInteger(n) && n >= 0) ||
        !["away", "home", "draw"].includes(final.winner) ||
        (snapshot.sport !== "tennis" && final.winner !== (final.home > final.away ? "home" : final.away > final.home ? "away" : "draw")) ||
        (snapshot.sport === "tennis" && final.winner === "draw") ||
        !Number.isFinite(final.availableAt) || final.availableAt <= snapshot.startsAt ||
        (open && (!Number.isFinite(open.spread) || !Number.isFinite(open.availableAt) || open.availableAt > snapshot.availableAt)) ||
        (close && (!Number.isFinite(close.availableAt) || close.availableAt <= snapshot.availableAt ||
          close.availableAt >= snapshot.startsAt || !probability(close.fairHomeWin) ||
          (close.spread != null && !Number.isFinite(close.spread)) ||
          (close.fairCoverAtOpen != null && (!open || !probability(close.fairCoverAtOpen)))))) throw new RangeError("Invalid backtest record");
    seen.add(key);
    let sport = sportReports.get(snapshot.sport);
    if (!sport) {
      sport = { win: [], covers: [], draw: [], margin: [], total: [], movement: [], pushes: 0, retired: 0 };
      sportReports.set(snapshot.sport, sport);
    }
    if (final.retired) { sport.retired++; continue; }
    const draws = simulateEventResearch(snapshot);
    const sim = summarizeEventResearch(draws, [], false);
    const homeWin = researchLine(draws, { id: "ml", kind: "ml", teamSide: "home" });
    if (homeWin) sport.win.push({ p: homeWin.win, hit: Number(final.winner === "home"), closing: close?.fairHomeWin });
    if (snapshot.sport === "soccer") sport.draw.push({ p: sim.tieProbability, hit: Number(final.winner === "draw") });
    const margin = final.home - final.away, total = final.home + final.away;
    const within = (n: number, span: number[]) => Number(n >= span[0]! && n <= span[1]!);
    sport.margin.push(within(margin, sim.eventSimulation.marginRange80));
    sport.total.push(within(total, sim.eventSimulation.totalRange80));
    if (open) {
      const handicap = researchLine(draws, { id: "spread", kind: "spread", teamSide: "home", line: open.spread });
      if (margin + open.spread === 0) sport.pushes++;
      else if (handicap && handicap.push < 1) {
        const p = handicap.win / (1 - handicap.push);
        sport.covers.push({ p, hit: Number(margin + open.spread > 0), closing: close?.fairCoverAtOpen });
        if (close?.spread != null && p !== .5) sport.movement.push((open.spread - close.spread) * (p > .5 ? 1 : -1));
      }
    }
  }
  return [...sportReports].map(([sport, values]) => ({
    sport, win: report(values.win), cover: report(values.covers), draw: report(values.draw),
    marginCoverage80: average(values.margin), totalCoverage80: average(values.total),
    pushes: values.pushes, retirements: values.retired, lineMovement: { count: values.movement.length, points: average(values.movement) },
  }));
}
