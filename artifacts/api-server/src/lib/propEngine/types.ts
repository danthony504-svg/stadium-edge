// Cross-sport prop engine types — reused by tennis, UFC, MLB, NBA, etc.

export type PropSide = "Over" | "Under" | "Yes" | "No";

/** One posted prop rung (main or alt) from any sportsbook. */
export type PropLine = {
  sport: string;
  eventId: string;
  matchLabel: string;
  awayName: string;
  homeName: string;
  subject: string; // player or fighter name
  market: string;
  marketLabel: string;
  line: number | null;
  side: PropSide;
  odds: number;
  book: string;
  alt: boolean;
  commenceTime?: string | null;
  /** Pre-computed from multi-book de-vig when available (team sports). */
  fairProb?: number | null;
  edgePct?: number | null;
  evPct?: number | null;
};

export type PropSimResult = {
  simulations: number;
  hitProbability: number | null;
  meanProjection: number | null;
  confidenceScore: number | null;
  lineHitRates?: Record<string, number>;
};

export type PropGrade = {
  edgePct: number | null;
  evPct: number | null;
  fairProb: number | null;
  simHit: number | null;
  composite: number | null;
  grade: string | null;
  confidencePct: number | null;
  recommends: boolean;
  skipReason: string | null;
};

export type PropRecommendation = {
  line: PropLine;
  sim: PropSimResult;
  grade: PropGrade;
  adjustedComposite: number | null;
  rankScore: number | null;
};

export type PropEngineResult = {
  sport: string;
  matchLabel: string;
  analyzed: number;
  recommended: PropRecommendation[];
  skipped: Array<{ line: PropLine; grade: PropGrade }>;
  vendorStatus: {
    propsAvailable: boolean;
    statsComplete: boolean;
    message: string | null;
  };
};

export type PropLearningRow = {
  sport: string;
  market: string;
  outcome: "win" | "loss" | "push";
};

export type AnalyzePropsInput = {
  sport: string;
  away: string;
  home: string;
  eventId?: string;
  simulations?: number;
  learningHistory?: PropLearningRow[];
  maxRecommendations?: number;
};

/** Sport adapter contract — plug in per-league logic. */
export type SportPropAdapter = {
  sports: string[];
  fetchLines(input: AnalyzePropsInput): Promise<PropLine[]>;
  buildContext(input: AnalyzePropsInput): Promise<unknown>;
  simulate(line: PropLine, ctx: unknown, simulations: number): Promise<PropSimResult>;
  statsComplete(ctx: unknown): boolean;
};
