// Client-side Sherdog supplemental — fills Tale of the Tape when the API server
// is stale (pre-Sherdog deploy). React Native can fetch Sherdog directly; parsed
// HTML only, never fabricated.

import type {
  FightAnalysis,
  FightFighter,
  FightFighterDataSource,
  FightFighterMethods,
  FightFighterProfile,
  FightFighterRecentFight,
  FightFighterStats,
} from "./api";

const UA = "Mozilla/5.0 (compatible; StadiumEdge/1.0)";

function normName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lastNameToken(n: string): string {
  const parts = normName(n).split(" ").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function nameMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
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

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal,
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function parseRecord(text: string) {
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

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

type SherdogPatch = {
  resolvedName: string;
  record: FightFighter["record"];
  weightClass: string | null;
  profile: FightFighterProfile;
  methods: FightFighterMethods;
  recentForm: FightFighterRecentFight[];
  finishPct: number | null;
  decisionPct: number | null;
};

function parseSherdogProfile(html: string, slug: string): SherdogPatch | null {
  const resolvedName = /<span class="fn">([^<]+)/.exec(html)?.[1]?.trim();
  if (!resolvedName) return null;

  const records = [...html.matchAll(/<span class="record">([^<]+)/g)]
    .map((m) => parseRecord(m[1]!))
    .filter(Boolean);
  const record = records[0] ?? null;
  const nat = /<strong itemprop="nationality">([^<]+)/.exec(html)?.[1]?.trim() || null;

  let displayHeight: string | null = null;
  let displayReach: string | null = null;
  let stance: string | null = null;
  let age: number | null = null;
  const bio = html.match(/<div class="bio-holder">([\s\S]*?)<\/div>\s*<div class="winsloses-holder">/);
  if (bio) {
    const chunk = bio[1]!;
    displayHeight = /<tr><td>HEIGHT<\/td><td><b[^>]*>([^<]+)/i.exec(chunk)?.[1]?.trim() ?? null;
    displayReach = /<tr><td>REACH<\/td><td><b[^>]*>([^<]+)/i.exec(chunk)?.[1]?.trim() ?? null;
    const st = /<tr><td>STANCE<\/td><td><b[^>]*>([^<]+)/i.exec(chunk)?.[1]?.trim();
    stance = st && !/^n\/a$/i.test(st) ? st : null;
    const a = parseInt(/<tr>\s*<td>AGE<\/td>\s*<td><b>([^<]*)</i.exec(chunk)?.[1]?.trim() ?? "", 10);
    if (Number.isFinite(a) && a > 0) age = a;
  }

  const weightClass = /CLASS<br \/><a href="[^"]+">([^<]+)<\/a>/i.exec(html)?.[1]?.trim() ?? null;
  const ko = parseInt(
    /KO <em>\/<\/em> TKO<\/div>\s*<div class="meter">[\s\S]*?<div class="pl">(\d+)/i.exec(html)?.[1] || "",
    10,
  );
  const sub = parseInt(/SUBMISSIONS<\/div>\s*<div class="meter">[\s\S]*?<div class="pl">(\d+)/i.exec(html)?.[1] || "", 10);
  const dec = parseInt(/DECISIONS<\/div>\s*<div class="meter">[\s\S]*?<div class="pl">(\d+)/i.exec(html)?.[1] || "", 10);

  const methods: FightFighterMethods = {
    koWins: Number.isFinite(ko) && ko >= 0 ? ko : null,
    tkoWins: null,
    subWins: Number.isFinite(sub) && sub >= 0 ? sub : null,
    decisionWins: Number.isFinite(dec) && dec >= 0 ? dec : null,
  };

  const recentForm: FightFighterRecentFight[] = [];
  const fightRe =
    /<tr>\s*<td><span class="final_result (win|loss|draw)">[^<]*<\/span><\/td>\s*<td><a href="\/fighter\/[^"]+">([^<]+)<\/a><\/td>[\s\S]*?<span class="sub_line">([^<]+)<\/span>[\s\S]*?<td class="winby"><b>([^<]*)/gi;
  for (const m of html.matchAll(fightRe)) {
    const raw = m[1]!.toLowerCase();
    recentForm.push({
      result: raw === "win" ? "W" : raw === "loss" ? "L" : raw === "draw" ? "D" : null,
      opponent: m[2]!.trim(),
      date: m[3]!.trim(),
      method: stripTags(m[4] || "").slice(0, 80) || null,
    });
    if (recentForm.length >= 10) break;
  }

  const finishPct =
    record && record.wins > 0 && methods.koWins != null
      ? Math.round(((methods.koWins + (methods.tkoWins ?? 0)) / record.wins) * 1000) / 10
      : null;
  const decisionPct =
    record && record.wins > 0 && methods.decisionWins != null
      ? Math.round((methods.decisionWins / record.wins) * 1000) / 10
      : null;

  return {
    resolvedName,
    record,
    weightClass,
    profile: {
      age,
      heightIn: parseHeightIn(displayHeight),
      displayHeight,
      reachIn: null,
      displayReach,
      stance,
      citizenship: nat,
    },
    methods,
    recentForm,
    finishPct,
    decisionPct,
  };
}

