export type CoverageCounts = {
  listed: number;
  settledOk: number;
  unsupported: number;
  missingData: number;
  integrityReject: number;
};

export type CoverageReport = CoverageCounts & {
  coveragePct: number | null;
  rejectPct: number | null;
};

export function marketCoverage(counts: CoverageCounts): CoverageReport {
  const { listed, settledOk, unsupported, missingData, integrityReject } = counts;
  if (listed <= 0) {
    return { ...counts, coveragePct: null, rejectPct: null };
  }
  const rejects = unsupported + missingData + integrityReject;
  return {
    ...counts,
    coveragePct: (settledOk / listed) * 100,
    rejectPct: (rejects / listed) * 100,
  };
}
