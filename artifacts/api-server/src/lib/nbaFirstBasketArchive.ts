import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { firstBasketMarkets, type FirstBasketSnapshot } from "./nbaFirstBasketModel.js";
import type { RawFirstBasketOdds } from "./nbaFirstBasketOdds.js";

export const MINUTE = 60_000;
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
export const slateDate = (time: number) => date.format(time);
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

type LineupRecord = { kind: "lineup"; at: number; snapshot: FirstBasketSnapshot };
export type OddsRecord = {
  kind: "odds"; at: number; eventId: string; key: string;
  status: number | null; credits: number | null; remaining: number | null; response: RawFirstBasketOdds | null;
};
type PollRecord = { kind: "poll"; at: number; eventsSeen: number };
export type FirstBasketArchiveRecord = LineupRecord | OddsRecord | PollRecord;

export function archiveLineupKey(game: FirstBasketSnapshot, at: number) {
  const fives = game.confirmedAt != null && at - game.confirmedAt <= 45 * MINUTE
    ? [game.home, game.away].map(team => team.starters.map(player => player.id).sort().join(",")).join(":")
    : "pending";
  return `${game.oddsEventId ?? ""}:${fives}`;
}

export function archiveOddsPlan(game: FirstBasketSnapshot, at: number, quota: OddsRecord | undefined, reserve?: number) {
  const oddsId = game.oddsEventId;
  const remainingTime = game.startsAt - at;
  if (!oddsId || !/^[a-f0-9]{32}$/i.test(oddsId) || remainingTime <= 0 || remainingTime > 45 * MINUTE) return null;
  const freshQuota = quota && at >= quota.at && at - quota.at <= 5 * MINUTE && quota.remaining != null;
  const fast = remainingTime <= 10 * MINUTE && reserve != null && Number.isSafeInteger(reserve) && reserve > 0 &&
    freshQuota && quota.remaining! - firstBasketMarkets.length >= reserve;
  return { oddsId, key: archiveLineupKey(game, at), ttlMs: (fast ? 1 : 3) * MINUTE, fast: !!fast };
}

export async function storeFirstBasketRecord(root: string, record: FirstBasketArchiveRecord, day = slateDate(record.at)) {
  if (!dayPattern.test(day)) throw new RangeError("Invalid archive day");
  const folder = join(root, day);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const name = record.kind === "lineup"
    ? `lineup-${createHash("sha256").update(JSON.stringify(record.snapshot)).digest("hex")}`
    : `${record.kind}-${record.at}-${randomUUID()}`;
  const destination = join(folder, `${name}.json`);
  if (record.kind === "lineup") {
    const existing = await readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing) return;
  }
  const temporary = join(folder, `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, JSON.stringify(record) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readFirstBasketArchiveDay(root: string, day: string, kind?: FirstBasketArchiveRecord["kind"]) {
  if (!dayPattern.test(day)) throw new RangeError("Invalid archive day");
  const folder = join(root, day);
  const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  const records: FirstBasketArchiveRecord[] = [];
  for (const name of names) {
    if (!/^(?:lineup|odds|poll)-[a-f0-9-]+\.json$/.test(name) || (kind && !name.startsWith(`${kind}-`))) continue;
    records.push(JSON.parse(await readFile(join(folder, name), "utf8")) as FirstBasketArchiveRecord);
  }
  return records;
}

export function oddsQuotaHeaders(headers: Headers) {
  function read(name: string) {
    const value = headers.get(name);
    return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  }
  return { credits: read("x-requests-last"), remaining: read("x-requests-remaining") };
}

function offsetDay(day: string, offset: number) {
  const time = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day) throw new RangeError("Invalid report date");
  return new Date(time + offset * 86_400_000).toISOString().slice(0, 10);
}

export async function firstBasketWeek(root: string, through: string) {
  const nights = [];
  for (let offset = -6; offset <= 0; offset++) {
    const day = offsetDay(through, offset);
    const records = await readFirstBasketArchiveDay(root, day);
    const calls = records.filter((record): record is OddsRecord => record.kind === "odds");
    const polls = records.filter(record => record.kind === "poll");
    const observed = calls.length > 0 || polls.length > 0;
    const knownCredits = calls.reduce((sum, call) => sum + (call.credits ?? 0), 0);
    const callsWithoutQuota = calls.filter(call => call.credits == null).length;
    nights.push({ day, observed, polls: polls.length, games: new Set(calls.map(call => call.eventId)).size,
      requests: calls.length, lineups: records.filter(record => record.kind === "lineup").length,
      reportedCredits: observed ? knownCredits : null, callsWithoutQuota });
  }
  const measuredNights = nights.filter(night => night.observed).length;
  const callsWithoutQuota = nights.reduce((sum, night) => sum + night.callsWithoutQuota, 0);
  return { nights, measuredNights, nightsWithQuota: nights.filter(night => night.requests > night.callsWithoutQuota).length, callsWithoutQuota,
    reportedCredits: measuredNights ? nights.reduce((sum, night) => sum + (night.reportedCredits ?? 0), 0) : null };
}
