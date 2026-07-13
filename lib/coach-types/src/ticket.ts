import type { CoachParlayLegCount } from "./constants";
import type { CoachSportIdOrCustom } from "./sports";
import type { CoachQualifiedLeg } from "./candidates";
import type { CoachScanManifest } from "./scan";

export type CoachPickDisplay = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport: CoachSportIdOrCustom;
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

export type CoachTicket = {
  requestedLegs: number;
  deliveredLegs: number;
  picks: CoachPickDisplay[];
  propCount: number;
  gameLineCount: number;
  assembledAt: string;
};

export type CoachShortfallReason = {
  code: "insufficient_qualified_legs";
  message: string;
  requestedLegs: number;
  deliveredLegs: number;
  propsQualified: number;
  gameLinesQualified: number;
  topRejections: Array<{ reason: string; count: number }>;
};

export type CoachTicketResponse = {
  ticket: CoachTicket;
  shortfall: CoachShortfallReason | null;
  ready: boolean;
  deepSimComplete: boolean;
  manifest: CoachScanManifest;
  refreshing: boolean;
};

export type CoachTicketsIndex = {
  global: Partial<Record<CoachParlayLegCount, CoachTicket>>;
  bySport: Partial<Record<string, Partial<Record<CoachParlayLegCount, CoachTicket>>>>;
};

export type CoachSnapshot = {
  at: number;
  fingerprint: string;
  manifest: CoachScanManifest;
  tickets: CoachTicketsIndex;
  activeSports: CoachSportIdOrCustom[];
  deepSimComplete: boolean;
  serveable: boolean;
  propsQualified: number;
  gameLinesQualified: number;
};
