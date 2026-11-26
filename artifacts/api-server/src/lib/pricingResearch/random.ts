export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

export function standardNormal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}

export function gammaDraw(shape: number, random: () => number): number {
  if (shape < 1) return gammaDraw(shape + 1, random) * random() ** (1 / shape);
  const d = shape - 1 / 3, scale = 1 / Math.sqrt(9 * d);
  while (true) {
    const z = standardNormal(random);
    const root = 1 + scale * z;
    if (root <= 0) continue;
    const v = root ** 3, u = random();
    if (u < 1 - 0.0331 * z ** 4 || Math.log(u) < z ** 2 / 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}
