/** Greenfield ask parsing — leg targets and build intent only. */

const PARLAY_BUILD_RE =
  /\b((?:\d{1,3})\s*[-\s]?\s*legs?\b|\b(?:build|make|create|give me|need|want)\b.{0,40}\bparlay\b|\bparlay\b)/i;

export function parseRequestedLegs(text: string): number {
  const m = String(text || "").match(/\b(\d{1,3})\s*[-\s]?\s*legs?\b/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isParlayBuildAsk(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (parseRequestedLegs(t) > 0) return true;
  return PARLAY_BUILD_RE.test(t);
}

export function resolveBuildLegTarget(text: string): number {
  const explicit = parseRequestedLegs(text);
  if (explicit > 0) return Math.min(explicit, 25);
  if (isParlayBuildAsk(text)) return 6;
  return 0;
}
