// Full-board scan audit — where every market enters and exits the pipeline.

import type { ParsedPick } from "./parsedPick.ts";
import type { BoardLegGateCode } from "./boardLegQualification.ts";
import { isAltBoardPick, isAltPropPick } from "./altLinePool.ts";
import type { BoardScoredLeg } from "./ticketStaging.ts";
import { positiveEdgeScoredLegs } from "./coachDeliverySalvage.ts";

export const COACH_SCAN_AUDIT_LOG = "[coach-scan-audit]";

/** User-facing market buckets for funnel breakdown. */
export type ScanAuditMarketBucket =
  | "moneyline"
  | "spread"
  | "total"
  | "alternateSpread"
  | "alternateTotal"
  | "teamProps"
  | "playerHits"
  | "homeRuns"
  | "rbis"
  | "strikeouts"
  | "walks"
  | "totalBases"
  | "stolenBases"
  | "passing"
  | "rushing"
  | "receiving"
  | "nbaPoints"
  | "rebounds"
  | "assists"
  | "pra"
  | "nhlProps"
  | "soccerProps"
  | "tennisProps"
  | "ufcProps"
  | "other";

export const SCAN_AUDIT_MARKET_LABELS: Record<ScanAuditMarketBucket, string> = {
  moneyline: "Moneyline",
  spread: "Spread",
  total: "Total",
  alternateSpread: "Alternate Spread",
  alternateTotal: "Alternate Total",
  teamProps: "Team Props",
  playerHits: "Player Hits",
  homeRuns: "Home Runs",
  rbis: "RBIs",
  strikeouts: "Strikeouts",
  walks: "Walks",
  totalBases: "Total Bases",
  stolenBases: "Stolen Bases",
  passing: "Passing",
  rushing: "Rushing",
  receiving: "Receiving",
  nbaPoints: "NBA Points",
  rebounds: "Rebounds",
  assists: "Assists",
  pra: "PRA",
  nhlProps: "NHL Props",
  soccerProps: "Soccer Props",
  tennisProps: "Tennis Props",
  ufcProps: "UFC Props",
  other: "Other",
};

export const SCAN_AUDIT_MARKET_ORDER: ScanAuditMarketBucket[] = [
  "moneyline",
  "spread",
  "total",
  "alternateSpread",
  "alternateTotal",
  "teamProps",
  "playerHits",
  "homeRuns",
  "rbis",
  "strikeouts",
  "walks",
  "totalBases",
  "stolenBases",
  "passing",
  "rushing",
  "receiving",
  "nbaPoints",
  "rebounds",
  "assists",
  "pra",
  "nhlProps",
  "soccerProps",
  "tennisProps",
  "ufcProps",
  "other",
];

export type ScanAuditDiscardReason =
  | "bettable_filter"
  | "game_scope_cap"
  | "prop_sim_cap"
  | "unsupported_market"
  | "missing_odds"
  | "missing_line"
  | "not_simmed"
  | "no_sim_grade"
  | "other_pre_score";

export type ScanAuditFunnelCounts = {
  pulledFromApi: number;
  discardedBeforeScoring: number;
  scored: number;
  rejectedByEv: number;
  rejectedByConfidence: number;
  rejectedByGrounding: number;
  rejectedAlternateLines: number;
  rejectedMarketType: number;
  finalCandidates: number;
};

export type CoachBoardScanAudit = {
  requestId?: string;
  totals: ScanAuditFunnelCounts;
  byMarket: Record<ScanAuditMarketBucket, ScanAuditFunnelCounts>;
  discardReasons: Partial<Record<ScanAuditDiscardReason, number>>;
  positiveEdgeCount: number;
};

function emptyFunnelCounts(): ScanAuditFunnelCounts {
  return {
    pulledFromApi: 0,
    discardedBeforeScoring: 0,
    scored: 0,
    rejectedByEv: 0,
    rejectedByConfidence: 0,
    rejectedByGrounding: 0,
    rejectedAlternateLines: 0,
    rejectedMarketType: 0,
    finalCandidates: 0,
  };
}

function emptyByMarket(): Record<ScanAuditMarketBucket, ScanAuditFunnelCounts> {
  const out = {} as Record<ScanAuditMarketBucket, ScanAuditFunnelCounts>;
  for (const bucket of SCAN_AUDIT_MARKET_ORDER) out[bucket] = emptyFunnelCounts();
  return out;
}

export function emptyCoachBoardScanAudit(): CoachBoardScanAudit {
  return {
    totals: emptyFunnelCounts(),
    byMarket: emptyByMarket(),
    discardReasons: {},
    positiveEdgeCount: 0,
  };
}

