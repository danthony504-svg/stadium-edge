/**
 * Coach QA harness — shared types (audit-only; no production behavior changes).
 */

export type Severity = "P0" | "P1" | "P2" | "P3";

export type QaCategory =
  | "parser"
  | "state_leak"
  | "market_coverage"
  | "provider_integrity"
  | "mapping"
  | "ticket_construction"
  | "recovery_alt"
  | "date_sport_team"
  | "simulation"
  | "performance"
  | "crash_timeout"
  | "data_quality"
  | "failure_injection";

export type AskSnapshot = {
  ask: string;
  priorUserTexts: string[];
  requestedLegs: number;
  focalSports: string[];
  boardSports: string[];
  slateDay: "tonight" | "tomorrow" | null;
  propsOnly: boolean;
  gameLinesOnly: boolean;
  allowedMarketKeys: string[] | null;
  marketFamilyLabel: string | null;
  isMarketLocked: boolean;
  teamScope: { sport: string; matchTokens: string[] } | null;
  excludedTeams: Array<{ sport: string; matchTokens: string[] }>;
  wantsPropsOnlyCurrent: boolean;
  threadWantsPropsOnly: boolean;
  pathHint: "props_only" | "game_lines_only" | "full_board_mix";
};

export type QaFinding = {
  id: string;
  severity: Severity;
  category: QaCategory;
  title: string;
  promptOrSequence: string | string[];
  seed?: number;
  expected: string;
  actual: string;
  stage: string;
  likelyFile: string;
  productionAffected: boolean;
};

export type QaCaseResult = {
  id: string;
  suite: string;
  ok: boolean;
  warning?: boolean;
  finding?: QaFinding;
  meta?: Record<string, unknown>;
};

export type QaReport = {
  generatedAt: string;
  seed: number;
  totals: {
    tests: number;
    passed: number;
    failed: number;
    warnings: number;
  };
  byCategory: Record<string, { passed: number; failed: number; warnings: number }>;
  findings: QaFinding[];
  sportMarketMatrix: Array<{
    sport: string;
    marketFamily: string;
    requestType: string;
    status: "PASS" | "FAIL" | "WARN" | "SKIP";
    note?: string;
  }>;
  sequentialSummary: {
    transitions: number;
    staleLeaks: number;
  };
  fuzzSummary: {
    sequences: number;
    failures: number;
  };
  notes: string[];
};
