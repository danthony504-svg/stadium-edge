import { z } from "zod";

import { COACH_GATE_IDS } from "../gates";
import { COACH_SPORT_IDS } from "../sports";

export const coachSportIdSchema = z.enum(COACH_SPORT_IDS);
export const coachSportIdOrCustomSchema = z.union([coachSportIdSchema, z.string().min(1)]);

export const coachGateIdSchema = z.enum(COACH_GATE_IDS);

export const coachGateReasonCodeSchema = z.enum([
  "sim_incomplete",
  "sim_iterations_insufficient",
  "ev_not_positive",
  "edge_not_positive",
  "confidence_below_threshold",
  "matchup_failed",
  "trends_insufficient_sample",
  "trends_failed",
  "injury_material_absence",
  "line_movement_against_pick",
  "sport_market_unsupported",
  "sport_rule_violation",
  "market_no_sim_model",
  "alt_line_failed",
  "passed",
]);

export const coachGateResultSchema = z.object({
  gateId: coachGateIdSchema,
  pass: z.boolean(),
  reasonCode: coachGateReasonCodeSchema,
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const coachGateEvaluationSchema = z.object({
  legFingerprint: z.string().min(1),
  sport: coachSportIdOrCustomSchema,
  results: z.array(coachGateResultSchema),
  allPassed: z.boolean(),
  failedGateId: coachGateIdSchema.nullable(),
});

export const coachSimTierSchema = z.enum(["quick", "deep"]);

export const coachSimResultSchema = z.object({
  legFingerprint: z.string().min(1),
  tier: coachSimTierSchema,
  iterations: z.number().int().nonnegative(),
  hitProbability: z.number().min(0).max(1),
  evPct: z.number(),
  edgePct: z.number(),
  distributionSummary: z.record(z.unknown()).optional(),
  computedAt: z.string().datetime(),
});

export const coachSimCacheEntrySchema = z.object({
  legFingerprint: z.string().min(1),
  contextFingerprint: z.string().min(1),
  simResult: coachSimResultSchema,
  computedAt: z.string().datetime(),
});

export const coachCandidateKindSchema = z.enum(["player_prop", "game_line"]);
export const coachPropSideSchema = z.enum(["Over", "Under"]);

export const coachCandidateLegSchema = z.object({
  legId: z.string().min(1),
  legFingerprint: z.string().min(1),
  kind: coachCandidateKindSchema,
  sport: coachSportIdOrCustomSchema,
  gameId: z.string().min(1),
  gameLabel: z.string().min(1),
  marketKey: z.string().min(1),
  marketLabel: z.string().min(1),
  pick: z.string().min(1),
  odds: z.number(),
  line: z.number().nullable(),
  startsAt: z.string().datetime().nullable(),
  isAlt: z.boolean(),
  playerId: z.string().nullable().optional(),
  playerName: z.string().nullable().optional(),
  propSide: coachPropSideSchema.optional(),
  book: z.string().nullable().optional(),
});

export const coachQualifiedLegSchema = coachCandidateLegSchema.extend({
  simHitPct: z.number().min(0).max(100),
  evPct: z.number(),
  edgePct: z.number(),
  confidencePct: z.number().min(0).max(100),
  compositeScore: z.number(),
  grade: z.string().min(1),
  gateEvaluation: coachGateEvaluationSchema,
});

export const coachScanPhaseSchema = z.enum([
  "idle",
  "warming_caches",
  "enumerating_markets",
  "simulating",
  "gating",
  "ranking",
  "assembling_tickets",
  "complete",
  "failed",
]);

export const coachScanManifestSchema = z
  .object({
    contextFingerprint: z.string().min(1),
    scanStartedAt: z.string().datetime(),
    scanCompletedAt: z.string().datetime().nullable(),
    phase: coachScanPhaseSchema,
    sports: z.array(coachSportIdOrCustomSchema),
    marketsPosted: z.number().int().nonnegative(),
    marketsSeen: z.number().int().nonnegative(),
    propsPosted: z.number().int().nonnegative(),
    propsSeen: z.number().int().nonnegative(),
    gameLinesPosted: z.number().int().nonnegative(),
    gameLinesSeen: z.number().int().nonnegative(),
    altLinesPosted: z.number().int().nonnegative(),
    altLinesSeen: z.number().int().nonnegative(),
    candidatesEvaluated: z.number().int().nonnegative(),
    simCacheHits: z.number().int().nonnegative(),
    simCacheMisses: z.number().int().nonnegative(),
    deepSimComplete: z.boolean(),
    scanComplete: z.boolean(),
    gatesPassed: z.number().int().nonnegative(),
    gatesRejected: z.number().int().nonnegative(),
    rejectionBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  })
  .superRefine((val, ctx) => {
    if (val.scanComplete) {
      if (val.marketsSeen < val.marketsPosted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scanComplete requires marketsSeen >= marketsPosted",
        });
      }
      if (val.propsSeen < val.propsPosted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scanComplete requires propsSeen >= propsPosted",
        });
      }
    }
  });

