// Parse user-requested prop-market bans ("no home runs", "without stolen bases").

import type { ParsedPick } from "../components/PickCard.tsx";
import type { PropPoolEntry, RealPropEntry } from "./api.ts";
import { familyKeyForPick } from "./marketWeighting.ts";
import { propMarketLabel } from "./propMarketLabel.ts";

type Excludable = {
  isProp?: boolean;
  market?: string;
  propMarketKey?: string;
  marketKey?: string;
  pick?: string;
};

const EXCLUSION_RULES: { re: RegExp; families: string[]; keys: string[] }[] = [
  {
    re: /\b(?:no|without|exclude|avoid)\s+(?:[\w\s,'-]+\s+)?home runs?\b|\bno\s+hrs?\b|\bno\s+homers?\b|\bor\s+home runs?\b/i,
    families: ["home runs"],
    keys: ["batter_home_runs"],
  },
  {
    re: /\b(?:no|without|exclude|avoid)\s+(?:[\w\s,'-]+\s+)?stolen bases?\b|\bno\s+sbs?\b|\bno\s+steals?\b|\bor\s+stolen bases?\b/i,
    families: ["stolen bases"],
    keys: ["batter_stolen_bases"],
  },
];

export function parseExcludedPropFamilies(text?: string | null): Set<string> {
  const out = new Set<string>();
  const t = String(text ?? "");
  if (!t.trim()) return out;
  for (const rule of EXCLUSION_RULES) {
    if (rule.re.test(t)) {
      for (const f of rule.families) out.add(f);
    }
  }
  return out;
}

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPropExcluded(
  pick: Excludable,
  excludedFamilies: Set<string>,
): boolean {
  if (excludedFamilies.size === 0) return false;
  if (pick.isProp === false) return false;

  const fam = familyKeyForPick(pick)?.toLowerCase();
  if (fam && excludedFamilies.has(fam)) return true;

  const key = (pick.propMarketKey ?? pick.marketKey ?? "").toLowerCase();
  for (const rule of EXCLUSION_RULES) {
    for (const f of rule.families) {
      if (!excludedFamilies.has(f)) continue;
      if (rule.keys.some((k) => key === k || key.startsWith(`${k}_`))) return true;
    }
  }

  const market = norm(pick.market ?? "");
  const label = norm(propMarketLabel(pick.propMarketKey));
  for (const f of excludedFamilies) {
    const needle = norm(f);
    if (market.includes(needle) || label.includes(needle)) return true;
    if (needle === "home runs" && /\bhr\b|home run/.test(norm(pick.pick ?? ""))) return true;
    if (needle === "stolen bases" && /\bstolen base|\bsb\b/.test(norm(pick.pick ?? "")))
      return true;
  }
  return false;
}

export function filterExcludedProps<T extends Excludable>(
  picks: T[],
  excludedFamilies: Set<string>,
): T[] {
  if (excludedFamilies.size === 0) return picks;
  return picks.filter((p) => !isPropExcluded(p, excludedFamilies));
}

function poolEntryToExcludable(entry: PropPoolEntry): Excludable {
  return {
    isProp: true,
    propMarketKey: entry.marketKey,
    market: entry.marketLabel,
    pick: `${entry.player} ${entry.side} ${entry.line ?? ""}`.trim(),
  };
}

function realPropToExcludable(entry: RealPropEntry): Excludable {
  return {
    isProp: true,
    propMarketKey: entry.market,
    market: propMarketLabel(entry.market),
    pick: entry.player,
  };
}

export function filterExcludedPropPool(
  pool: PropPoolEntry[],
  excludedFamilies: Set<string>,
): PropPoolEntry[] {
  if (excludedFamilies.size === 0) return pool;
  return pool.filter((e) => !isPropExcluded(poolEntryToExcludable(e), excludedFamilies));
}

export function filterExcludedRealProps(
  props: RealPropEntry[],
  excludedFamilies: Set<string>,
): RealPropEntry[] {
  if (excludedFamilies.size === 0) return props;
  return props.filter((e) => !isPropExcluded(realPropToExcludable(e), excludedFamilies));
}

export function exclusionNote(excludedFamilies: Set<string>): string {
  if (excludedFamilies.size === 0) return "";
  const labels = [...excludedFamilies].map((f) =>
    f
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
  );
  return `_Excluded ${labels.join(" and ")} per your request._`;
}

export type { ParsedPick };
