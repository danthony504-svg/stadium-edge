import { createHash } from "node:crypto";

/** Derive a stable 32-bit seed from an arbitrary string. */
export function seedFromString(input: string): number {
  const hex = createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

/**
 * Deterministic Mulberry32 PRNG.
 * Same seed ⇒ identical sequence across runs/platforms (within IEEE float ops used).
 */
export function createMulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededRng(seedString: string): {
  seed: string;
  seedU32: number;
  next: () => number;
} {
  const seedU32 = seedFromString(seedString);
  return { seed: seedString, seedU32, next: createMulberry32(seedU32) };
}

/** Fingerprint canonical JSON-ish payloads for dataFingerprint. */
export function fingerprintPayload(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 32);
}
