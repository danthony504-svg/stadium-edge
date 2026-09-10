// Full-board scan manifest — proves every market family was discovered, simulated, and gated.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { BoardMarketCategory } from "./balancedTicketMix.ts";
import { boardMarketCategory } from "./boardMarketPools.ts";
import {
  type BoardLegGateCode,
  explainBoardLegQualification,
  pickLabelForManifest,
} from "./boardLegQualification.ts";
import type { FinalAiScore } from "./finalAiScore.ts";
import { isRealisticBoardPropCandidate } from "./boardPropSimExpansion.ts";
import { isAltPropPick } from "./altLinePool.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import {
  bumpCounterMap,
  emptyFootballPropFunnelCounters,
  footballPropMarketKey,
  footballPropMarketLabel,
  type FootballPropFunnelCounters,
  type FootballPropFunnelStage,
  type FootballPropRejectedSample,
  type FootballPropSport,
  type FootballPropStageRejectReason,
  FOOTBALL_PROP_FUNNEL_STAGES,
  FOOTBALL_PROP_MARKET_KEYS,
  isFootballPropDiscoverySample,
  isFootballPropPick,
  isFootballPropSport,
  safeCoachManifestInstrument,
  scoreDiagnosticsFromPartial,
} from "./coachFootballPropFunnel.ts";

export type ManifestMarketFamily =
  | "playerProps"
  | "altPlayerProps"
  | "comboProps"
  | "moneyline"
  | "spread"
  | "total"
  | "altSpread"
  | "altTotal"
  | "teamTotal"
  | "periodHalfQuarterInning"
  | "raceTo"
  | "otherGameLine";

export type CoachBoardScanManifest = {
  scanComplete: boolean;
  boardExhausted: boolean;
  requestedLegs: number;
  deliveredLegs: number;
  gameSimDraws: number;
  propSimDraws: number;
  propSimTier: "deep" | "quick";

  marketsFound: number;
  marketsFoundByFamily: Record<ManifestMarketFamily, number>;
  propsFound: number;
  propsEligibleForSim: number;
  propsSkippedUnsupported: number;
  alternateGameLinesFound: number;
  alternatePropsFound: number;

  marketsSimulated: number;
  gameLinesSimulated: number;
  propsSimulated: number;
  propsSimBatches: number;
  propsSimTimeouts: number;

  /** Sim finished but pick never entered scored[] (null MC hit, timeout, etc.). */
  preScoreEvaluated: number;
  totalEvaluated: number;
  totalQualified: number;
  qualifiedMain: number;
  qualifiedAlt: number;
  qualifiedByCategory: Record<BoardMarketCategory, number>;

  gateFailureCounts: Partial<Record<BoardLegGateCode, number>>;
  rejectedSamples: Array<{
    game: string;
    market: string;
    pick: string;
    category: BoardMarketCategory;
    family: ManifestMarketFamily;
    gate: BoardLegGateCode;
    reason: string;
    sport?: string;
    player?: string;
    line?: number | null;
    odds?: number;
    simHit?: number | null;
    impliedProbPct?: number | null;
    edgePct?: number | null;
    evPct?: number | null;
    confidencePct?: number | null;
    grade?: string | null;
  }>;

  /** NFL/NCAAF player-prop funnel (instrumentation only). */
  footballPropFunnelBySport: Record<FootballPropSport, FootballPropFunnelCounters>;
  /** Found counts by Odds API market key per football sport. */
  footballPropFoundByMarketBySport: Record<FootballPropSport, Record<string, number>>;
  /** Stage/gate reject counts for football props. */
  footballPropRejectCountsBySport: Record<
    FootballPropSport,
    Partial<Record<FootballPropStageRejectReason, number>>
  >;
  /** Sample rejected NFL/NCAAF props with score diagnostics. */
  footballPropRejectedSamples: FootballPropRejectedSample[];
};

export function emptyCoachBoardScanManifest(requestedLegs = 0): CoachBoardScanManifest {
  const zeroFamilies = (): Record<ManifestMarketFamily, number> => ({
    playerProps: 0,
    altPlayerProps: 0,
    comboProps: 0,
    moneyline: 0,
    spread: 0,
    total: 0,
    altSpread: 0,
    altTotal: 0,
    teamTotal: 0,
    periodHalfQuarterInning: 0,
    raceTo: 0,
    otherGameLine: 0,
  });
  return {
    scanComplete: false,
    boardExhausted: false,
    requestedLegs,
    deliveredLegs: 0,
    gameSimDraws: 10_000,
    propSimDraws: 10_000,
    propSimTier: "deep",
    marketsFound: 0,
    marketsFoundByFamily: zeroFamilies(),
    propsFound: 0,
    propsEligibleForSim: 0,
    propsSkippedUnsupported: 0,
    alternateGameLinesFound: 0,
    alternatePropsFound: 0,
    marketsSimulated: 0,
    gameLinesSimulated: 0,
    propsSimulated: 0,
    propsSimBatches: 0,
    propsSimTimeouts: 0,
    preScoreEvaluated: 0,
    totalEvaluated: 0,
    totalQualified: 0,
    qualifiedMain: 0,
    qualifiedAlt: 0,
    qualifiedByCategory: { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 },
    gateFailureCounts: {},
    rejectedSamples: [],
    footballPropFunnelBySport: {
      nfl: emptyFootballPropFunnelCounters(),
      ncaaf: emptyFootballPropFunnelCounters(),
    },
    footballPropFoundByMarketBySport: { nfl: {}, ncaaf: {} },
    footballPropRejectCountsBySport: { nfl: {}, ncaaf: {} },
    footballPropRejectedSamples: [],
  };
}

