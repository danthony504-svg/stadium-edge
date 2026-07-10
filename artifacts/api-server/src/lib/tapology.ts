// Tapology fighter lookup — intended primary supplemental source for regional fighters.
// Tapology sits behind Cloudflare; server-side fetch usually fails. When blocked we
// return null and Sherdog is used instead (see mmaSupplement.ts).

import { cachedJson } from "./sports.js";

const TAPOLOGY_TTL = 12 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (compatible; StadiumEdge/1.0; +https://stadium-edge.onrender.com)";

export type TapologyFighterProfile = {
  tapologySlug: string;
  resolvedName: string;
};

function normName(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isCloudflareBlock(html: string): boolean {
  return /Just a moment|challenges\.cloudflare\.com|cf_chl_opt/i.test(html);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!r.ok) return null;
    const html = await r.text();
    if (isCloudflareBlock(html)) return null;
    return html;
  } catch {
    return null;
  }
}

/** Best-effort Tapology search. Returns null when Cloudflare blocks or no match. */
export async function fetchTapologyProfile(name: string): Promise<TapologyFighterProfile | null> {
  const q = name.trim();
  if (!q) return null;
  return cachedJson(`tapology:profile:${normName(q)}`, TAPOLOGY_TTL, async () => {
    const html = await fetchHtml(`https://www.tapology.com/search?term=${encodeURIComponent(q)}`);
    if (!html) return null;
    const m = /<a href="(\/fightcenter\/fighters\/[^"]+)"[^>]*>([^<]+)<\/a>/i.exec(html);
    if (!m) return null;
    const slug = m[1]!;
    const resolvedName = m[2]!.trim();
    const profileHtml = await fetchHtml(`https://www.tapology.com${slug}`);
    if (!profileHtml) return null;
    return { tapologySlug: slug, resolvedName };
  });
}
