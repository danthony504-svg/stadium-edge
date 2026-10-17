/**
 * Durable ESPN injury snapshot storage — timestamped files, minute-bucket
 * dedupe, append-only failure journal. Does not touch frozen ML or product gates.
 */

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type InjurySnapshotPayload = {
  source: string;
  captureTimestamp: string;
  captureNote: string;
  teamCount: number;
  qbOutOrDoubtfulCount: number;
  teams: unknown[];
  contentSha256?: string;
  minuteBucketIso?: string;
};

export type SnapshotManifestEntry = {
  file: string;
  captureTimestamp: string;
  minuteBucketIso: string;
  contentSha256: string;
  teamCount: number;
  qbOutOrDoubtfulCount: number;
  deduped: boolean;
};

export type SnapshotManifest = {
  version: 2;
  activated: boolean;
  storageRoot: string;
  freezesPerWeek: number;
  scheduleNote: string;
  snapshots: SnapshotManifestEntry[];
  evidenceRequiredBeforeE4Validation: string[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
};

export type FailureRecord = {
  at: string;
  stage: "fetch" | "parse" | "write" | "dedupe" | "unknown";
  httpStatus?: number | null;
  message: string;
  frozenMlUnchanged: true;
};

/** Minute-resolution bucket for schedule dedupe (one freeze per UTC minute). */
export function injuryMinuteBucket(captureIso: string): string {
  const d = new Date(captureIso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid captureIso: ${captureIso}`);
  return d.toISOString().slice(0, 16) + ":00Z";
}

export function contentSha256(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export function defaultManifest(storageRoot: string): SnapshotManifest {
  return {
    version: 2,
    activated: false,
    storageRoot,
    freezesPerWeek: 20,
    scheduleNote:
      "Mon–Thu 2×/day (14:00,22:00 UTC)=8; Fri–Sun 4×/day (02:00,14:00,18:00,22:00 UTC)=12; total=20/week",
    snapshots: [],
    evidenceRequiredBeforeE4Validation: [
      "Multiple snapshots with captureTimestamp < each game's kickoffIso",
      "Join injuryKnown=true|null — never coerce missing to false",
      "Segment conservatism on prospective cohort (N1–N3 floors)",
      "Competition scope Odds-listed FBS only",
      "Never backfill TUNING/FINAL_EVAL from live ESPN",
    ],
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
  };
}

export function loadManifest(storageRoot: string): SnapshotManifest {
  const path = join(storageRoot, "manifest.json");
  if (!existsSync(path)) return defaultManifest(storageRoot);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SnapshotManifest> & {
    snapshots?: SnapshotManifestEntry[];
  };
  const base = defaultManifest(storageRoot);
  return {
    ...base,
    ...raw,
    version: 2,
    storageRoot,
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
    freezesPerWeek: 20,
    scheduleNote: base.scheduleNote,
  };
}

export function saveManifest(storageRoot: string, manifest: SnapshotManifest): void {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(
    join(storageRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function appendFailure(storageRoot: string, failure: FailureRecord): void {
  mkdirSync(storageRoot, { recursive: true });
  const failuresPath = join(storageRoot, "failures.jsonl");
  appendFileSync(failuresPath, `${JSON.stringify(failure)}\n`);
  const manifest = loadManifest(storageRoot);
  manifest.lastFailureAt = failure.at;
  manifest.consecutiveFailures = (manifest.consecutiveFailures ?? 0) + 1;
  saveManifest(storageRoot, manifest);
  // Also mirror a short latest-failure pointer for operators.
  writeFileSync(
    join(storageRoot, "latest-failure.json"),
    `${JSON.stringify(failure, null, 2)}\n`,
  );
}

export type PersistResult =
  | {
      status: "wrote";
      file: string;
      captureTimestamp: string;
      minuteBucketIso: string;
      contentSha256: string;
      snapshotCount: number;
      deduped: false;
    }
  | {
      status: "deduped_skip";
      reason: "same_minute_bucket" | "same_content_sha";
      existingFile: string;
      captureTimestamp: string;
      minuteBucketIso: string;
      contentSha256: string;
      snapshotCount: number;
      deduped: true;
    };

/**
 * Persist snapshot with dedupe:
 * - skip if same UTC minute bucket already stored
 * - skip if identical content sha already stored
 */
export function persistInjurySnapshot(
  storageRoot: string,
  payload: InjurySnapshotPayload,
): PersistResult {
  mkdirSync(join(storageRoot, "snapshots"), { recursive: true });
  const manifest = loadManifest(storageRoot);
  const minuteBucketIso = injuryMinuteBucket(payload.captureTimestamp);
  const body = {
    source: payload.source,
    captureTimestamp: payload.captureTimestamp,
    captureNote: payload.captureNote,
    teamCount: payload.teamCount,
    qbOutOrDoubtfulCount: payload.qbOutOrDoubtfulCount,
    teams: payload.teams,
  };
  // Content dedupe ignores wall-clock capture time — identical report body only.
  const sha = contentSha256({
    source: payload.source,
    teamCount: payload.teamCount,
    qbOutOrDoubtfulCount: payload.qbOutOrDoubtfulCount,
    teams: payload.teams,
  });

  const byMinute = manifest.snapshots.find((s) => s.minuteBucketIso === minuteBucketIso);
  if (byMinute) {
    return {
      status: "deduped_skip",
      reason: "same_minute_bucket",
      existingFile: byMinute.file,
      captureTimestamp: payload.captureTimestamp,
      minuteBucketIso,
      contentSha256: sha,
      snapshotCount: manifest.snapshots.length,
      deduped: true,
    };
  }
  const bySha = manifest.snapshots.find((s) => s.contentSha256 === sha);
  if (bySha) {
    return {
      status: "deduped_skip",
      reason: "same_content_sha",
      existingFile: bySha.file,
      captureTimestamp: payload.captureTimestamp,
      minuteBucketIso,
      contentSha256: sha,
      snapshotCount: manifest.snapshots.length,
      deduped: true,
    };
  }

  const fileName = `espn-cfb-injuries-${payload.captureTimestamp.replace(/[:.]/g, "-")}.json`;
  const rel = join("snapshots", fileName);
  const abs = join(storageRoot, rel);
  const stored: InjurySnapshotPayload = {
    ...body,
    contentSha256: sha,
    minuteBucketIso,
  };
  writeFileSync(abs, `${JSON.stringify(stored, null, 2)}\n`);

  manifest.snapshots.push({
    file: rel,
    captureTimestamp: payload.captureTimestamp,
    minuteBucketIso,
    contentSha256: sha,
    teamCount: payload.teamCount,
    qbOutOrDoubtfulCount: payload.qbOutOrDoubtfulCount,
    deduped: false,
  });
  manifest.activated = true;
  manifest.lastSuccessAt = payload.captureTimestamp;
  manifest.consecutiveFailures = 0;
  saveManifest(storageRoot, manifest);

  return {
    status: "wrote",
    file: abs,
    captureTimestamp: payload.captureTimestamp,
    minuteBucketIso,
    contentSha256: sha,
    snapshotCount: manifest.snapshots.length,
    deduped: false,
  };
}
