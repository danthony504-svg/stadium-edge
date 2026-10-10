import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Pure regression for Hermes "Cannot convert undefined value to object" when
 * deserializeBoardScan called Object.entries on missing slate maps.
 * Kept dependency-free — slatePreAnalysisCache.ts imports expo-updates.
 */

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deserializeBoardScan(raw: {
  picks: unknown[];
  evalLinesByGame: unknown;
  gameSimulations: unknown;
}): { evalLinesByGame: Map<string, unknown>; gameSimulations: Map<string, unknown> } {
  if (!isPlainRecord(raw.evalLinesByGame) || !isPlainRecord(raw.gameSimulations)) {
    throw new TypeError(
      "deserializeBoardScan: evalLinesByGame and gameSimulations must be plain objects",
    );
  }
  return {
    evalLinesByGame: new Map(Object.entries(raw.evalLinesByGame)),
    gameSimulations: new Map(Object.entries(raw.gameSimulations)),
  };
}

function tryDeserializeBoardScan(
  raw:
    | {
        picks?: unknown[];
        evalLinesByGame?: unknown;
        gameSimulations?: unknown;
      }
    | null
    | undefined,
): ReturnType<typeof deserializeBoardScan> | null {
  if (!raw?.picks || !Array.isArray(raw.picks)) return null;
  try {
    return deserializeBoardScan(raw as {
      picks: unknown[];
      evalLinesByGame: unknown;
      gameSimulations: unknown;
    });
  } catch {
    return null;
  }
}

test("legacy Object.entries(undefined) reproduces Hermes crash message", () => {
  assert.throws(
    () => Object.entries(undefined as never),
    (err: unknown) =>
      err instanceof TypeError &&
      /Cannot convert undefined or null to object|Cannot convert undefined value to object/i.test(
        (err as Error).message,
      ),
  );
});

test("deserializeBoardScan rejects missing evalLinesByGame / gameSimulations", () => {
  assert.throws(
    () =>
      deserializeBoardScan({
        picks: [{}],
        evalLinesByGame: undefined,
        gameSimulations: {},
      }),
    (err: unknown) => err instanceof TypeError && /evalLinesByGame|gameSimulations/i.test((err as Error).message),
  );
  const ok = deserializeBoardScan({
    picks: [{}],
    evalLinesByGame: {},
    gameSimulations: {},
  });
  assert.equal(ok.evalLinesByGame.size, 0);
});

test("tryDeserializeBoardScan returns null for incomplete slate (Coach empty-slate safe)", () => {
  assert.equal(
    tryDeserializeBoardScan({
      picks: [{}],
      evalLinesByGame: undefined,
      gameSimulations: {},
    }),
    null,
  );
  assert.equal(tryDeserializeBoardScan(null), null);
  assert.ok(tryDeserializeBoardScan({ picks: [{}], evalLinesByGame: {}, gameSimulations: {} }));
});

test("slatePreAnalysisCache.ts ships tryDeserializeBoardScan + map guards", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "slatePreAnalysisCache.ts"),
    "utf8",
  );
  assert.match(src, /export function tryDeserializeBoardScan/);
  assert.match(src, /evalLinesByGame and gameSimulations must be plain objects/);
  assert.match(src, /isPlainRecord\(raw\.evalLinesByGame\)/);
});

test("slatePreAnalysis.ts seeds via tryDeserializeBoardScan (fail-closed)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "slatePreAnalysis.ts"),
    "utf8",
  );
  assert.match(src, /tryDeserializeBoardScan/);
  assert.doesNotMatch(src, /deserializeBoardScan\(\{/);
});
