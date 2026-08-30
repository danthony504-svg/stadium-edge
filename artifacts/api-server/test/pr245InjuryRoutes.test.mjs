// Standalone PR #245 route tests. Run with:
// node --test test/pr245InjuryRoutes.test.mjs
// This deliberately bypasses register-hooks.mjs, which is unavailable on Node 22.14.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

const tempDir = await mkdtemp(path.resolve(".stadium-injury-route-"));
const bundledRoute = path.join(tempDir, "injuries.cjs");
const sportsFake = path.join(tempDir, "sports.ts");
await writeFile(
  sportsFake,
  `export const ESPN_SPORT_PATHS = { nfl: "football/nfl", nba: "basketball/nba", mlb: "baseball/mlb", nhl: "hockey/nhl" };
export async function cachedJson(_key, _ttl, loader) { return loader(); }`,
);
await build({
  entryPoints: [path.resolve("src/routes/injuries.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: bundledRoute,
  external: ["express"],
  plugins: [{
    name: "mock-sports-cache",
    setup(build) {
      build.onResolve({ filter: /^\.\.\/lib\/sports$/ }, () => ({ path: sportsFake }));
    },
  }],
});
const { default: router } = createRequire(import.meta.url)(bundledRoute);
const handler = router.stack.find((layer) => layer.route?.path === "/sports/injuries")?.route.stack[0]?.handle;
assert.ok(handler, "injuries route handler must be registered");

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function request(sport, fetchImpl) {
  globalThis.fetch = fetchImpl;
  const res = response();
  await handler({ query: { sport }, log: { error() {} } }, res);
  return res;
}

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("ESPN success returns normalized injury entries", async () => {
  const res = await request("nfl", async () =>
    Response.json({
      injuries: [{
        displayName: "Kansas City Chiefs",
        abbreviation: "KC",
        injuries: [{
          athlete: { displayName: "Player One", position: { abbreviation: "QB" } },
          status: "Questionable",
          shortComment: "Ankle",
        }],
      }],
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [{
    team: "Kansas City Chiefs",
    teamAbbr: "KC",
    entries: [{ player: "Player One", position: "QB", status: "Questionable", description: "Ankle" }],
  }]);
});

test("ESPN confirmed-empty payload stays distinct from unavailable", async () => {
  const res = await request("nba", async () => Response.json({ injuries: [] }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, []);
});

test("ESPN request failure returns HTTP 503", async () => {
  const res = await request("mlb", async () => new Response("", { status: 503 }));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Injury feed unavailable" });
});

test("malformed ESPN response is unavailable rather than confirmed-empty", async () => {
  const res = await request("nhl", async () => Response.json({ unexpected: [] }));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Injury feed unavailable" });
});

test("chat injury rules preserve failed-feed and confirmed-empty semantics", async () => {
  const chatSource = await readFile(path.resolve("src/routes/chat.ts"), "utf8");
  assert.match(
    chatSource,
    /injuryFeed\.connected is false[\s\S]*?My injury data feed is currently unavailable[\s\S]*?NEVER say "no injury report", "no injuries reported"/,
  );
  assert.match(
    chatSource,
    /injuryClearedGames[\s\S]*?ONLY case where "no injuries reported" language is allowed/,
  );
});