function bumpDiscard(
  audit: CoachBoardScanAudit,
  reason: ScanAuditDiscardReason,
  count = 1,
): void {
  audit.discardReasons[reason] = (audit.discardReasons[reason] ?? 0) + count;
}

function bumpFunnel(
  target: ScanAuditFunnelCounts,
  field: keyof ScanAuditFunnelCounts,
  count = 1,
): void {
  target[field] += count;
}

function pickFingerprint(pick: ParsedPick): string {
  return `${pick.game}|${pick.market}|${pick.pick}|${pick.odds}|${pick.player ?? ""}|${pick.propLine ?? ""}|${pick.propSide ?? ""}`;
}

/** Map a posted pick to a scan-audit market bucket. */
export function classifyScanAuditMarketBucket(pick: ParsedPick): ScanAuditMarketBucket {
  const market = String(pick.market ?? pick.propMarketKey ?? "").toLowerCase();
  const sport = String(pick.sport ?? "").toLowerCase();

  if (!pick.isProp) {
    if (/moneyline|\bml\b/i.test(market)) return "moneyline";
    if (/alt(?:ernate)?\s*spread/i.test(market)) return "alternateSpread";
    if (/alt(?:ernate)?\s*total/i.test(market)) return "alternateTotal";
    if (/spread|puck\s*line|run\s*line/i.test(market)) return "spread";
    if (/team\s*total/i.test(market)) return "teamProps";
    if (/total|over\/under|\bo\/u\b/i.test(market)) return "total";
    return "other";
  }

  if (sport === "soccer" || sport.includes("soccer")) return "soccerProps";
  if (sport === "tennis") return "tennisProps";
  if (sport === "ufc" || sport === "mma") return "ufcProps";

  if (sport === "nhl" || sport === "hockey") {
    if (/pass|rush|receiv|point|goal|assist|shot|block|save|powerplay/i.test(market)) {
      return "nhlProps";
    }
    return "nhlProps";
  }

  if (sport === "nfl" || sport === "ncaaf") {
    if (/pass/i.test(market)) return "passing";
    if (/rush/i.test(market)) return "rushing";
    if (/receiv/i.test(market)) return "receiving";
  }

  if (sport === "mlb") {
    if (/\bhits?\b/i.test(market) && !/pitcher/i.test(market)) return "playerHits";
    if (/home\s*run|\bhr\b/i.test(market)) return "homeRuns";
    if (/\brbi/i.test(market)) return "rbis";
    if (/strikeout|\bks?\b|k\'s/i.test(market)) return "strikeouts";
    if (/\bwalk|\bbb\b/i.test(market)) return "walks";
    if (/total\s*bases?/i.test(market)) return "totalBases";
    if (/stolen/i.test(market)) return "stolenBases";
  }

  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    if (/\bpra\b|pts.*reb|pts.*ast|points.*rebounds.*assists/i.test(market)) return "pra";
    if (/point/i.test(market)) return "nbaPoints";
    if (/rebound/i.test(market)) return "rebounds";
    if (/assist/i.test(market)) return "assists";
  }

  return "other";
}

function isAlternateLinePick(pick: ParsedPick): boolean {
  return isAltBoardPick(pick) || isAltPropPick(pick) || !!pick.propIsAlt;
}

function gateMapsToEvRejection(gate: BoardLegGateCode): boolean {
  return gate === "negative_edge" || gate === "negative_ev" || gate === "sim_below_implied";
}

function gateMapsToConfidenceRejection(gate: BoardLegGateCode): boolean {
  return gate === "confidence_below_minimum" || gate === "grade_below_minimum" || gate === "not_sim_aligned";
}

function gateMapsToMarketTypeRejection(gate: BoardLegGateCode): boolean {
  return (
    gate === "unsupported_market" ||
    gate === "missing_odds" ||
    gate === "missing_prop_line" ||
    gate === "no_score" ||
    gate === "no_sim_grade"
  );
}

export type CoachBoardScanAuditRecorder = CoachBoardScanAudit & {
  recordPulledFromApi(pick: ParsedPick, count?: number): void;
  recordDiscardedBeforeScoring(
    pick: ParsedPick,
    reason: ScanAuditDiscardReason,
    count?: number,
  ): void;
  recordBulkDiscardedBeforeScoring(
    picks: ParsedPick[],
    reason: ScanAuditDiscardReason,
  ): void;
  recordScored(leg: BoardScoredLeg): void;
  recordGateRejection(pick: ParsedPick, gate: BoardLegGateCode): void;
  recordGroundingRejection(pick: ParsedPick): void;
  recordFinalCandidate(pick: ParsedPick): void;
  recordPositiveEdgePool(scored: BoardScoredLeg[]): void;
  setRequestId(requestId: string): void;
  snapshot(): CoachBoardScanAudit;
};

