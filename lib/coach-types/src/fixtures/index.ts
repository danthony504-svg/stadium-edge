import type {
  CoachGateEvaluation,
  CoachScanManifest,
  CoachSnapshot,
  CoachTicket,
  CoachTicketResponse,
} from "../index";

const gateEvaluationFixture: CoachGateEvaluation = {
  legFingerprint: "mlb:game1:player_hits:over:1.5:-110",
  sport: "mlb",
  results: [
    {
      gateId: "simulation",
      pass: true,
      reasonCode: "passed",
      message: "Deep simulation complete (10000 iterations)",
    },
    {
      gateId: "positive_ev",
      pass: true,
      reasonCode: "passed",
      message: "EV +4.2%",
    },
    {
      gateId: "positive_edge",
      pass: true,
      reasonCode: "passed",
      message: "Edge +3.1%",
    },
    {
      gateId: "confidence_threshold",
      pass: true,
      reasonCode: "passed",
      message: "Confidence 58%",
    },
    {
      gateId: "matchup",
      pass: true,
      reasonCode: "passed",
      message: "Matchup favorable",
    },
    {
      gateId: "trends",
      pass: true,
      reasonCode: "passed",
      message: "Trend supports pick",
    },
    {
      gateId: "injuries",
      pass: true,
      reasonCode: "passed",
      message: "No material injuries",
    },
    {
      gateId: "line_movement",
      pass: true,
      reasonCode: "passed",
      message: "Line stable",
    },
    {
      gateId: "sport_specific",
      pass: true,
      reasonCode: "passed",
      message: "MLB rules satisfied",
    },
    {
      gateId: "market_sim_support",
      pass: true,
      reasonCode: "passed",
      message: "Simulation model available",
    },
  ],
  allPassed: true,
  failedGateId: null,
};

export const scanManifestFixture: CoachScanManifest = {
  contextFingerprint: "ctx:mlb:2026-07-12:abc123",
  scanStartedAt: "2026-07-12T20:00:00.000Z",
  scanCompletedAt: "2026-07-12T20:04:32.000Z",
  phase: "complete",
  sports: ["mlb"],
  marketsPosted: 124,
  marketsSeen: 124,
  propsPosted: 892,
  propsSeen: 892,
  gameLinesPosted: 48,
  gameLinesSeen: 48,
  altLinesPosted: 76,
  altLinesSeen: 76,
  candidatesEvaluated: 1016,
  simCacheHits: 812,
  simCacheMisses: 204,
  deepSimComplete: true,
  scanComplete: true,
  gatesPassed: 47,
  gatesRejected: 969,
  rejectionBreakdown: {
    line_movement_against_pick: 142,
    confidence_below_threshold: 89,
    ev_not_positive: 310,
  },
};

const basePick = {
  game: "NYY @ BOS",
  market: "Player Hits",
  pick: "Over 1.5",
  odds: -110,
  sport: "mlb" as const,
  isProp: true,
  startsAt: "2026-07-12T23:10:00.000Z",
  player: "Aaron Judge",
  propLine: 1.5,
  propSide: "Over",
  edgePct: 3.1,
  evPct: 4.2,
  simHitPct: 56.2,
  confidencePct: 58,
  grade: "B+",
  compositeScore: 78.4,
};

const fiveLegPicks = [
  basePick,
  { ...basePick, market: "Player RBIs", pick: "Over 0.5", player: "Juan Soto" },
  { ...basePick, market: "Player Runs", pick: "Over 0.5", player: "Mookie Betts" },
  { ...basePick, market: "Player Total Bases", pick: "Over 1.5", player: "Rafael Devers" },
  {
    ...basePick,
    market: "Moneyline",
    pick: "NYY ML",
    isProp: false,
    player: null,
    propLine: null,
    propSide: null,
  },
];

export const ticketFixture: CoachTicket = {
  requestedLegs: 5,
  deliveredLegs: 5,
  propCount: 4,
  gameLineCount: 1,
  assembledAt: "2026-07-12T20:04:33.000Z",
  picks: fiveLegPicks,
};

const eightLegPicks = [
  ...fiveLegPicks,
  { ...basePick, market: "Player Strikeouts", pick: "Over 5.5", player: "Gerrit Cole" },
  { ...basePick, market: "Player Walks", pick: "Under 1.5", player: "Aaron Judge" },
  { ...basePick, market: "Player Home Runs", pick: "Over 0.5", player: "Giancarlo Stanton" },
];

export const partialTicketResponseFixture: CoachTicketResponse = {
  ticket: {
    requestedLegs: 10,
    deliveredLegs: 8,
    propCount: 7,
    gameLineCount: 1,
    assembledAt: "2026-07-12T20:04:33.000Z",
    picks: eightLegPicks,
  },
  shortfall: {
    code: "insufficient_qualified_legs",
    message:
      "Only 8 legs passed all AI gates in the 48h window. 892 props scanned, 47 passed gates. No filler picks added.",
    requestedLegs: 10,
    deliveredLegs: 8,
    propsQualified: 42,
    gameLinesQualified: 5,
    topRejections: [
      { reason: "line_movement_against_pick", count: 142 },
      { reason: "confidence_below_threshold", count: 89 },
    ],
  },
  ready: true,
  deepSimComplete: true,
  manifest: scanManifestFixture,
  refreshing: false,
};

export const snapshotFixture: CoachSnapshot = {
  at: 1_752_955_473_000,
  fingerprint: "snap:mlb:2026-07-12:abc123",
  manifest: scanManifestFixture,
  activeSports: ["mlb"],
  deepSimComplete: true,
  serveable: true,
  propsQualified: 42,
  gameLinesQualified: 5,
  tickets: {
    global: {
      5: ticketFixture,
    },
    bySport: {
      mlb: {
        5: ticketFixture,
      },
    },
  },
};

export const fixtures = {
  gateEvaluation: gateEvaluationFixture,
  scanManifest: scanManifestFixture,
  ticket: ticketFixture,
  partialTicketResponse: partialTicketResponseFixture,
  snapshot: snapshotFixture,
};
