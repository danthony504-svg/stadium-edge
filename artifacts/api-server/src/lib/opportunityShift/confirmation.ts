import type { VacancyConfirmation } from "./types.js";

export function classifyVacancyConfirmation(status: string): VacancyConfirmation {
  const s = String(status ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/probable|\bactive\b|available/.test(s)) return "probable";
  if (/season|60-?day|injured reserve|\bir\b|out for (the )?season/.test(s)) return "out";
  if (/\bout\b|10-?day|15-?day|suspend|inactive|\bil\b|\bdl\b/.test(s)) return "out";
  if (/\bdoubtful\b/.test(s)) return "doubtful";
  if (/day-?to-?day|questionable|game-?time|bereavement|paternity|personal|illness|covid|\brest\b/.test(s)) {
    return "questionable";
  }
  return "unknown";
}

/** Redistribution fraction — questionable/unknown/probable → 0. */
export function vacancyFractionForConfirmation(c: VacancyConfirmation): number {
  if (c === "out") return 1;
  if (c === "doubtful") return 0.75;
  return 0;
}

export function vacancyFingerprint(parts: {
  sport: string;
  gameKey: string;
  player: string;
  athleteId?: string | null;
  confirmation: VacancyConfirmation;
  channels: string[];
}): string {
  const id = String(parts.athleteId ?? "").trim() || normName(parts.player);
  const ch = [...parts.channels].sort().join(",");
  return [
    String(parts.sport).toLowerCase(),
    normName(parts.gameKey),
    id,
    parts.confirmation,
    ch,
  ].join("|");
}

export function normName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function beneficiaryId(player: string, athleteId?: string | null): string {
  const id = String(athleteId ?? "").trim();
  if (id) return id;
  return `name:${normName(player)}`;
}

export function teamMatch(a: string, b: string): boolean {
  const aw = normName(a).split(" ").filter(Boolean);
  const bw = normName(b).split(" ").filter(Boolean);
  if (!aw.length || !bw.length) return false;
  const [short, long] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  const set = new Set(long);
  return short.every((w) => set.has(w));
}