export function classifyManifestMarketFamily(pick: ParsedPick): ManifestMarketFamily {
  const market = String(pick.market ?? "").trim();
  const lower = market.toLowerCase();
  if (pick.isProp) {
    if (isAltPropPick(pick) || pick.propIsAlt) return "altPlayerProps";
    if (/\+|&|combo|double|triple/i.test(lower) || /pts.*reb|reb.*ast|pra/i.test(lower)) {
      return "comboProps";
    }
    return "playerProps";
  }
  if (/team total/i.test(lower)) return "teamTotal";
  if (/alt spread/i.test(lower)) return "altSpread";
  if (/alt total/i.test(lower)) return "altTotal";
  if (/moneyline|\bml\b/i.test(lower)) return "moneyline";
  if (/spread/i.test(lower)) return "spread";
  if (/total/i.test(lower)) return "total";
  if (/race to/i.test(lower)) return "raceTo";
  if (
    /q[1-4]|quarter|half|period|inning|f5|1st/i.test(lower) ||
    /\b(h1|h2|p[1-3])\b/i.test(lower)
  ) {
    return "periodHalfQuarterInning";
  }
  return "otherGameLine";
}

export type CoachBoardScanManifestRecorder = CoachBoardScanManifest & {
  recordMarketFound(pick: ParsedPick): void;
  recordPropPoolRow(pick: ParsedPick): void;
  recordGameLineSimulated(): void;
  recordPropSimBatch(size: number, timedOut: boolean, batch?: ParsedPick[]): void;
  /** Sim ran but the pick could not be graded (null MC hit, batch timeout, etc.). */
  recordPreScoreGateFailure(pick: ParsedPick, score?: Partial<FinalAiScore> | null): void;
  recordEvaluatedLeg(leg: BoardScoredLeg): void;
  recordEvaluatedPick(pick: ParsedPick, score: ParsedPick["finalAiScore"]): void;
  recomputeQualificationFromScored(scored: BoardScoredLeg[]): void;
  /**
   * Observational post-staging funnel for NFL/NCAAF props — does not change
   * which legs were selected; only records counts for the scan manifest.
   */
  recordFootballPropDeliveryFunnel(
    qualifiedFootballProps: ParsedPick[],
    selectedPicks: ParsedPick[],
  ): void;
  finalize(opts: { scanComplete: boolean; boardExhausted: boolean; deliveredLegs: number }): CoachBoardScanManifest;
};

const MAX_REJECTED_SAMPLES = 80;
const MAX_FOOTBALL_REJECT_SAMPLES = 10;

function mergeGateFailureCounts(
  a: Partial<Record<BoardLegGateCode, number>>,
  b: Partial<Record<BoardLegGateCode, number>>,
): Partial<Record<BoardLegGateCode, number>> {
  const out: Partial<Record<BoardLegGateCode, number>> = { ...a };
  for (const [gate, count] of Object.entries(b)) {
    if (!count) continue;
    const code = gate as BoardLegGateCode;
    out[code] = (out[code] ?? 0) + count;
  }
  return out;
}

function resetFootballEvalStages(manifest: CoachBoardScanManifest): void {
  for (const sport of ["nfl", "ncaaf"] as FootballPropSport[]) {
    manifest.footballPropFunnelBySport[sport].graded = 0;
    manifest.footballPropFunnelBySport[sport].qualified = 0;
    manifest.footballPropFunnelBySport[sport].after_dedupe = 0;
    manifest.footballPropFunnelBySport[sport].after_correlation = 0;
    manifest.footballPropFunnelBySport[sport].final_selected = 0;
    // Keep discovery/sim counters; clear only evaluation-stage reject keys that
    // are recomputed from scored legs. Preserve preScore rejects already logged.
  }
}

