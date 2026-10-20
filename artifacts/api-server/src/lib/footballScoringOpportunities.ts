/** ID-bound completed-game PBP. Collection runs outside the simulation critical path. */
import { createHash } from "node:crypto";
import { logger } from "./logger.js";
import { cacheGet, cacheSet } from "./store.js";

type Ref = { id?: string; $ref?: string };
export type ScoringPlay = {
  id?: string; type?: { text?: string }; text?: string; isPenalty?: boolean;
  scoreValue?: number; start?: { down?: number; yardsToEndzone?: number; team?: Ref };
  teamParticipants?: { id?: string; type?: string; team?: Ref }[];
  participants?: { type?: string; athlete?: Ref }[];
};
export type OpportunityCounts = { rush: number; target: number; pass: number; rushTd: number; passTd: number; inside10Rush: number; inside5Rush: number; inside10Target: number; inside5Target: number; qbRush: number; scramble: number };
export type ScoringGame = {
  eventId: string; date: string; offense: OpportunityCounts; defense: OpportunityCounts;
  calls?: { rush: number; pass: number; earlyDownRush: number; earlyDownPass: number };
  players: Record<string, OpportunityCounts>; qbTargets: Record<string, number>;
};
export type ScoringSnapshot = { sport: string; teamId: string; collectedAt: number; games: ScoringGame[]; fingerprint: string };
export type FootballTdSignal = { multiplier: number; explanation: string; fingerprint: string };
const empty = (): OpportunityCounts => ({ rush: 0, target: 0, pass: 0, rushTd: 0, passTd: 0, inside10Rush: 0, inside5Rush: 0, inside10Target: 0, inside5Target: 0, qbRush: 0, scramble: 0 });
const id = (r?: Ref) => r?.id ?? r?.$ref?.match(/\/(?:teams|athletes)\/(\d+)(?:\?|$)/)?.[1];
const paths: Record<string, string> = { nfl: "nfl", ncaaf: "college-football" };
const TTL = 6 * 60 * 60_000;
const snapshots = new Map<string, ScoringSnapshot>();
const tasks = new Map<string, Promise<void>>();
const retryAt = new Map<string, number>();
let active = 0;
const queue: Array<() => void> = [];
async function bounded<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

/** Only explicit rush/pass types, real starting field position and exact athlete IDs. */
export function summarizeScoringGame(eventId: string, date: string, teamId: string, plays: ScoringPlay[]): ScoringGame | null {
  const out: ScoringGame = { eventId, date, offense: empty(), defense: empty(), calls: { rush: 0, pass: 0, earlyDownRush: 0, earlyDownPass: 0 }, players: {}, qbTargets: {} };
  const quarterbacks = new Set(plays.flatMap(p => (p.participants ?? []).filter(a => a.type === "passer").map(a => id(a.athlete)).filter(Boolean)));
  const seen = new Set<string>();
  let recognized = 0;
  for (const p of plays) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    const type = p.type?.text ?? "";
    const rush = /^(Rush|Rushing Touchdown)$/i.test(type);
    const pass = /^(Pass Reception|Pass Incompletion|Passing Touchdown|Pass Interception Return)$/i.test(type);
    if ((!rush && !pass) || p.isPenalty || /no play|two.point|kneel|spike/i.test(p.text ?? "")) continue;
    const yards = p.start?.yardsToEndzone;
    const own = id(p.start?.team);
    const defense = p.teamParticipants?.find(t => t.type === "defense");
    const defId = defense?.id ?? id(defense?.team);
    if (!own || !defId || own === defId || ![own, defId].includes(teamId) || p.start?.down == null || p.start.down < 1) continue;
    if (typeof yards !== "number" || !Number.isFinite(yards) || yards <= 0 || yards > 100) continue;
    recognized++;
    if (own === teamId) {
      const calls = out.calls!;
      if (rush) { calls.rush++; if (p.start!.down! <= 2) calls.earlyDownRush++; }
      else { calls.pass++; if (p.start!.down! <= 2) calls.earlyDownPass++; }
    }
    if (yards > 20) continue;
    const isOwn = own === teamId;
    const totals = isOwn ? out.offense : out.defense;
    const ids = (role: string) => [...new Set((p.participants ?? []).filter(a => a.type === role).map(a => id(a.athlete)).filter((x): x is string => !!x))];
    const rusher = ids("rusher"), receiver = ids("receiver"), passer = ids("passer");
    const td = p.scoreValue === 6 && /^(Passing|Rushing) Touchdown$/i.test(type);
    const add = (c: OpportunityCounts) => {
      if (rush) { c.rush++; if (yards <= 10) c.inside10Rush++; if (yards <= 5) c.inside5Rush++; if (td) c.rushTd++; }
      else { c.pass++; if (td) c.passTd++; }
    };
    add(totals);
    if (!isOwn) continue;
    if (rush && rusher.length === 1) {
      const c = out.players[rusher[0]!] ??= empty(); add(c);
      if (quarterbacks.has(rusher[0]!)) c.qbRush++;
      if (/scrambl/i.test(p.text ?? "")) c.scramble++;
    }
    if (pass && passer.length === 1) add(out.players[passer[0]!] ??= empty());
    if (pass && receiver.length === 1) {
      const c = out.players[receiver[0]!] ??= empty();
      c.target++; if (yards <= 10) c.inside10Target++; if (yards <= 5) c.inside5Target++; if (td) c.passTd++;
      if (passer.length === 1) {
        const pair = `${passer[0]}:${receiver[0]}`;
        out.qbTargets[pair] = (out.qbTargets[pair] ?? 0) + 1;
      }
    }
  }
  // An absent/unsupported feed is never stored as a zero-opportunity game.
  return recognized >= 30 ? out : null;
}

