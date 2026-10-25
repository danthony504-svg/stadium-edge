/**
 * Research archive of original pregame prop probabilities + exact selections.
 * Hot path only enqueues; persistence is bounded and never blocks Coach latency.
 *
 * Does not settle or rewrite probabilities. NCAAF game-model release gates are
 * untouched — this is player-prop measurement only.
 */
import { createHash } from "node:crypto";

export type PropPregameArchiveSelection = {
  sport: string;
  eventId: string | null;
  athleteId: string | null;
  player: string;
  market: string;
  side: string;
  line: number;
  oddsAmerican: number | null;
  sportsbook: string | null;
  sourceUpdatedAt: string | null;
  hitProbability: number | null;
  simulations: number | null;
  meanProjection: number | null;
  confidenceScore: number | null;
  grade: string | null;
  datasetRole: "pregame_research";
};

export type PropPregameArchiveRecord = {
  key: string;
  recordedAt: string;
  kickoff: string | null;
  selection: PropPregameArchiveSelection;
  /** SHA-256 of canonical selection identity (sport/event/athlete/market/side/line). */
  selectionFingerprint: string;
};

const MAX_BUFFER = 500;
const buffer: PropPregameArchiveRecord[] = [];
let persistHandler:
  | ((records: readonly PropPregameArchiveRecord[]) => Promise<void>)
  | null = null;

export function propSelectionFingerprint(sel: {
  sport: string;
  eventId: string | null;
  athleteId: string | null;
  market: string;
  side: string;
  line: number;
}): string {
  const canon = [
    String(sel.sport ?? "").toLowerCase(),
    sel.eventId ?? "",
    sel.athleteId ?? "",
    String(sel.market ?? "").toLowerCase(),
    String(sel.side ?? "").toLowerCase(),
    Number(sel.line).toFixed(3),
  ].join("|");
  return createHash("sha256").update(canon).digest("hex");
}

export function archiveKeyForSelection(
  sel: Parameters<typeof propSelectionFingerprint>[0],
  recordedAtIso: string,
): string {
  const fp = propSelectionFingerprint(sel).slice(0, 24);
  return `research:props:pregame:${String(sel.sport).toLowerCase()}:${fp}:${recordedAtIso}`;
}

export function buildPropPregameArchiveRecord(input: {
  selection: Omit<PropPregameArchiveSelection, "datasetRole">;
  kickoff?: string | null;
  now?: Date;
}): PropPregameArchiveRecord {
  const recordedAt = (input.now ?? new Date()).toISOString();
  const selection: PropPregameArchiveSelection = {
    ...input.selection,
    datasetRole: "pregame_research",
  };
  const selectionFingerprint = propSelectionFingerprint(selection);
  return {
    key: archiveKeyForSelection(selection, recordedAt),
    recordedAt,
    kickoff: input.kickoff ?? null,
    selection,
    selectionFingerprint,
  };
}

/** Test / operator hook — swap persistence without touching the hot path. */
export function setPropPregameArchivePersistHandler(
  handler: ((records: readonly PropPregameArchiveRecord[]) => Promise<void>) | null,
): void {
  persistHandler = handler;
}

export function peekPropPregameArchiveBuffer(): readonly PropPregameArchiveRecord[] {
  return buffer;
}

export function clearPropPregameArchiveBuffer(): void {
  buffer.length = 0;
}

function pushBounded(record: PropPregameArchiveRecord): void {
  buffer.push(record);
  while (buffer.length > MAX_BUFFER) buffer.shift();
}

/**
 * Enqueue archive rows without awaiting I/O. Safe to call after res.json.
 */
export function enqueuePropPregameArchive(
  records: readonly PropPregameArchiveRecord[],
): void {
  if (!records.length) return;
  for (const r of records) pushBounded(r);
  const snapshot = records.slice();
  const handler = persistHandler;
  if (!handler) return;
  setImmediate(() => {
    void handler(snapshot).catch(() => {
      /* research archive must never surface to Coach */
    });
  });
}

/** Map simulate rows → archive records when deep sims produced finite hit%. */
export function archiveRecordsFromPropSimRows(input: {
  sport: string;
  eventId?: string | null;
  kickoff?: string | null;
  simulations: number;
  rows: ReadonlyArray<{
    player?: string;
    athleteId?: string | null;
    market?: string;
    side?: string;
    line?: number | null;
    hitProbability?: number | null;
    meanProjection?: number | null;
    confidenceScore?: number | null;
    grade?: string | null;
    overBook?: string | null;
    underBook?: string | null;
    overOdds?: number | null;
    underOdds?: number | null;
    overSourceUpdatedAt?: string | null;
    underSourceUpdatedAt?: string | null;
  }>;
  now?: Date;
}): PropPregameArchiveRecord[] {
  const out: PropPregameArchiveRecord[] = [];
  for (const row of input.rows) {
    if (row.hitProbability == null || !Number.isFinite(row.hitProbability)) continue;
    if (row.line == null || !Number.isFinite(Number(row.line))) continue;
    const side = String(row.side ?? "").toLowerCase();
    if (side !== "over" && side !== "under") continue;
    const sportsbook =
      side === "over" ? (row.overBook ?? null) : (row.underBook ?? null);
    const oddsAmerican =
      side === "over" ? (row.overOdds ?? null) : (row.underOdds ?? null);
    const sourceUpdatedAt =
      side === "over"
        ? (row.overSourceUpdatedAt ?? null)
        : (row.underSourceUpdatedAt ?? null);
    out.push(
      buildPropPregameArchiveRecord({
        kickoff: input.kickoff ?? null,
        now: input.now,
        selection: {
          sport: input.sport,
          eventId: input.eventId ?? null,
          athleteId: row.athleteId ?? null,
          player: String(row.player ?? ""),
          market: String(row.market ?? ""),
          side,
          line: Number(row.line),
          oddsAmerican:
            oddsAmerican != null && Number.isFinite(Number(oddsAmerican))
              ? Number(oddsAmerican)
              : null,
          sportsbook,
          sourceUpdatedAt,
          hitProbability: row.hitProbability,
          simulations: input.simulations,
          meanProjection: row.meanProjection ?? null,
          confidenceScore: row.confidenceScore ?? null,
          grade: row.grade ?? null,
        },
      }),
    );
  }
  return out;
}