export function createCoachBoardScanManifestRecorder(requestedLegs: number): CoachBoardScanManifestRecorder {
  const manifest = emptyCoachBoardScanManifest(requestedLegs);
  const seenRejectFp = new Set<string>();
  const seenPreScoreFp = new Set<string>();
  const seenFootballSampleFp = new Set<string>();
  let preScoreGateFailures: Partial<Record<BoardLegGateCode, number>> = {};
  let preScoreRejectedSamples: CoachBoardScanManifest["rejectedSamples"] = [];
  let preScoreFootballRejects: FootballPropRejectedSample[] = [];
  let preScoreFootballRejectCounts: Record<
    FootballPropSport,
    Partial<Record<FootballPropStageRejectReason, number>>
  > = { nfl: {}, ncaaf: {} };
  let preScoreFootballGraded: Record<FootballPropSport, number> = { nfl: 0, ncaaf: 0 };
  /** Discovery/eligible-stage rejects from recordPropPoolRow — must survive recompute. */
  let discoveryFootballRejects: FootballPropRejectedSample[] = [];
  let discoveryFootballRejectCounts: Record<
    FootballPropSport,
    Partial<Record<FootballPropStageRejectReason, number>>
  > = { nfl: {}, ncaaf: {} };
  /** True after recomputeQualificationFromScored seeded football rejects into manifest. */
  let footballEvalSeededFromPreScore = false;

  const bumpGate = (gate: BoardLegGateCode, target: Partial<Record<BoardLegGateCode, number>>) => {
    target[gate] = (target[gate] ?? 0) + 1;
  };

  const bumpFootballReject = (
    sport: FootballPropSport,
    reason: FootballPropStageRejectReason,
    target: Record<FootballPropSport, Partial<Record<FootballPropStageRejectReason, number>>>,
  ) => {
    bumpCounterMap(target[sport] as Record<string, number>, reason, 1);
  };

  const pushFootballSample = (
    pick: ParsedPick,
    gate: FootballPropStageRejectReason,
    reason: string,
    stageStopped: FootballPropRejectedSample["stageStopped"],
    score: Partial<FinalAiScore> | null | undefined,
    bucket: FootballPropRejectedSample[],
  ) => {
    if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) return;
    if (bucket.length >= MAX_FOOTBALL_REJECT_SAMPLES) return;
    const sport = pick.sport;
    const fp = `${sport}|${pick.game}|${pick.player}|${pick.market}|${pick.odds}|${gate}`;
    if (seenFootballSampleFp.has(fp)) return;
    seenFootballSampleFp.add(fp);
    const diag = scoreDiagnosticsFromPartial(pick, score);
    bucket.push({
      sport,
      player: String(pick.player ?? pick.pick ?? ""),
      market: String(pick.market ?? ""),
      marketKey: footballPropMarketKey(pick),
      line: pick.propLine ?? null,
      odds: pick.odds,
      ...diag,
      stageStopped,
      gate,
      reason,
      game: pick.game,
      pick: pickLabelForManifest(pick),
    });
  };

  const pushRejectedSample = (
    pick: ParsedPick,
    gate: BoardLegGateCode,
    reason: string,
    bucket: CoachBoardScanManifest["rejectedSamples"],
    seen: Set<string>,
    score?: Partial<FinalAiScore> | null,
  ) => {
    const fp = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|${gate}`;
    if (seen.has(fp) || bucket.length >= MAX_REJECTED_SAMPLES) return;
    seen.add(fp);
    const base = {
      game: pick.game,
      market: String(pick.market ?? ""),
      pick: pickLabelForManifest(pick),
      category: boardMarketCategory(pick),
      family: classifyManifestMarketFamily(pick),
      gate,
      reason,
    };
    // Optional #429 diagnostics — must not abort rejection logging / scan.
    let enriched: CoachBoardScanManifest["rejectedSamples"][number] = base;
    safeCoachManifestInstrument("rejected-sample-diagnostics", () => {
      const diag = scoreDiagnosticsFromPartial(pick, score);
      enriched = {
        ...base,
        sport: pick.sport,
        player: pick.player,
        line: pick.propLine ?? null,
        odds: pick.odds,
        ...diag,
      };
    });
    bucket.push(enriched);
  };

  const recorder: CoachBoardScanManifestRecorder = {
    ...manifest,
    recordMarketFound(pick) {
      manifest.marketsFound += 1;
      const family = classifyManifestMarketFamily(pick);
      manifest.marketsFoundByFamily[family] += 1;
      if (!pick.isProp) {
        const cat = boardMarketCategory(pick);
        if (cat === "alternateLines") manifest.alternateGameLinesFound += 1;
      }
    },
    recordPropPoolRow(pick) {
      manifest.propsFound += 1;
      recorder.recordMarketFound(pick);
      if (isAltPropPick(pick) || pick.propIsAlt) manifest.alternatePropsFound += 1;
      const eligible = isRealisticBoardPropCandidate(pick);
      if (eligible) {
        manifest.propsEligibleForSim += 1;
      } else {
        manifest.propsSkippedUnsupported += 1;
      }
      safeCoachManifestInstrument("football-prop-pool-row", () => {
        if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) return;
        const sport = pick.sport;
        const funnel = manifest.footballPropFunnelBySport[sport];
        funnel.raw_found += 1;
        funnel.normalized += 1;
        if (eligible) {
          funnel.eligible += 1;
        } else {
          bumpFootballReject(sport, "unsupported_market", manifest.footballPropRejectCountsBySport);
          bumpFootballReject(sport, "unsupported_market", discoveryFootballRejectCounts);
          // Record into the durable discovery bucket first; mirror into the live
          // manifest sample list so eligible-stage drops survive recompute.
          const before = discoveryFootballRejects.length;
          pushFootballSample(
            pick,
            "unsupported_market",
            "Prop skipped — no sim model / missing line",
            "eligible",
            null,
            discoveryFootballRejects,
          );
          if (
            discoveryFootballRejects.length > before &&
            manifest.footballPropRejectedSamples.length < MAX_FOOTBALL_REJECT_SAMPLES
          ) {
            manifest.footballPropRejectedSamples.push(
              discoveryFootballRejects[discoveryFootballRejects.length - 1]!,
            );
          }
        }
        bumpCounterMap(
          manifest.footballPropFoundByMarketBySport[sport],
          footballPropMarketKey(pick),
          1,
        );
      });
    },
    recordGameLineSimulated() {
      manifest.gameLinesSimulated += 1;
      manifest.marketsSimulated += 1;
    },
    recordPropSimBatch(size, timedOut, batch) {
      manifest.propsSimBatches += 1;
      manifest.propsSimulated += size;
      manifest.marketsSimulated += size;
      if (timedOut) manifest.propsSimTimeouts += 1;
      safeCoachManifestInstrument("football-prop-sim-batch", () => {
        if (!batch?.length) return;
        for (const pick of batch) {
          if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) continue;
          manifest.footballPropFunnelBySport[pick.sport].simulated += 1;
        }
      });
    },
    recordPreScoreGateFailure(pick, score) {
      const fp = `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|pre_score`;
      if (seenPreScoreFp.has(fp)) return;
      seenPreScoreFp.add(fp);
      manifest.preScoreEvaluated += 1;
      const q = explainBoardLegQualification(pick, (score as FinalAiScore | null | undefined) ?? null);
      bumpGate(q.gate, preScoreGateFailures);
      pushRejectedSample(pick, q.gate, q.reason, preScoreRejectedSamples, seenRejectFp, score);
      safeCoachManifestInstrument("football-pre-score-reject", () => {
        if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) return;
        const sport = pick.sport;
        preScoreFootballGraded[sport] += 1;
        manifest.footballPropFunnelBySport[sport].graded += 1;
        const reasonCode: FootballPropStageRejectReason =
          q.gate === "not_sim_aligned" ? "integrity_mapping" : q.gate;
        bumpFootballReject(sport, reasonCode, preScoreFootballRejectCounts);
        pushFootballSample(
          pick,
          reasonCode,
          q.reason,
          "graded",
          score,
          preScoreFootballRejects,
        );
      });
    },
    recordEvaluatedLeg(leg) {
      recorder.recordEvaluatedPick(leg.pick, leg.pick.finalAiScore);
    },
    recordEvaluatedPick(pick, score) {
      const q = explainBoardLegQualification(pick, score);
      safeCoachManifestInstrument("football-evaluated-graded", () => {
        if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) return;
        manifest.footballPropFunnelBySport[pick.sport].graded += 1;
      });
      if (q.qualifies) {
        manifest.totalQualified += 1;
        if (q.role === "main") manifest.qualifiedMain += 1;
        if (q.role === "alt") manifest.qualifiedAlt += 1;
        const cat = boardMarketCategory(pick);
        manifest.qualifiedByCategory[cat] += 1;
        safeCoachManifestInstrument("football-evaluated-qualified", () => {
          if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) return;
          manifest.footballPropFunnelBySport[pick.sport].qualified += 1;
        });
        return;
      }
      bumpGate(q.gate, manifest.gateFailureCounts);
      pushRejectedSample(pick, q.gate, q.reason, manifest.rejectedSamples, seenRejectFp, score);
      safeCoachManifestInstrument("football-evaluated-reject", () => {
        if (!isFootballPropPick(pick) || !isFootballPropSport(pick.sport)) return;
        const sport = pick.sport;
        const reasonCode: FootballPropStageRejectReason =
          q.gate === "not_sim_aligned" ? "integrity_mapping" : q.gate;
        bumpFootballReject(sport, reasonCode, manifest.footballPropRejectCountsBySport);
        pushFootballSample(
          pick,
          reasonCode,
          q.reason,
          "qualified",
          score,
          manifest.footballPropRejectedSamples,
        );
      });
    },
    recomputeQualificationFromScored(scored) {
      manifest.totalQualified = 0;
      manifest.qualifiedMain = 0;
      manifest.qualifiedAlt = 0;
      manifest.qualifiedByCategory = { props: 0, gameLines: 0, teamTotals: 0, alternateLines: 0 };
      manifest.gateFailureCounts = {};
      manifest.rejectedSamples = [];
      seenRejectFp.clear();
      safeCoachManifestInstrument("football-recompute-seed", () => {
        resetFootballEvalStages(manifest);
        for (const sport of ["nfl", "ncaaf"] as FootballPropSport[]) {
          manifest.footballPropFunnelBySport[sport].graded = preScoreFootballGraded[sport];
        }
        // Preserve discovery/eligible-stage rejects from recordPropPoolRow, then
        // layer pre-score rejects. Do not wipe unsupported_market (etc.) with
        // pre-score-only data.
        manifest.footballPropRejectCountsBySport = {
          nfl: {
            ...discoveryFootballRejectCounts.nfl,
            ...preScoreFootballRejectCounts.nfl,
          },
          ncaaf: {
            ...discoveryFootballRejectCounts.ncaaf,
            ...preScoreFootballRejectCounts.ncaaf,
          },
        };
        manifest.footballPropRejectedSamples = [
          ...discoveryFootballRejects,
          ...preScoreFootballRejects,
        ].slice(0, MAX_FOOTBALL_REJECT_SAMPLES);
        seenFootballSampleFp.clear();
        for (const s of manifest.footballPropRejectedSamples) {
          seenFootballSampleFp.add(
            `${s.sport}|${s.game}|${s.player}|${s.market}|${s.odds}|${s.gate}`,
          );
        }
        footballEvalSeededFromPreScore = true;
      });

      for (const leg of scored) {
        recorder.recordEvaluatedPick(leg.pick, leg.pick.finalAiScore);
      }

      manifest.totalEvaluated = manifest.preScoreEvaluated + scored.length;
    },
    recordFootballPropDeliveryFunnel(qualifiedFootballProps, selectedPicks) {
      safeCoachManifestInstrument("football-delivery-funnel", () => {
        const selectedFp = new Set(
          selectedPicks
            .filter(isFootballPropPick)
            .map((p) => `${p.sport}|${p.game}|${p.player}|${p.market}|${p.odds}`),
        );
        for (const sport of ["nfl", "ncaaf"] as FootballPropSport[]) {
          const qualified = qualifiedFootballProps.filter((p) => p.sport === sport);
          const selected = selectedPicks.filter(
            (p) => isFootballPropPick(p) && p.sport === sport,
          );
          // Observational: props are not hard-dropped by same-team game-line dedupe.
          // Treat qualified count as after_dedupe; correlation/ranking explains the gap
          // to final_selected (instrumentation only — selection unchanged).
          const afterDedupe = qualified.length;
          const afterCorrelation = selected.length;
          const finalSelected = selected.length;
          const funnel = manifest.footballPropFunnelBySport[sport];
          funnel.after_dedupe = afterDedupe;
          funnel.after_correlation = afterCorrelation;
          funnel.final_selected = finalSelected;

          for (const pick of qualified) {
            const key = `${pick.sport}|${pick.game}|${pick.player}|${pick.market}|${pick.odds}`;
            if (selectedFp.has(key)) continue;
            // One terminal rejection per unselected qualified prop — counts must
            // reconcile with qualified − final_selected (no correlation+not_selected double bump).
            bumpFootballReject(sport, "correlation", manifest.footballPropRejectCountsBySport);
            pushFootballSample(
              pick,
              "correlation",
              "Qualified football prop not selected after correlation / ticket mix ranking",
              "after_correlation",
              pick.finalAiScore,
              manifest.footballPropRejectedSamples,
            );
          }
        }
      });
    },
    finalize(opts) {
      manifest.scanComplete = opts.scanComplete;
      manifest.boardExhausted = opts.boardExhausted;
      manifest.deliveredLegs = opts.deliveredLegs;
      if (!manifest.totalEvaluated) {
        manifest.totalEvaluated = manifest.preScoreEvaluated;
      }
      if (
        opts.scanComplete &&
        manifest.marketsSimulated > manifest.totalEvaluated
      ) {
        const gap = manifest.marketsSimulated - manifest.totalEvaluated;
        preScoreGateFailures.no_sim_grade = (preScoreGateFailures.no_sim_grade ?? 0) + gap;
        manifest.preScoreEvaluated += gap;
        manifest.totalEvaluated = manifest.marketsSimulated;
      }
      let footballPropRejectedSamples = manifest.footballPropRejectedSamples;
      let footballPropRejectCountsBySport = {
        nfl: { ...manifest.footballPropRejectCountsBySport.nfl },
        ncaaf: { ...manifest.footballPropRejectCountsBySport.ncaaf },
      };
      safeCoachManifestInstrument("football-finalize-snapshot", () => {
        // After recompute, manifest already holds discovery + pre-score + eval rejects.
        // Before recompute, merge durable discovery + pre-score buckets with live samples.
        footballPropRejectedSamples = (
          footballEvalSeededFromPreScore
            ? manifest.footballPropRejectedSamples
            : [
                ...discoveryFootballRejects,
                ...preScoreFootballRejects,
                ...manifest.footballPropRejectedSamples.filter(
                  (s) => !isFootballPropDiscoverySample(s),
                ),
              ]
        ).slice(0, MAX_FOOTBALL_REJECT_SAMPLES);
        footballPropRejectCountsBySport = footballEvalSeededFromPreScore
          ? {
              nfl: { ...manifest.footballPropRejectCountsBySport.nfl },
              ncaaf: { ...manifest.footballPropRejectCountsBySport.ncaaf },
            }
          : {
              nfl: {
                ...discoveryFootballRejectCounts.nfl,
                ...preScoreFootballRejectCounts.nfl,
                ...manifest.footballPropRejectCountsBySport.nfl,
              },
              ncaaf: {
                ...discoveryFootballRejectCounts.ncaaf,
                ...preScoreFootballRejectCounts.ncaaf,
                ...manifest.footballPropRejectCountsBySport.ncaaf,
              },
            };
      });
      return {
        ...manifest,
        gateFailureCounts: mergeGateFailureCounts(preScoreGateFailures, manifest.gateFailureCounts),
        rejectedSamples: [...preScoreRejectedSamples, ...manifest.rejectedSamples].slice(
          0,
          MAX_REJECTED_SAMPLES,
        ),
        footballPropRejectedSamples,
        footballPropRejectCountsBySport,
      };
    },
  };

  return recorder;
}

function gateLabel(gate: BoardLegGateCode): string {
  const labels: Record<BoardLegGateCode, string> = {
    qualified_main: "Qualified (main)",
    qualified_alt: "Qualified (alt)",
    no_score: "No score",
    high_risk_value_play: "High-risk value",
    unsupported_market: "Unsupported market",
    missing_odds: "Missing odds",
    missing_prop_line: "Missing prop line",
    no_sim_grade: "No sim grade",
    negative_edge: "Edge ≤ 0",
    negative_ev: "EV ≤ 0",
    sim_below_implied: "Sim ≤ implied",
    grade_below_minimum: "Grade below C+",
    confidence_below_minimum: "Confidence below 52%",
    not_sim_aligned: "Sim not aligned",
    holistic_not_recommended: "Holistic failed",
    not_ai_recommended: "Not AI recommended",
    not_staged: "Not staged",
  };
  return labels[gate] ?? gate;
}

function footballRejectLabel(reason: string): string {
  const labels: Record<string, string> = {
    missing_odds: "Missing odds",
    missing_prop_line: "Missing line",
    unsupported_market: "Unsupported market",
    normalization_failure: "Normalization failure",
    no_sim_grade: "No sim grade",
    integrity_mapping: "Integrity / mapping failure",
    confidence_below_minimum: "Confidence below minimum",
    negative_edge: "Negative edge",
    negative_ev: "Negative EV",
    sim_below_implied: "Sim below implied",
    grade_below_minimum: "Grade below minimum",
    holistic_not_recommended: "Holistic / not recommended",
    not_ai_recommended: "Not AI recommended",
    not_sim_aligned: "Sim not aligned",
    not_staged: "Not staged",
    dedupe: "Dedupe",
    correlation: "Correlation / ranking",
    thin_cap: "Thin-market cap",
    not_selected: "Not selected",
  };
  return labels[reason] ?? reason;
}

function formatFootballPropFunnelSection(manifest: CoachBoardScanManifest): string[] {
  const lines: string[] = [];
  const sports: Array<[FootballPropSport, string]> = [
    ["nfl", "NFL"],
    ["ncaaf", "NCAAF"],
  ];
  const any =
    sports.some(([s]) => manifest.footballPropFunnelBySport[s].raw_found > 0) ||
    manifest.footballPropRejectedSamples.length > 0;
  if (!any) return lines;

  lines.push("");
  lines.push("**NFL / NCAAF player-prop funnel**");
  for (const [sport, label] of sports) {
    const f = manifest.footballPropFunnelBySport[sport];
    if (f.raw_found <= 0 && f.final_selected <= 0) continue;
    lines.push(`- **${label}**`);
    const stageLabels: Record<FootballPropFunnelStage, string> = {
      raw_found: "raw / found",
      normalized: "normalized",
      eligible: "eligible",
      simulated: "simulated",
      graded: "graded",
      qualified: "qualified",
      after_dedupe: "after dedupe",
      after_correlation: "after correlation",
      final_selected: "final selected",
    };
    for (const stage of FOOTBALL_PROP_FUNNEL_STAGES) {
      lines.push(`  - ${stageLabels[stage]}: **${f[stage].toLocaleString()}**`);
    }
    const byMarket = manifest.footballPropFoundByMarketBySport[sport];
    const marketKeys = [
      ...FOOTBALL_PROP_MARKET_KEYS.filter((k) => (byMarket[k] ?? 0) > 0),
      ...Object.keys(byMarket).filter(
        (k) => !(FOOTBALL_PROP_MARKET_KEYS as readonly string[]).includes(k) && (byMarket[k] ?? 0) > 0,
      ),
    ];
    if (marketKeys.length) {
      lines.push(`  - Markets found:`);
      for (const key of marketKeys) {
        lines.push(
          `    - ${footballPropMarketLabel(key)} (\`${key}\`): **${(byMarket[key] ?? 0).toLocaleString()}**`,
        );
      }
    }
    const rejects = Object.entries(manifest.footballPropRejectCountsBySport[sport]).filter(
      ([, n]) => (n ?? 0) > 0,
    );
    if (rejects.length) {
      lines.push(`  - Stage / gate rejects:`);
      for (const [reason, count] of rejects.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
        lines.push(`    - ${footballRejectLabel(reason)}: **${(count ?? 0).toLocaleString()}**`);
      }
    }
  }

  const samples = manifest.footballPropRejectedSamples;
  if (samples.length) {
    lines.push("");
    lines.push(`**Sample rejected NFL/NCAAF props** (up to ${samples.length})`);
    for (const r of samples) {
      const sim =
        r.simHit == null ? "—" : `${Math.round(r.simHit * 1000) / 10}%`;
      const implied =
        r.impliedProbPct == null ? "—" : `${Math.round(r.impliedProbPct * 10) / 10}%`;
      const edge =
        r.edgePct == null ? "—" : `${r.edgePct > 0 ? "+" : ""}${Math.round(r.edgePct * 10) / 10}%`;
      const ev =
        r.evPct == null ? "—" : `${r.evPct > 0 ? "+" : ""}${Math.round(r.evPct * 10) / 10}%`;
      const conf = r.confidencePct == null ? "—" : `${Math.round(r.confidencePct)}%`;
      lines.push(
        `- **${r.sport.toUpperCase()}** · ${r.player || r.pick} · ${r.market}` +
          `${r.line != null ? ` ${r.line}` : ""} @ ${r.odds}` +
          ` — simHit ${sim}, implied ${implied}, edge ${edge}, EV ${ev}, conf ${conf}, grade ${r.grade ?? "—"}` +
          ` — stopped at **${r.stageStopped}** (_${r.reason}_)`,
      );
    }
  }
  return lines;
}

