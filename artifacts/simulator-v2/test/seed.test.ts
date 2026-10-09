import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSeededRng, seedFromString } from "../src/index.js";

describe("deterministic seed", () => {
  it("same seed string yields identical sequence", () => {
    const a = createSeededRng("event:nfl:e1:v2");
    const b = createSeededRng("event:nfl:e1:v2");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    assert.deepEqual(seqA, seqB);
    assert.equal(a.seedU32, seedFromString("event:nfl:e1:v2"));
  });

  it("different seeds diverge", () => {
    const a = createSeededRng("seed-a");
    const b = createSeededRng("seed-b");
    assert.notEqual(a.next(), b.next());
  });
});