export const coachPickDisplaySchema = z.object({
  game: z.string().min(1),
  market: z.string().min(1),
  pick: z.string().min(1),
  odds: z.number(),
  sport: coachSportIdOrCustomSchema,
  isProp: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  player: z.string().nullable().optional(),
  propLine: z.number().nullable().optional(),
  propSide: z.string().nullable().optional(),
  propIsAlt: z.boolean().optional(),
  edgePct: z.number(),
  evPct: z.number(),
  simHitPct: z.number(),
  confidencePct: z.number(),
  grade: z.string(),
  compositeScore: z.number(),
  headshot: z.string().nullable().optional(),
  teamAbbr: z.string().nullable().optional(),
  teamLogo: z.string().nullable().optional(),
});

export const coachTicketSchema = z
  .object({
    requestedLegs: z.number().int().positive(),
    deliveredLegs: z.number().int().nonnegative(),
    picks: z.array(coachPickDisplaySchema),
    propCount: z.number().int().nonnegative(),
    gameLineCount: z.number().int().nonnegative(),
    assembledAt: z.string().datetime(),
  })
  .superRefine((val, ctx) => {
    if (val.picks.length !== val.deliveredLegs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "picks.length must equal deliveredLegs",
      });
    }
    if (val.propCount + val.gameLineCount !== val.deliveredLegs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "propCount + gameLineCount must equal deliveredLegs",
      });
    }
  });

export const coachShortfallReasonSchema = z.object({
  code: z.literal("insufficient_qualified_legs"),
  message: z.string().min(1),
  requestedLegs: z.number().int().positive(),
  deliveredLegs: z.number().int().nonnegative(),
  propsQualified: z.number().int().nonnegative(),
  gameLinesQualified: z.number().int().nonnegative(),
  topRejections: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

export const coachTicketResponseSchema = z
  .object({
    ticket: coachTicketSchema,
    shortfall: coachShortfallReasonSchema.nullable(),
    ready: z.boolean(),
    deepSimComplete: z.boolean(),
    manifest: coachScanManifestSchema,
    refreshing: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.ready && val.ticket.deliveredLegs === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ready tickets must have deliveredLegs > 0",
      });
    }
    if (val.ticket.deliveredLegs > val.ticket.requestedLegs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deliveredLegs cannot exceed requestedLegs",
      });
    }
  });

export const coachParlayLegCountSchema = z.union([
  z.literal(3),
  z.literal(5),
  z.literal(6),
  z.literal(9),
  z.literal(10),
  z.literal(15),
]);

export const coachTicketsIndexSchema = z.object({
  global: z.record(z.coerce.number(), coachTicketSchema).optional().default({}),
  bySport: z.record(z.string(), z.record(z.coerce.number(), coachTicketSchema)).optional().default({}),
});

export const coachSnapshotSchema = z.object({
  at: z.number().int().positive(),
  fingerprint: z.string().min(1),
  manifest: coachScanManifestSchema,
  tickets: coachTicketsIndexSchema,
  activeSports: z.array(coachSportIdOrCustomSchema),
  deepSimComplete: z.boolean(),
  serveable: z.boolean(),
  propsQualified: z.number().int().nonnegative(),
  gameLinesQualified: z.number().int().nonnegative(),
});

export const coachV2SlateResponseSchema = z.object({
  snapshot: coachSnapshotSchema.nullable(),
  fresh: z.boolean(),
  instantServe: z.boolean(),
  refreshing: z.boolean(),
  computedAt: z.string().datetime().nullable(),
  deepSimComplete: z.boolean(),
  maxAgeMs: z.number().int().positive(),
  activeSports: z.array(z.string()),
});

export const coachScanStatusSchema = z.object({
  jobRunning: z.boolean(),
  manifest: coachScanManifestSchema.nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const coachLearningStateSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  adjustments: z.array(
    z.object({
      sport: coachSportIdOrCustomSchema,
      marketKey: z.string(),
      rankWeightMultiplier: z.number().positive(),
      confidenceAdjustmentPct: z.number(),
      sampleSize: z.number().int().nonnegative(),
    }),
  ),
});
