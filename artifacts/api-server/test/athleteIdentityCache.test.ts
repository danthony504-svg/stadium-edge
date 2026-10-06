/**
 * Phase 2.2 — athlete identity cache + resolution hardening.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATHLETE_IDENTITY_CONCURRENCY,
  ATHLETE_IDENTITY_TTL_MS,
  athleteIdentityKey,
  athleteIdentityStoreStatsForTests,
  clearAthleteIdentityStoreForTests,
  getAthleteIdentity,
  setAthleteIdentity,
} from "../src/lib/athleteIdentityStore.ts";
import { clearPropSimDedicatedStoresForTests } from "../src/lib/propSimDedicatedStore.ts";
import { normalizePlayerName } from "../src/lib/espnRoster.ts";
import {
  derivePlayerTeamId,
  playerSearchCacheKey,
  resolvePropAthleteIds,
  resolvePropAthleteIdsDetailed,
} from "../src/lib/resolvePropAthleteIds.ts";

test.beforeEach(() => {
  clearAthleteIdentityStoreForTests();
  clearPropSimDedicatedStoresForTests();
});

test("athlete identity TTL is 24h and concurrency is 4", () => {
  assert.equal(ATHLETE_IDENTITY_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(ATHLETE_IDENTITY_CONCURRENCY, 4);
});

test("canonical identity key includes sport + normalized name + teamId", () => {
  const a = athleteIdentityKey("MLB", "Tristan Peters", "4");
  const b = athleteIdentityKey("mlb", "tristan peters", "4");
  assert.equal(a, b);
  assert.equal(a, `mlb|${normalizePlayerName("Tristan Peters")}|4`);
  assert.match(a, /^mlb\|tristanpeters\|4$/);
});

test("same name in different sports → isolated identities", async () => {
  const mlbKey = athleteIdentityKey("mlb", "John Smith", "10");
  const nflKey = athleteIdentityKey("nfl", "John Smith", "10");
  assert.notEqual(mlbKey, nflKey);
  await setAthleteIdentity(mlbKey, "111");
  await setAthleteIdentity(nflKey, "222");
  assert.equal(await getAthleteIdentity(mlbKey), "111");
  assert.equal(await getAthleteIdentity(nflKey), "222");
});

test("team change → separate identity", async () => {
  const t4 = athleteIdentityKey("mlb", "Miguel Vargas", "4");
  const t5 = athleteIdentityKey("mlb", "Miguel Vargas", "5");
  assert.notEqual(t4, t5);
  await setAthleteIdentity(t4, "42453");
  assert.equal(await getAthleteIdentity(t4), "42453");
  assert.equal(await getAthleteIdentity(t5), undefined);
});

test("setAthleteIdentity never stores empty / null-like values", async () => {
  const key = athleteIdentityKey("mlb", "Nobody", "1");
  await setAthleteIdentity(key, "");
  await setAthleteIdentity(key, "   ");
  assert.equal(await getAthleteIdentity(key), undefined);
  assert.equal(athleteIdentityStoreStatsForTests().entries, 0);
});

test("player-search cache key is sport-scoped (no legacy name-only)", () => {
  const k = playerSearchCacheKey("mlb", "Tristan Peters");
  assert.equal(k, "player-search:v2:mlb:tristan peters");
  assert.notEqual(k, "player-search:tristan peters");
  assert.notEqual(playerSearchCacheKey("nfl", "Tristan Peters"), k);
});

test("derivePlayerTeamId prefers isHome / opponent context", () => {
  assert.equal(
    derivePlayerTeamId({ isHome: true, homeTeamId: "5", awayTeamId: "4" }, "5", "4"),
    "5",
  );
  assert.equal(
    derivePlayerTeamId({ isHome: false, homeTeamId: "5", awayTeamId: "4" }, "5", "4"),
    "4",
  );
  assert.equal(
    derivePlayerTeamId({ opponentTeamId: "5", homeTeamId: "5", awayTeamId: "4" }, "5", "4"),
    "4",
  );
  assert.equal(derivePlayerTeamId({}, "", ""), "");
});

test("stamped athleteId → zero provider calls (fast path)", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error("provider must not be called on stamped path");
  }) as typeof fetch;

  try {
    const { props, stats } = await resolvePropAthleteIdsDetailed(
      "mlb",
      [
        {
          player: "Tristan Peters",
          market: "batter_hits",
          line: 0.5,
          side: "Over",
          sport: "mlb",
          athleteId: "5085893",
          isHome: false,
          homeTeamId: "5",
          awayTeamId: "4",
        },
        {
          player: "Kyle Teel",
          market: "batter_runs",
          line: 0.5,
          side: "Over",
          sport: "mlb",
          athleteId: "4743772",
          isHome: false,
          homeTeamId: "5",
          awayTeamId: "4",
        },
      ],
      { homeTeamId: "5", awayTeamId: "4" },
    );
    assert.equal(fetchCount, 0);
    assert.equal(stats.providerCalls, 0);
    assert.equal(stats.stampedFastPath, 2);
    assert.equal(props[0]?.athleteId, "5085893");
    assert.equal(props[1]?.athleteId, "4743772");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("same player/team/sport → dedicated cache hit on second resolve", async () => {
  const originalFetch = globalThis.fetch;
  let rosterFetches = 0;
  const homeId = "9101";
  const awayId = "9102";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/roster")) {
      rosterFetches += 1;
      return new Response(
        JSON.stringify({
          athletes: url.includes(`/teams/${awayId}/`)
            ? [{ id: "5085893", fullName: "Tristan Peters" }]
            : [{ id: "42453", fullName: "Miguel Vargas" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/search")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const req = {
      player: "Tristan Peters",
      market: "batter_hits",
      line: 0.5,
      side: "Over" as const,
      sport: "mlb",
      isHome: false as const,
    };
    const opts = {
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeTeam: "Cleveland Guardians",
      awayTeam: "Chicago White Sox",
    };
    const first = await resolvePropAthleteIdsDetailed("mlb", [req], opts);
    assert.equal(first.props[0]?.athleteId, "5085893");
    assert.ok(rosterFetches >= 1);

    const afterFirst = rosterFetches;
    const second = await resolvePropAthleteIdsDetailed("mlb", [req], opts);
    assert.equal(second.props[0]?.athleteId, "5085893");
    assert.equal(second.stats.cacheHits, 1);
    assert.equal(rosterFetches, afterFirst, "cache hit must not re-fetch roster");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent identical misses → one underlying resolution", async () => {
  const originalFetch = globalThis.fetch;
  let rosterStarts = 0;
  let searchStarts = 0;
  const homeId = "9201";
  const awayId = "9202";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/roster")) {
      rosterStarts += 1;
      await new Promise((r) => setTimeout(r, 40));
      return new Response(
        JSON.stringify({
          athletes: url.includes(`/teams/${awayId}/`)
            ? [{ id: "5085893", fullName: "Tristan Peters" }]
            : [{ id: "41217", fullName: "Brayan Rocchio" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/search")) {
      searchStarts += 1;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const mk = () => ({
      player: "Tristan Peters",
      market: "batter_hits",
      line: 0.5,
      side: "Over" as const,
      sport: "mlb",
      isHome: false as const,
    });
    // Eight identical miss rows in one call — coalesce + request roster share.
    const { props, stats } = await resolvePropAthleteIdsDetailed(
      "mlb",
      Array.from({ length: 8 }, mk),
      { homeTeamId: homeId, awayTeamId: awayId, homeTeam: "CLE", awayTeam: "CWS" },
    );
    assert.ok(props.every((p) => p.athleteId === "5085893"));
    // Deduped unique miss + roster-game coalesce → 2 team HTTP calls, not 8×2.
    assert.ok(rosterStarts <= 2, `expected ≤2 roster HTTP, got ${rosterStarts}`);
    assert.equal(searchStarts, 0);
    assert.equal(stats.cacheMisses, 1, "one unique identity miss for 8 identical rows");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent cross-call identical misses share one Promise", async () => {
  clearAthleteIdentityStoreForTests();
  clearPropSimDedicatedStoresForTests();
  const originalFetch = globalThis.fetch;
  let rosterStarts = 0;
  const homeId = "9301";
  const awayId = "9302";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/roster")) {
      rosterStarts += 1;
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          athletes: url.includes(`/teams/${awayId}/`)
            ? [{ id: "5085893", fullName: "Tristan Peters" }]
            : [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const req = {
      player: "Tristan Peters",
      market: "batter_hits",
      line: 0.5,
      side: "Over" as const,
      sport: "mlb",
      isHome: false as const,
    };
    const opts = { homeTeamId: homeId, awayTeamId: awayId, homeTeam: "CLE", awayTeam: "CWS" };
    const [a, b] = await Promise.all([
      resolvePropAthleteIds("mlb", [req], opts),
      resolvePropAthleteIds("mlb", [req], opts),
    ]);
    assert.equal(a[0]?.athleteId, "5085893");
    assert.equal(b[0]?.athleteId, "5085893");
    // Shared roster-game + athlete coalesce across simultaneous callers.
    assert.ok(rosterStarts <= 2, `expected ≤2 roster HTTP across coalesced callers, got ${rosterStarts}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejected lookup does not poison later request", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "fail" | "ok" = "fail";
  // Unique team ids so shared roster LRU from prior tests cannot mask the failure.
  const homeId = "9001";
  const awayId = "9002";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (mode === "fail") {
      return new Response("boom", { status: 500 });
    }
    if (url.includes("/roster")) {
      return new Response(
        JSON.stringify({
          athletes: url.includes(`/teams/${awayId}/`)
            ? [{ id: "5085893", fullName: "Tristan Peters" }]
            : [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/search")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "5085893",
              displayName: "Tristan Peters",
              league: "mlb",
              teamRelationships: [{ displayName: "Chicago White Sox" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const req = {
      player: "Tristan Peters",
      market: "batter_hits",
      line: 0.5,
      side: "Over" as const,
      sport: "mlb",
      isHome: false as const,
    };
    const opts = {
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeTeam: "CLE",
      awayTeam: "CWS",
    };
    const failed = await resolvePropAthleteIds("mlb", [req], opts);
    assert.equal(failed[0]?.athleteId, undefined);
    assert.equal(
      await getAthleteIdentity(athleteIdentityKey("mlb", "Tristan Peters", awayId)),
      undefined,
    );

    mode = "ok";
    const ok = await resolvePropAthleteIds("mlb", [req], opts);
    assert.equal(ok[0]?.athleteId, "5085893");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unresolved player remains unresolved — no guessed ID", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ athletes: [], items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const resolved = await resolvePropAthleteIds(
      "mlb",
      [
        {
          player: "Definitely Not A Real Player Xyzzy",
          market: "batter_hits",
          line: 0.5,
          side: "Over",
          sport: "mlb",
        },
      ],
      { homeTeamId: "5", awayTeamId: "4", homeTeam: "CLE", awayTeam: "CWS" },
    );
    assert.equal(resolved[0]?.athleteId, undefined);
    assert.equal(
      await getAthleteIdentity(
        athleteIdentityKey("mlb", "Definitely Not A Real Player Xyzzy", "5"),
      ),
      undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