function parseSherdogSearchAll(html: string, query: string) {
  const re =
    /<tr[^>]*onclick="document\.location='(\/fighter\/[^']+)';"[^>]*>[\s\S]*?<a href="\/fighter\/[^"]+">([^<]+)<\/a>/gi;
  const hits: { slug: string; name: string; score: number }[] = [];
  for (const m of html.matchAll(re)) {
    const score = scoreSherdogName(m[2]!.trim(), query);
    if (score <= 0) continue;
    hits.push({ slug: m[1]!, name: m[2]!.trim(), score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

async function pickSherdogProfile(
  hits: { slug: string; name: string }[],
  query: string,
  opponent: string | undefined,
  signal?: AbortSignal,
): Promise<SherdogPatch | null> {
  const profiles: SherdogPatch[] = [];
  for (const hit of hits.slice(0, 6)) {
    const html = await fetchHtml(`https://www.sherdog.com${hit.slug}`, signal);
    if (!html) continue;
    const p = parseSherdogProfile(html, hit.slug);
    if (p) profiles.push(p);
  }
  if (!profiles.length) return null;

  const exact = profiles.find((p) => nameMatch(p.resolvedName, query));
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
  return profiles[0] ?? null;
}

export async function fetchClientSherdogFighter(
  name: string,
  opponent?: string,
  signal?: AbortSignal,
): Promise<SherdogPatch | null> {
  const q = name.trim();
  if (!q) return null;
  const tryQueries = [q];
  const last = lastNameToken(q);
  if (last && last !== normName(q)) tryQueries.push(last);
  for (const query of tryQueries) {
    const html = await fetchHtml(
      `https://www.sherdog.com/stats/fightfinder?SearchTxt=${encodeURIComponent(query)}`,
      signal,
    );
    if (!html) continue;
    const hits = parseSherdogSearchAll(html, q);
    const profile = await pickSherdogProfile(hits, q, opponent, signal);
    if (profile) return profile;
  }
  return null;
}

function isBogusReach(f: FightFighter): boolean {
  return f.profile?.reachIn === 0 || f.profile?.displayReach === '0"';
}

export function fighterNeedsClientSupplement(f: FightFighter): boolean {
  if (!f.record && !f.athleteId) return true;
  const missingBio =
    f.profile?.age == null && !f.profile?.displayHeight && !f.profile?.displayReach;
  const missingStats =
    f.stats?.strikeLPM == null && f.stats?.strikeAccuracy == null && f.stats?.finishPct == null;
  const missingMethods =
    f.methods?.koWins == null &&
    f.methods?.tkoWins == null &&
    f.methods?.subWins == null &&
    f.methods?.decisionWins == null;
  if (missingBio) return true;
  if (isBogusReach(f)) return true;
  if (missingMethods && !!f.record) return true;
  if (!!f.athleteId && !!f.record && missingStats && !(f.recentForm?.length)) return true;
  return false;
}

function mergeFighter(base: FightFighter, patch: SherdogPatch): FightFighter {
  const sources = [...new Set<FightFighterDataSource>([...(base.dataSources ?? []), "sherdog"])];
  const stats: FightFighterStats = {
    ...base.stats,
    finishPct: base.stats.finishPct ?? patch.finishPct,
    decisionPct: base.stats.decisionPct ?? patch.decisionPct,
  };
  return {
    ...base,
    resolvedName: base.resolvedName || patch.resolvedName,
    weightClass: base.weightClass || patch.weightClass,
    record: base.record || patch.record,
    profile: {
      age: base.profile.age ?? patch.profile.age,
      heightIn: base.profile.heightIn ?? patch.profile.heightIn,
      displayHeight: base.profile.displayHeight ?? patch.profile.displayHeight,
      reachIn:
        base.profile.reachIn != null && base.profile.reachIn > 0
          ? base.profile.reachIn
          : patch.profile.reachIn,
      displayReach:
        base.profile.displayReach && base.profile.displayReach !== '0"'
          ? base.profile.displayReach
          : patch.profile.displayReach,
      stance: base.profile.stance ?? patch.profile.stance,
      citizenship: base.profile.citizenship ?? patch.profile.citizenship,
    },
    stats,
    methods: {
      koWins: base.methods.koWins ?? patch.methods.koWins,
      tkoWins: base.methods.tkoWins ?? patch.methods.tkoWins,
      subWins: base.methods.subWins ?? patch.methods.subWins,
      decisionWins: base.methods.decisionWins ?? patch.methods.decisionWins,
    },
    dataSources: sources,
    recentForm: base.recentForm?.length ? base.recentForm : patch.recentForm,
  };
}

function estimateCoverage(away: FightFighter, home: FightFighter): number {
  let avail = 0;
  let max = 0;
  for (const f of [away, home]) {
    const fields = [
      f.record,
      f.profile?.age,
      f.profile?.displayHeight,
      f.profile?.displayReach,
      f.stats?.strikeLPM,
      f.stats?.strikeAccuracy,
      f.stats?.finishPct,
      f.style,
    ];
    max += fields.length;
    avail += fields.filter((v) => v != null).length;
  }
  return max > 0 ? Math.round((avail / max) * 1000) / 10 : 0;
}

/** Enrich thin API fight analysis with client Sherdog data when needed. */
export async function enrichFightAnalysisClient(
  analysis: FightAnalysis,
  awayName: string,
  homeName: string,
  signal?: AbortSignal,
): Promise<FightAnalysis> {
  let away = analysis.away;
  let home = analysis.home;
  let patched = false;

  if (fighterNeedsClientSupplement(away)) {
    const patch = await fetchClientSherdogFighter(awayName, homeName, signal);
    if (patch) {
      away = mergeFighter(away, patch);
      patched = true;
    }
  }
  if (fighterNeedsClientSupplement(home)) {
    const patch = await fetchClientSherdogFighter(homeName, awayName, signal);
    if (patch) {
      home = mergeFighter(home, patch);
      patched = true;
    }
  }
  if (!patched) return analysis;

  const resolved =
    (away.record || away.athleteId || away.resolvedName ? 1 : 0) +
    (home.record || home.athleteId || home.resolvedName ? 1 : 0);
  const coverage = Math.max(analysis.prePickAnalysis?.dataCoveragePct ?? 0, estimateCoverage(away, home));

  return {
    ...analysis,
    away,
    home,
    prePickAnalysis: {
      ...analysis.prePickAnalysis,
      resolvedFighters: Math.max(analysis.prePickAnalysis?.resolvedFighters ?? 0, resolved),
      dataCoveragePct: coverage,
    },
  };
}
