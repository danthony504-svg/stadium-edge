/**
 * Phase 2.4 AUDIT-ONLY shared state for distributionForQuery instrumentation.
 * Loaded by temporarily gated hooks in gameSimScoring / boardMarketScanner.
 */
export type Phase24DistCall = {
  call: number;
  gameId: string;
  market: string;
  queryId: string;
  kind: string;
  teamSide: string;
  totalSide: string;
  line: string;
  period: string;
  materialContextFingerprint: string;
  seed: null;
  simulations: number;
  reuseKey: string;
  wallMs: number;
  cacheHit: boolean;
  mode: "A" | "B" | "C";
};

export type Phase24DistAuditState = {
  enabled: boolean;
  mode: "A" | "B" | "C";
  /** Yield after every N games scored (mode C). */
  yieldEveryGames: number;
  calls: Phase24DistCall[];
  cache: Map<string, { mean: number | null; median: number | null; stdev: number | null }>;
  cacheHits: number;
  cacheMisses: number;
  distCpuMs: number;
  yieldCount: number;
};

function createState(): Phase24DistAuditState {
  return {
    enabled: false,
    mode: "A",
    yieldEveryGames: 1,
    calls: [],
    cache: new Map(),
    cacheHits: 0,
    cacheMisses: 0,
    distCpuMs: 0,
    yieldCount: 0,
  };
}

const g = globalThis as typeof globalThis & { __phase24DistAudit?: Phase24DistAuditState };

export function phase24DistAudit(): Phase24DistAuditState {
  if (!g.__phase24DistAudit) g.__phase24DistAudit = createState();
  return g.__phase24DistAudit;
}

export function resetPhase24DistAudit(mode: "A" | "B" | "C" = "A"): Phase24DistAuditState {
  const s = createState();
  s.enabled = true;
  s.mode = mode;
  g.__phase24DistAudit = s;
  return s;
}

export function disablePhase24DistAudit(): void {
  g.__phase24DistAudit = createState();
}

/** Reuse key matching what distributionForQuery actually computes (ignores line/totalSide/period). */
export function distReuseKey(
  materialFp: string,
  kind: string,
  teamSide: string | undefined,
): string {
  if (kind === "total") return `${materialFp}|total`;
  if (kind === "ml" || kind === "spread" || kind === "teamTotal") {
    return `${materialFp}|${kind}|${teamSide ?? ""}`;
  }
  // raceTo / unknown — distributionForQuery returns null stats from outcomes path
  return `${materialFp}|${kind}|${teamSide ?? ""}`;
}

export function materialContextFingerprint(sim: {
  simulations?: number;
  homeProjectedScore?: number | null;
  awayProjectedScore?: number | null;
  outcomes?: { homeScores: number[]; awayScores: number[] };
}): string {
  const n = sim.simulations ?? sim.outcomes?.homeScores?.length ?? 0;
  const hs = sim.outcomes?.homeScores;
  const as = sim.outcomes?.awayScores;
  if (hs?.length && as?.length) {
    const i0 = 0;
    const i1 = Math.min(1, hs.length - 1);
    const iMid = Math.floor(hs.length / 2);
    const iLast = hs.length - 1;
    return [
      `n=${n}`,
      `h0=${hs[i0]}`,
      `a0=${as[i0]}`,
      `h1=${hs[i1]}`,
      `a1=${as[i1]}`,
      `hmid=${hs[iMid]}`,
      `amid=${as[iMid]}`,
      `hL=${hs[iLast]}`,
      `aL=${as[iLast]}`,
      `proj=${sim.homeProjectedScore ?? ""}/${sim.awayProjectedScore ?? ""}`,
    ].join("|");
  }
  return `n=${n}|proj=${sim.homeProjectedScore ?? ""}/${sim.awayProjectedScore ?? ""}|no-outcomes`;
}
