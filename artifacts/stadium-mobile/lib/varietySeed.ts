/** FNV-1a hash — stable per seed string, different each build when seed includes a build id. */
export function hashSeedString(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tie-break / jitter key for ranked pools — same seed → same order, new seed → new mix. */
export function varietyRankKey(seed: string, key: string): number {
  return hashSeedString(`${seed}|${key}`);
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates shuffle so each build walks the board in a different order. */
export function shuffleWithSeed<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return items;
  const rng = mulberry32(hashSeedString(seed));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
