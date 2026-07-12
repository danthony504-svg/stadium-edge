/** Coach v2 API shapes — mirrors @workspace/coach-types mobile contract. */

export type CoachV2PickDisplay = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport: string;
  isProp: boolean;
  startsAt: string | null;
  player?: string | null;
  propLine?: number | null;
  propSide?: string | null;
  propIsAlt?: boolean;
  edgePct: number;
  evPct: number;
  simHitPct: number;
  confidencePct: number;
  grade: string;
  compositeScore: number;
  headshot?: string | null;
  teamAbbr?: string | null;
  teamLogo?: string | null;
};

export type CoachV2Ticket = {
  requestedLegs: number;
  deliveredLegs: number;
  picks: CoachV2PickDisplay[];
  propCount: number;
  gameLineCount: number;
  assembledAt: string;
};

export type CoachV2Shortfall = {
  code: "insufficient_qualified_legs";
  message: string;
  requestedLegs: number;
  deliveredLegs: number;
  propsQualified: number;
  gameLinesQualified: number;
  topRejections: Array<{ reason: string; count: number }>;
};

export type CoachV2ScanManifest = {
  contextFingerprint: string;
  scanComplete: boolean;
  deepSimComplete: boolean;
  candidatesEvaluated: number;
  gatesPassed: number;
  gatesRejected: number;
};

export type CoachV2Snapshot = {
  at: number;
  fingerprint: string;
  manifest: CoachV2ScanManifest;
  tickets: {
    global: Partial<Record<number, CoachV2Ticket>>;
    bySport: Partial<Record<string, Partial<Record<number, CoachV2Ticket>>>>;
  };
  activeSports: string[];
  deepSimComplete: boolean;
  serveable: boolean;
  propsQualified: number;
  gameLinesQualified: number;
};

export type CoachV2SlateResponse = {
  snapshot: CoachV2Snapshot | null;
  fresh: boolean;
  instantServe: boolean;
  refreshing: boolean;
  computedAt: string | null;
  deepSimComplete: boolean;
  maxAgeMs: number;
  activeSports: string[];
};

export type CoachV2TicketResponse = {
  ticket: CoachV2Ticket;
  shortfall: CoachV2Shortfall | null;
  ready: boolean;
  deepSimComplete: boolean;
  manifest: CoachV2ScanManifest;
  refreshing: boolean;
};
