// Sherdog fighter lookup — supplemental MMA data when ESPN has no profile.
// Parsed from public HTML only; aggressively cached. Never fabricates values.

import { cachedJson } from "./sports.js";

const SHERDOG_TTL = 12 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (compatible; StadiumEdge/1.0; +https://stadium-edge.onrender.com)";

function normName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type SherdogRecentFight = {
  result: "W" | "L" | "D" | null;
  opponent: string | null;
  date: string | null;
  method: string | null;
};

export type SherdogFighterProfile = {
  sherdogId: string;
  slug: string;
  resolvedName: string;
  record: { wins: number; losses: number; draws: number; winPct: number } | null;
  weightClass: string | null;
  profile: {
    age: number | null;
    displayHeight: string | null;
    heightIn: number | null;
    displayReach: string | null;
    reachIn: number | null;
    stance: string | null;
    citizenship: string | null;
  };
  methods: {
    koWins: number | null;
    tkoWins: number | null;
    subWins: number | null;
    decisionWins: number | null;
  };
  recentForm: SherdogRecentFight[];
};

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseRecord(text: string): SherdogFighterProfile["record"] | null {
  const m = /(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/.exec(text);
  if (!m) return null;
  const wins = parseInt(m[1]!, 10);
  const losses = parseInt(m[2]!, 10);
  const draws = parseInt(m[3]!, 10);
  const decided = wins + losses;
  const winPct = decided > 0 ? Math.round((wins / decided) * 1000) / 10 : 0;
  return { wins, losses, draws, winPct };
}

function parseHeightIn(display: string | null): number | null {
  if (!display) return null;
  const m = /(\d+)'\s*(\d+)/.exec(display);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 12 + parseInt(m[2]!, 10);
}

function parseReachIn(display: string | null): number | null {
  if (!display) return null;
  const m = /(\d+(?:\.\d+)?)\s*"/.exec(display);
  if (!m) return null;
  return Math.round(parseFloat(m[1]!) * 10) / 10;
}

function nameMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function lastNameToken(n: string): string {
  const parts = normName(n).split(" ").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function scoreSherdogName(candidate: string, query: string): number {
  const nc = normName(candidate);
  const nq = normName(query);
  if (nc === nq) return 100;
  if (nc.includes(nq) || nq.includes(nc)) return 70;
  const lc = lastNameToken(candidate);
  const lq = lastNameToken(query);
  if (lq && lc === lq) {
    const fc = normName(candidate).split(" ")[0] || "";
    const fq = normName(query).split(" ")[0] || "";
    if (fc && fq && (fc === fq || fc.startsWith(fq) || fq.startsWith(fc))) return 65;
    return 55;
  }
  return 0;
}

export function parseSherdogSearch(html: string, query: string): { slug: string; name: string } | null {
  const hits = parseSherdogSearchAll(html, query);
  return hits[0] ?? null;
}

export function parseSherdogSearchAll(
  html: string,
  query: string,
): { slug: string; name: string; score: number }[] {
  const re =
    /<tr[^>]*onclick="document\.location='(\/fighter\/[^']+)';"[^>]*>[\s\S]*?<a href="\/fighter\/[^"]+">([^<]+)<\/a>/gi;
  const hits: { slug: string; name: string; score: number }[] = [];
  for (const m of html.matchAll(re)) {
    const slug = m[1]!;
    const name = m[2]!.trim();
    const score = scoreSherdogName(name, query);
    if (score <= 0) continue;
    hits.push({ slug, name, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

export function parseSherdogProfile(html: string, slug: string): SherdogFighterProfile | null {
  const nameMatch = /<span class="fn">([^<]+)/.exec(html);
  const resolvedName = nameMatch?.[1]?.trim() || null;
  if (!resolvedName) return null;

  const idMatch = /\/fighter\/[^-]+-(\d+)/.exec(slug);
  const sherdogId = idMatch?.[1] || slug;

  const records: SherdogFighterProfile["record"][] = [];
  for (const m of html.matchAll(/<span class="record">([^<]+)/g)) {
    const rec = parseRecord(m[1]!);
    if (rec) records.push(rec);
  }
  const record = records[0] ?? null;

  const nat = /<strong itemprop="nationality">([^<]+)/.exec(html)?.[1]?.trim() || null;

  let displayHeight: string | null = null;
  let displayReach: string | null = null;
  let stance: string | null = null;
  let age: number | null = null;

  const bio = html.match(/<div class="bio-holder">([\s\S]*?)<\/div>\s*<div class="winsloses-holder">/);
  if (bio) {
    const chunk = bio[1]!;
    const height = /<tr><td>HEIGHT<\/td><td><b[^>]*>([^<]+)/i.exec(chunk);
    if (height) displayHeight = height[1]!.trim();
    const reach = /<tr><td>REACH<\/td><td><b[^>]*>([^<]+)/i.exec(chunk);
    if (reach) displayReach = reach[1]!.trim();
    const st = /<tr><td>STANCE<\/td><td><b[^>]*>([^<]+)/i.exec(chunk);
    if (st) {
      const s = st[1]!.trim();
      stance = s && !/^n\/a$/i.test(s) ? s : null;
    }
    const ageRow = /<tr>\s*<td>AGE<\/td>\s*<td><b>([^<]*)</i.exec(chunk);
    if (ageRow) {
      const a = parseInt(ageRow[1]!.trim(), 10);
      if (Number.isFinite(a) && a > 0) age = a;
    }
  }

  let weightClass: string | null = null;
  const wc = /CLASS<br \/><a href="[^"]+">([^<]+)<\/a>/i.exec(html);
  if (wc) weightClass = wc[1]!.trim();

  const ko = parseInt(
    /class="wins"[\s\S]*?KO <em>\/<\/em> TKO<\/div>\s*<div class="meter">[\s\S]*?<div class="pl">(\d+)/i.exec(
      html,
    )?.[1] || "",
    10,
  );
  const sub = parseInt(
    /SUBMISSIONS<\/div>\s*<div class="meter">[\s\S]*?<div class="pl">(\d+)/i.exec(html)?.[1] || "",
    10,
  );
  const dec = parseInt(
    /DECISIONS<\/div>\s*<div class="meter">[\s\S]*?<div class="pl">(\d+)/i.exec(html)?.[1] || "",
    10,
  );

  const methods = {
    koWins: Number.isFinite(ko) && ko >= 0 ? ko : null,
    tkoWins: null,
    subWins: Number.isFinite(sub) && sub >= 0 ? sub : null,
    decisionWins: Number.isFinite(dec) && dec >= 0 ? dec : null,
  };

  const recentForm: SherdogRecentFight[] = [];
  const fightRe =
    /<tr>\s*<td><span class="final_result (win|loss|draw)">[^<]*<\/span><\/td>\s*<td><a href="\/fighter\/[^"]+">([^<]+)<\/a><\/td>[\s\S]*?<span class="sub_line">([^<]+)<\/span>[\s\S]*?<td class="winby"><b>([^<]*)/gi;
  for (const m of html.matchAll(fightRe)) {
    const raw = m[1]!.toLowerCase();
    const result: SherdogRecentFight["result"] =
      raw === "win" ? "W" : raw === "loss" ? "L" : raw === "draw" ? "D" : null;
    recentForm.push({
      result,
      opponent: m[2]!.trim(),
      date: m[3]!.trim(),
      method: stripTags(m[4] || "").slice(0, 80) || null,
    });
    if (recentForm.length >= 10) break;
  }

  return {
    sherdogId,
    slug,
    resolvedName,
    record,
    weightClass,
    profile: {
      age,
      displayHeight,
      heightIn: parseHeightIn(displayHeight),
      displayReach,
      reachIn: parseReachIn(displayReach),
      stance,
      citizenship: nat,
    },
    methods,
    recentForm,
  };
}

async function loadSherdogCandidates(
  html: string,
  query: string,
): Promise<{ slug: string; name: string; score: number }[]> {
  return parseSherdogSearchAll(html, query);
}

async function pickSherdogProfile(
  hits: { slug: string; name: string; score: number }[],
  query: string,
  opponent?: string,
): Promise<SherdogFighterProfile | null> {
  const profiles: SherdogFighterProfile[] = [];
  for (const hit of hits.slice(0, 10)) {
    const html = await fetchHtml(`https://www.sherdog.com${hit.slug}`);
    if (!html) continue;
    const profile = parseSherdogProfile(html, hit.slug);
    if (profile) profiles.push(profile);
  }
  if (!profiles.length) return null;

  const exact = profiles.find(
    (p) => nameMatch(p.resolvedName, query) || hits.some((h) => nameMatch(h.name, query) && h.slug.includes(p.slug.split("/").pop() || "")),
  );
  if (exact) return exact;

  if (opponent) {
    const opp = normName(opponent);
    const viaOpp = profiles.find((p) =>
      p.recentForm.some((r) => {
        const ro = normName(r.opponent || "");
        return ro && (ro === opp || ro.includes(opp) || opp.includes(ro));
      }),
    );
    if (viaOpp) return viaOpp;
  }

  const last = lastNameToken(query);
  const sameSurname = profiles.filter((p) => lastNameToken(p.resolvedName) === last);
  const withRecord = sameSurname.filter((p) => p.record && p.record.wins + p.record.losses > 0);
  if (withRecord.length === 1) return withRecord[0]!;
  if (withRecord.length > 1) {
    withRecord.sort((a, b) => (b.record?.wins ?? 0) - (a.record?.wins ?? 0));
    return withRecord[0]!;
  }
  if (sameSurname.length === 1) return sameSurname[0]!;

  return profiles[0] ?? null;
}

export async function searchSherdogFighter(name: string): Promise<{ slug: string; name: string } | null> {
  const q = name.trim();
  if (!q) return null;
  return cachedJson(`sherdog:search:${normName(q)}`, SHERDOG_TTL, async () => {
    const tryQueries = [q];
    const last = lastNameToken(q);
    if (last && last !== normName(q)) tryQueries.push(last);
    for (const query of tryQueries) {
      const html = await fetchHtml(
        `https://www.sherdog.com/stats/fightfinder?SearchTxt=${encodeURIComponent(query)}`,
      );
      if (!html) continue;
      const hit = parseSherdogSearch(html, q);
      if (hit) return hit;
    }
    return null;
  });
}

export async function fetchSherdogProfile(
  name: string,
  opts: { opponent?: string } = {},
): Promise<SherdogFighterProfile | null> {
  const q = name.trim();
  if (!q) return null;
  const oppKey = opts.opponent ? normName(opts.opponent) : "";
  return cachedJson(`sherdog:profile:${normName(q)}:${oppKey}`, SHERDOG_TTL, async () => {
    const tryQueries = [q];
    const last = lastNameToken(q);
    if (last && last !== normName(q)) tryQueries.push(last);
    for (const query of tryQueries) {
      const html = await fetchHtml(
        `https://www.sherdog.com/stats/fightfinder?SearchTxt=${encodeURIComponent(query)}`,
      );
      if (!html) continue;
      const hits = await loadSherdogCandidates(html, q);
      const profile = await pickSherdogProfile(hits, q, opts.opponent);
      if (!profile) continue;
      if (
        nameMatch(profile.resolvedName, q) ||
        hits.some((h) => nameMatch(h.name, q)) ||
        lastNameToken(profile.resolvedName) === lastNameToken(q)
      ) {
        return profile;
      }
    }
    return null;
  });
}