async function json(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`scoring PBP HTTP ${response.status}`);
  return response.json();
}
export function peekScoringSnapshot(sport: string, teamId: string, now = Date.now()): ScoringSnapshot | undefined {
  const value = snapshots.get(`${sport}:${teamId}`);
  return value && now - value.collectedAt < TTL ? value : undefined;
}

/** Shared by worker/HTTP; coalesced, 2 concurrent collectors, bounded completed games only. */
export function warmScoringSnapshot(sport: string, teamId: string): Promise<void> {
  if (!paths[sport] || !/^\d+$/.test(teamId)) return Promise.resolve();
  const key = `${sport}:${teamId}`;
  if (peekScoringSnapshot(sport, teamId) || Date.now() < (retryAt.get(key) ?? 0)) return Promise.resolve();
  const pending = tasks.get(key); if (pending) return pending;
  // Do not allow traffic to create an unbounded background queue.
  if (tasks.size >= 48) return Promise.resolve();
  const task = bounded(async () => {
    const stored = await cacheGet<ScoringSnapshot>(`football-scoring:v1:${key}`);
    if (stored && Date.now() - stored.collectedAt < TTL) { snapshots.set(key, stored); return; }
    const schedule = await json(`https://site.api.espn.com/apis/site/v2/sports/football/${paths[sport]}/teams/${teamId}/schedule`);
    const events = (schedule.events ?? []).filter((e: any) => /^\d+$/.test(String(e.id)) && e.competitions?.[0]?.status?.type?.completed === true && Date.parse(e.date) < Date.now())
      .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
    const games: ScoringGame[] = [];
    for (const event of events) {
      const page = await json(`https://sports.core.api.espn.com/v2/sports/football/leagues/${paths[sport]}/events/${event.id}/competitions/${event.id}/plays?limit=500`);
      if (page.pageCount !== 1 || page.items?.length !== page.count) continue;
      const game = summarizeScoringGame(String(event.id), event.date, teamId, page.items);
      if (game) games.push(game);
    }
    if (games.length < 3) throw new Error("scoring PBP needs 3 complete games");
    const fingerprint = createHash("sha1").update(JSON.stringify(games)).digest("hex").slice(0, 16);
    const value: ScoringSnapshot = { sport, teamId, games, fingerprint, collectedAt: Date.now() };
    // Small memory summary; raw play-by-play never enters Coach or sim caches.
    if (snapshots.size >= 128) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(key, value);
    await cacheSet(`football-scoring:v1:${key}`, value, TTL);
  }).catch((error) => { if (retryAt.size >= 128) retryAt.delete(retryAt.keys().next().value!); retryAt.set(key, Date.now() + 10 * 60_000); logger.warn({ sport, teamId, error: error instanceof Error ? error.message : "collection failed" }, "football scoring summary unavailable; baseline retained"); }).finally(() => { tasks.delete(key); });
  tasks.set(key, task);
  return task;
}