export function createCoachBoardScanAuditRecorder(requestId?: string): CoachBoardScanAuditRecorder {
  const audit = emptyCoachBoardScanAudit();
  if (requestId) audit.requestId = requestId;
  const pulledSeen = new Set<string>();
  const scoredSeen = new Set<string>();

  const recorder: CoachBoardScanAuditRecorder = Object.assign(audit, {
    setRequestId(id: string) {
      audit.requestId = id;
    },
    recordPulledFromApi(pick: ParsedPick, count = 1) {
      const fp = pickFingerprint(pick);
      if (pulledSeen.has(fp)) return;
      pulledSeen.add(fp);
      const bucket = classifyScanAuditMarketBucket(pick);
      bumpFunnel(audit.totals, "pulledFromApi", count);
      bumpFunnel(audit.byMarket[bucket], "pulledFromApi", count);
    },
    recordDiscardedBeforeScoring(pick: ParsedPick, reason: ScanAuditDiscardReason, count = 1) {
      const bucket = classifyScanAuditMarketBucket(pick);
      bumpFunnel(audit.totals, "discardedBeforeScoring", count);
      bumpFunnel(audit.byMarket[bucket], "discardedBeforeScoring", count);
      bumpDiscard(audit, reason, count);
    },
    recordBulkDiscardedBeforeScoring(picks: ParsedPick[], reason: ScanAuditDiscardReason) {
      for (const pick of picks) recorder.recordDiscardedBeforeScoring(pick, reason);
    },
    recordScored(leg: BoardScoredLeg) {
      const fp = pickFingerprint(leg.pick);
      if (scoredSeen.has(fp)) return;
      scoredSeen.add(fp);
      const bucket = classifyScanAuditMarketBucket(leg.pick);
      bumpFunnel(audit.totals, "scored");
      bumpFunnel(audit.byMarket[bucket], "scored");
    },
    recordGateRejection(pick: ParsedPick, gate: BoardLegGateCode) {
      const bucket = classifyScanAuditMarketBucket(pick);
      if (gateMapsToEvRejection(gate)) {
        bumpFunnel(audit.totals, "rejectedByEv");
        bumpFunnel(audit.byMarket[bucket], "rejectedByEv");
      } else if (gateMapsToConfidenceRejection(gate)) {
        bumpFunnel(audit.totals, "rejectedByConfidence");
        bumpFunnel(audit.byMarket[bucket], "rejectedByConfidence");
      } else if (gateMapsToMarketTypeRejection(gate)) {
        bumpFunnel(audit.totals, "rejectedMarketType");
        bumpFunnel(audit.byMarket[bucket], "rejectedMarketType");
      } else if (
        isAlternateLinePick(pick) &&
        (gate === "not_ai_recommended" || gate === "not_staged" || gate === "holistic_not_recommended")
      ) {
        bumpFunnel(audit.totals, "rejectedAlternateLines");
        bumpFunnel(audit.byMarket[bucket], "rejectedAlternateLines");
      }
    },
    recordGroundingRejection(pick: ParsedPick) {
      const bucket = classifyScanAuditMarketBucket(pick);
      bumpFunnel(audit.totals, "rejectedByGrounding");
      bumpFunnel(audit.byMarket[bucket], "rejectedByGrounding");
    },
    recordFinalCandidate(pick: ParsedPick) {
      const bucket = classifyScanAuditMarketBucket(pick);
      bumpFunnel(audit.totals, "finalCandidates");
      bumpFunnel(audit.byMarket[bucket], "finalCandidates");
    },
    recordPositiveEdgePool(scored: BoardScoredLeg[]) {
      audit.positiveEdgeCount = positiveEdgeScoredLegs(scored).length;
    },
    snapshot() {
      return {
        requestId: audit.requestId,
        totals: { ...audit.totals },
        byMarket: Object.fromEntries(
          SCAN_AUDIT_MARKET_ORDER.map((b) => [b, { ...audit.byMarket[b] }]),
        ) as Record<ScanAuditMarketBucket, ScanAuditFunnelCounts>,
        discardReasons: { ...audit.discardReasons },
        positiveEdgeCount: audit.positiveEdgeCount,
      };
    },
  });

  return recorder;
}

const DISCARD_REASON_LABELS: Record<ScanAuditDiscardReason, string> = {
  bettable_filter: "Bettable / slate filter",
  game_scope_cap: "Game scope cap (timed scan)",
  prop_sim_cap: "Prop sim cap (ranked pool truncated)",
  unsupported_market: "No simulation model",
  missing_odds: "Missing posted odds",
  missing_line: "Missing prop line or side",
  not_simmed: "Never reached Monte Carlo sim",
  no_sim_grade: "Sim returned no grade",
  other_pre_score: "Other pre-score discard",
};

