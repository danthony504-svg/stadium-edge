// Shared pick types — no React/UI imports (safe for node --test / headless scan).

import type { CombinedPickScore } from "./pickScore.ts";
import type { FinalAiScore } from "./finalAiScore.ts";

export type AltRungOption = {
  side: string;
  line: number;
  odds: number;
  pick: string;
  market?: string;
  simMetrics?: {
    winProb: number;
    edgePct: number;
    evPct: number;
    confidencePct: number;
    grade: string;
  };
};

export type SimAltTierLabel = "Safest" | "Best" | "Best Value" | "High Risk";

export type SimAltLine = AltRungOption & {
  tierLabel: SimAltTierLabel;
};

export type ParsedPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  edge?: string;
  sport?: string;
  isProp?: boolean;
  startsAt?: string | null;
  headshot?: string | null;
  teamLogo?: string | null;
  teamAbbr?: string | null;
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  altOptions?: {
    cushion?: AltRungOption;
    value?: AltRungOption;
    highConfidence?: AltRungOption;
  };
  simAltLines?: SimAltLine[];
  athleteId?: string | null;
  player?: string;
  propMarketKey?: string;
  propLine?: number | null;
  propSide?: string;
  simulationPending?: boolean;
  scores?: CombinedPickScore | null;
  finalAiScore?: FinalAiScore | null;
  highRiskValuePlay?: boolean;
  injuryDataUnavailable?: boolean;
  ticketRole?: "main" | "alt";
  coachFillTier?: "A+" | "A" | "A-" | "B+" | "B";
  coachConfidenceLabel?: "Medium confidence";
  coachDelivered?: boolean;
  coachDeliveryTier?: 1 | 2 | 3 | 4;
  coachAlternateLineLabel?: "Alternate line";
  propIsAlt?: boolean;
  edgeNum?: number;
};