function sum(games: ScoringGame[], section: "offense" | "defense", field: keyof OpportunityCounts): number {
  return games.reduce((n, g) => n + g[section][field], 0);
}
/** Small evidence-bounded matchup adjustment, never an inferred zero or a grade override. */
export function scoringOpportunitySignal(req: { sport: string; market: string; athleteId?: string | null; playerTeamId?: string | null; opponentTeamId?: string | null }, own?: ScoringSnapshot, opponent?: ScoringSnapshot): FootballTdSignal | null {
  if (!own || !opponent || Date.now() - own.collectedAt >= TTL || Date.now() - opponent.collectedAt >= TTL || own.sport !== req.sport || opponent.sport !== req.sport || own.teamId !== req.playerTeamId || opponent.teamId !== req.opponentTeamId || own.teamId === opponent.teamId || !req.athleteId || own.games.length < 3 || opponent.games.length < 3) return null;
  const m = req.market.replace(/_alternate$/, "");
  if (!/^(player_anytime_td|player_pass_tds|player_rush_tds|player_reception_tds|player_rush_reception_tds)$/.test(m)) return null;
  const player = own.games.reduce((c, g) => { const p = g.players[req.athleteId!]; if (p) for (const k of Object.keys(c) as (keyof OpportunityCounts)[]) c[k] += p[k]; return c; }, empty());
  const isPass = m === "player_pass_tds";
  const rushWeight = isPass || m === "player_reception_tds" ? 0 : m === "player_rush_tds" ? 1 : (player.rush + player.target > 0 ? player.rush / (player.rush + player.target) : 0);
  if ((isPass ? player.pass : player.rush + player.target) < 5) return null;
  const components: number[] = [];
  const explain: string[] = [];
  let logShift = 0;
  for (const [kind, weight] of [["rush", rushWeight], ["pass", 1 - rushWeight]] as const) {
    if (weight <= 0) continue;
    const attempts = sum(own.games, "offense", kind);
    const allowed = sum(opponent.games, "defense", kind);
    if (attempts < 10 || allowed < 10) return null;
    const tdKey = kind === "rush" ? "rushTd" : "passTd";
    const a = sum(own.games, "offense", tdKey), b = sum(opponent.games, "defense", tdKey);
    // Pooled observed baseline anchors both rates; 20-play shrinkage limits small samples.
    const pooled = (a + b + 1) / (attempts + allowed + 2);
    const baseline = (a + 20 * pooled) / (attempts + 20);
    const defense = (b + 20 * pooled) / (allowed + 20);
    logShift += weight * Math.log(defense / baseline) * 0.2;
    components.push(attempts, allowed, a, b);
    explain.push(`${kind}: opponent ${b}/${allowed} RZ TD plays; own offense ${a}/${attempts}`);
  }
  // Goal-line share trend compares the athlete with their own longer baseline.
  const field = player.inside5Rush >= 3 ? "inside5Rush" : "rush";
  const recent = own.games.slice(0, 2);
  const share = (games: ScoringGame[]) => {
    const denom = sum(games, "offense", field);
    const count = games.reduce((n, g) => n + (g.players[req.athleteId!]?.[field] ?? 0), 0);
    return { denom, count, rate: (count + 1) / (denom + 4) };
  };
  if (rushWeight > 0) {
    const current = share(recent), baseline = share(own.games);
    if (current.denom >= 5 && baseline.denom >= 10) logShift += rushWeight * Math.max(-0.04, Math.min(0.04, Math.log(current.rate / baseline.rate) * 0.1));
  }
  if (!isPass && rushWeight < 1 && player.target >= 5) {
    const currentAttempts = sum(recent, "offense", "pass"), allAttempts = sum(own.games, "offense", "pass");
    const currentTargets = recent.reduce((n,g) => n + (g.players[req.athleteId!]?.target ?? 0), 0);
    if (currentAttempts >= 10 && allAttempts >= 20) {
      const currentShare = (currentTargets + 1) / (currentAttempts + 4);
      const baselineShare = (player.target + 1) / (allAttempts + 4);
      logShift += (1 - rushWeight) * Math.max(-0.04, Math.min(0.04, Math.log(currentShare / baselineShare) * 0.1));
    }
  }
  const multiplier = Math.max(0.94, Math.min(1.06, Math.exp(logShift)));
  const teamTargets = sum(own.games, "offense", "pass");
  const qbPairs = Object.entries(own.games.reduce((out, g) => { for (const [k, v] of Object.entries(g.qbTargets)) if (k.endsWith(`:${req.athleteId}`)) out[k] = (out[k] ?? 0) + v; return out; }, {} as Record<string, number>));
  return { multiplier, explanation: `Completed-game RZ context (${own.games.length}/${opponent.games.length} games): ${explain.join("; ")}; player ${player.inside5Rush} carries inside 5, ${player.qbRush} QB RZ rushes (${player.scramble} explicit scrambles), ${player.target}/${teamTargets} RZ targets/team attempts (${player.inside10Target} inside 10, ${player.inside5Target} inside 5); QB→receiver counts ${qbPairs.map(([k,v]) => `${k}=${v}`).join(",") || "none"}. Not end-zone-target charting.`, fingerprint: `rz1:${own.fingerprint}:${opponent.fingerprint}:${req.athleteId}:${m}:${components.join(",")}` };
}

export function scoringSignalKey(req: { sport: string; athleteId?: string | null; playerTeamId?: string | null; opponentTeamId?: string | null; market: string }): string {
  return [req.sport, req.playerTeamId, req.opponentTeamId, req.athleteId, req.market.replace(/_alternate$/, "")].join(":");
}
export function cachedScoringSignals(requests: Array<{ sport: string; market: string; athleteId?: string | null; playerTeamId?: string | null; opponentTeamId?: string | null }>): Record<string, FootballTdSignal> {
  const signals: Record<string, FootballTdSignal> = {};
  for (const req of requests) {
    if (!paths[req.sport] || !/tds?$/.test(req.market.replace(/_alternate$/, ""))) continue;
    for (const team of [req.playerTeamId, req.opponentTeamId]) if (team && !process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== "test") void warmScoringSnapshot(req.sport, team);
    const own = req.playerTeamId ? peekScoringSnapshot(req.sport, req.playerTeamId) : undefined;
    const opp = req.opponentTeamId ? peekScoringSnapshot(req.sport, req.opponentTeamId) : undefined;
    const signal = scoringOpportunitySignal(req, own, opp);
    if (signal) signals[scoringSignalKey(req)] = signal;
  }
  return signals;
}