/** Markdown block for scan manifest / coach detail. */
export function formatCoachBoardScanAudit(auditInput: CoachBoardScanAudit): string {
  const audit = auditInput.totals ? auditInput : emptyCoachBoardScanAudit();
  const t = audit.totals ?? auditInput.totals;
  const lines: string[] = [];
  lines.push("### Scan audit");
  lines.push("");
  lines.push("**Funnel (all markets)**");
  lines.push(`- Markets pulled from API: **${t.pulledFromApi.toLocaleString()}**`);
  lines.push(`- Discarded before scoring: **${t.discardedBeforeScoring.toLocaleString()}**`);
  lines.push(`- Markets scored: **${t.scored.toLocaleString()}**`);
  lines.push(`- Rejected by EV: **${t.rejectedByEv.toLocaleString()}**`);
  lines.push(`- Rejected by confidence: **${t.rejectedByConfidence.toLocaleString()}**`);
  lines.push(`- Rejected by grounding: **${t.rejectedByGrounding.toLocaleString()}**`);
  lines.push(`- Rejected (alternate lines): **${t.rejectedAlternateLines.toLocaleString()}**`);
  lines.push(`- Rejected (market type / unavailable): **${t.rejectedMarketType.toLocaleString()}**`);
  lines.push(`- Final candidates: **${t.finalCandidates.toLocaleString()}**`);
  lines.push(`- Positive-edge pool (delivery bar): **${auditInput.positiveEdgeCount.toLocaleString()}**`);

  const discardEntries = Object.entries(auditInput.discardReasons ?? {}).filter(([, n]) => (n ?? 0) > 0);
  if (discardEntries.length > 0) {
    lines.push("");
    lines.push("**Pre-score discard reasons**");
    for (const [reason, count] of discardEntries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      const label = DISCARD_REASON_LABELS[reason as ScanAuditDiscardReason] ?? reason;
      lines.push(`- ${label}: **${(count ?? 0).toLocaleString()}**`);
    }
  }

  lines.push("");
  lines.push("**Breakdown by market**");
  lines.push("| Market | Pulled | Pre-score discard | Scored | EV− | Conf− | Ground− | Alt− | Type− | Final |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const bucket of SCAN_AUDIT_MARKET_ORDER) {
    const row = auditInput.byMarket[bucket];
    if (!row || row.pulledFromApi === 0) continue;
    lines.push(
      `| ${SCAN_AUDIT_MARKET_LABELS[bucket]} | ${row.pulledFromApi} | ${row.discardedBeforeScoring} | ${row.scored} | ${row.rejectedByEv} | ${row.rejectedByConfidence} | ${row.rejectedByGrounding} | ${row.rejectedAlternateLines} | ${row.rejectedMarketType} | ${row.finalCandidates} |`,
    );
  }

  return lines.join("\n");
}

/** Apply delivery-stage grounding rejections to a finalized audit snapshot. */
export function applyScanAuditGroundingRejections(
  audit: CoachBoardScanAudit,
  picks: ParsedPick[],
): void {
  for (const pick of picks) {
    const bucket = classifyScanAuditMarketBucket(pick);
    bumpFunnel(audit.totals, "rejectedByGrounding");
    bumpFunnel(audit.byMarket[bucket], "rejectedByGrounding");
  }
}

export function logCoachBoardScanAudit(audit: CoachBoardScanAudit, requestId?: string): void {
  const rid = requestId ?? audit.requestId ?? "—";
  const t = audit.totals;
  console.log(
    `${COACH_SCAN_AUDIT_LOG} requestId=${rid} pulled=${t.pulledFromApi} preScoreDiscard=${t.discardedBeforeScoring} scored=${t.scored} evReject=${t.rejectedByEv} confReject=${t.rejectedByConfidence} groundReject=${t.rejectedByGrounding} altReject=${t.rejectedAlternateLines} typeReject=${t.rejectedMarketType} final=${t.finalCandidates} positiveEdge=${audit.positiveEdgeCount}`,
  );
  for (const bucket of SCAN_AUDIT_MARKET_ORDER) {
    const row = audit.byMarket[bucket];
    if (!row?.pulledFromApi) continue;
    console.log(
      `${COACH_SCAN_AUDIT_LOG} market=${bucket} pulled=${row.pulledFromApi} discard=${row.discardedBeforeScoring} scored=${row.scored} final=${row.finalCandidates}`,
    );
  }
}