/** User-facing scan manifest block (markdown). */
export function formatCoachBoardScanManifest(manifest: CoachBoardScanManifest): string {
  const lines: string[] = [];
  lines.push("### Scan manifest");
  lines.push(
    manifest.scanComplete && manifest.boardExhausted
      ? "**Status:** Full board evaluated — every posted market family scanned."
      : manifest.scanComplete
        ? "**Status:** Scan finished."
        : "**Status:** Scan in progress…",
  );
  lines.push("");
  lines.push("**Coverage**");
  lines.push(`- Markets found: **${manifest.marketsFound.toLocaleString()}**`);
  lines.push(`- Markets simulated (10k MC): **${manifest.marketsSimulated.toLocaleString()}**`);
  lines.push(`- Game lines simulated: **${manifest.gameLinesSimulated.toLocaleString()}**`);
  lines.push(
    `- Player props simulated: **${manifest.propsSimulated.toLocaleString()}** of **${manifest.propsEligibleForSim.toLocaleString()}** eligible (${manifest.propsFound.toLocaleString()} in pool)`,
  );
  lines.push(`- Alternate game lines found: **${manifest.alternateGameLinesFound.toLocaleString()}**`);
  lines.push(`- Alternate player props found: **${manifest.alternatePropsFound.toLocaleString()}**`);
  if (manifest.propsSkippedUnsupported > 0) {
    lines.push(`- Props skipped (no sim model / missing line): **${manifest.propsSkippedUnsupported.toLocaleString()}**`);
  }
  if (manifest.propsSimTimeouts > 0) {
    lines.push(`- Prop sim batch timeouts: **${manifest.propsSimTimeouts}**`);
  }

  lines.push("");
  lines.push("**Market families discovered**");
  const families: Array<[ManifestMarketFamily, string]> = [
    ["playerProps", "Player props"],
    ["altPlayerProps", "Alternate player props"],
    ["comboProps", "Combo props"],
    ["moneyline", "Moneylines"],
    ["spread", "Spreads"],
    ["total", "Totals"],
    ["altSpread", "Alternate spreads"],
    ["altTotal", "Alternate totals"],
    ["teamTotal", "Team totals"],
    ["periodHalfQuarterInning", "Quarter / half / period / inning"],
    ["raceTo", "Race-to markets"],
    ["otherGameLine", "Other posted game lines"],
  ];
  for (const [key, label] of families) {
    const n = manifest.marketsFoundByFamily[key];
    if (n > 0) lines.push(`- ${label}: **${n.toLocaleString()}**`);
  }

  lines.push("");
  lines.push("**Qualification**");
  lines.push(`- Candidates evaluated (with sim): **${manifest.totalEvaluated.toLocaleString()}**`);
  if (manifest.preScoreEvaluated > 0) {
    lines.push(
      `- Sim completed but not gradable: **${manifest.preScoreEvaluated.toLocaleString()}** (null MC hit, timeout, or missing score)`,
    );
  }
  lines.push(`- Qualified (main): **${manifest.qualifiedMain}**`);
  lines.push(`- Qualified (alt): **${manifest.qualifiedAlt}**`);
  lines.push(
    `- On ticket categories — props: **${manifest.qualifiedByCategory.props}**, game lines: **${manifest.qualifiedByCategory.gameLines}**, team totals: **${manifest.qualifiedByCategory.teamTotals}**, alts: **${manifest.qualifiedByCategory.alternateLines}**`,
  );

  const failureEntries = Object.entries(manifest.gateFailureCounts).filter(
    ([gate]) => gate !== "qualified_main" && gate !== "qualified_alt",
  );
  if (failureEntries.length > 0) {
    lines.push("");
    lines.push("**Gate failures**");
    for (const [gate, count] of failureEntries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      lines.push(`- ${gateLabel(gate as BoardLegGateCode)}: **${count?.toLocaleString()}**`);
    }
  }

  if (manifest.rejectedSamples.length > 0) {
    lines.push("");
    lines.push(`**Sample rejections** (top ${manifest.rejectedSamples.length} by scan order)`);
    for (const r of manifest.rejectedSamples.slice(0, 25)) {
      const extras = [
        r.sport ? `sport ${r.sport}` : null,
        r.simHit != null ? `simHit ${Math.round(r.simHit * 1000) / 10}%` : null,
        r.edgePct != null ? `edge ${r.edgePct > 0 ? "+" : ""}${Math.round(r.edgePct * 10) / 10}%` : null,
        r.grade ? `grade ${r.grade}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- ${r.game} · ${r.pick} — _${r.reason}_${extras ? ` (${extras})` : ""}`,
      );
    }
    if (manifest.rejectedSamples.length > 25) {
      lines.push(`- _…and ${manifest.rejectedSamples.length - 25} more logged rejections_`);
    }
  }

  safeCoachManifestInstrument("football-format-section", () => {
    lines.push(...formatFootballPropFunnelSection(manifest));
  });

  lines.push("");
  lines.push("**Delivery**");
  if (manifest.scanComplete && manifest.boardExhausted) {
    if (manifest.deliveredLegs > 0) {
      lines.push(
        `- Delivered **${manifest.deliveredLegs}** of **${manifest.requestedLegs || manifest.deliveredLegs}** requested legs after horizon + dedupe gates.`,
      );
    } else if (manifest.qualifiedMain + manifest.qualifiedAlt > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.qualifiedMain + manifest.qualifiedAlt}** passed sim/AI gates but none survived final delivery (horizon, dedupe, or in-flight rescoring).`,
      );
    } else if (manifest.marketsSimulated > 0 && manifest.totalEvaluated > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.marketsSimulated.toLocaleString()}** markets got 10k MC sims; **${manifest.totalEvaluated.toLocaleString()}** were graded but none passed edge, EV, and confidence gates. See gate failures above.`,
      );
    } else if (manifest.marketsSimulated > 0) {
      lines.push(
        `- **0 legs delivered** — **${manifest.marketsSimulated.toLocaleString()}** markets were simulated but none produced a gradable sim result on this slate.`,
      );
    } else {
      lines.push(
        `- **0 legs delivered** — no candidates passed sim, edge, EV, and confidence thresholds on this slate.`,
      );
    }
  } else if (manifest.deliveredLegs > 0) {
    lines.push(`- In progress: **${manifest.deliveredLegs}** leg(s) ready so far.`);
  }

  lines.push("");
  lines.push(
    `_Simulation: ${manifest.gameSimDraws.toLocaleString()} draws per game line; prop tier **${manifest.propSimTier}** (${manifest.propSimDraws.toLocaleString()} draws per prop)._`,
  );
  lines.push("_Pipeline: **board scan → staging gates → single delivery** (no preview/filler fallback)._");

  return lines.join("\n");
}
