/**
 * End-to-end Titans +6.5 trace: provider bookmakers → alt aggregation →
 * normalized odds object → Zod serialization → Steals scanner.
 *
 * Documents the EXACT loss site in the pre-fix best-price collapse, and
 * proves the fixed path retains books[] + honest no-vig (opposing side
 * required; never averages same-side prices into a "fair").
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAltPeriodMarkets,
  normalizeAltPeriodMarket,
  americanToProb,
  findOpposingIdentity,
  altOutcomeIdentity,
} from "../src/lib/oddsAltDevig.ts";
import {
  findGameSteals,
  evPct,
  inStealBand,
  MIN_EDGE_PTS,
  MAX_EDGE_PTS,
  MIN_EV,
  MAX_EV,
} from "../src/lib/liveStealsCore.ts";

const EVENT_ID = "f01589b0e7e6dd4f4ac1220a1db81f53";

/** JSON round-trip mirrors Express res.json + client parse (Zod allows books). */
function serializeOddsResponse<T>(out: T): T {
  return JSON.parse(JSON.stringify(out)) as T;
}

/** Pre-fix collapse — the confirmed loss site (production @ d9f8225e). */
function legacyBestPriceCollapse(
  bookmakers: Array<{
    title?: string;
    markets?: Array<{ key: string; outcomes?: Array<{ name: string; price: number; point?: number }> }>;
  }>,
  marketKey: string,
): Array<{ name: string; price: number; point: number | null }> {
  const bucket = new Map<string, { name: string; price: number; point: number | null }>();
  for (const b of bookmakers) {
    for (const m of b.markets ?? []) {
      if (m.key !== marketKey) continue;
      for (const o of m.outcomes ?? []) {
        const k = `${o.name}|${o.point ?? ""}`;
        const prev = bucket.get(k);
        if (!prev || americanToProb(o.price) < americanToProb(prev.price)) {
          // LOSS: only best price retained — books[] never written.
          bucket.set(k, { name: o.name, price: Math.round(o.price), point: o.point ?? null });
        }
      }
    }
  }
  return Array.from(bucket.values());
}

function stageReport(
  stage: string,
  o: {
    name: string;
    price: number;
    point: number | null | undefined;
    books?: Array<{ book: string; price: number; point?: number | null }> | null;
    noVigFair?: number | null;
    edge?: number | null;
  },
  extra: Record<string, unknown> = {},
) {
  const implied = Math.round(americanToProb(o.price) * 1000) / 1000;
  const ev = evPct(o.noVigFair ?? null, o.price);
  const row = {
    stage,
    canonicalMarketKey: "alternate_spreads",
    period: "full",
    eventId: EVENT_ID,
    selection: o.name,
    point: o.point ?? null,
    side: (o.point ?? 0) > 0 ? "plus" : "minus",
    bestPrice: o.price,
    matchingBooks: o.books?.length ?? 0,
    books: o.books ?? null,
    noVigFair: o.noVigFair ?? null,
    impliedProbability: implied,
    edge: o.edge ?? null,
    ev,
    ...extra,
  };
  console.log(JSON.stringify(row));
  return row;
}

const PROVIDER_BOOKMAKERS = [
  {
    title: "FanDuel",
    markets: [
      {
        key: "alternate_spreads",
        outcomes: [
          { name: "Tennessee Titans", price: 700, point: 6.5 },
          { name: "Baltimore Ravens", price: -900, point: -6.5 },
          { name: "Tennessee Titans", price: 1100, point: 10.5 },
          { name: "Baltimore Ravens", price: -1600, point: -10.5 },
        ],
      },
    ],
  },
  {
    title: "BetMGM",
    markets: [
      {
        key: "alternate_spreads",
        outcomes: [
          { name: "Tennessee Titans", price: 530, point: 6.5 },
          { name: "Baltimore Ravens", price: -720, point: -6.5 },
          { name: "Tennessee Titans", price: 950, point: 10.5 },
          { name: "Baltimore Ravens", price: -1400, point: -10.5 },
        ],
      },
    ],
  },
  {
    title: "DraftKings",
    markets: [
      {
        key: "alternate_spreads",
        outcomes: [
          { name: "Tennessee Titans", price: 520, point: 6.5 },
          { name: "Baltimore Ravens", price: -700, point: -6.5 },
          { name: "Tennessee Titans", price: 900, point: 10.5 },
          { name: "Baltimore Ravens", price: -1350, point: -10.5 },
        ],
      },
    ],
  },
];

test("LOSS SITE: legacy best-price collapse drops all but one book for Titans +6.5", () => {
  const collapsed = legacyBestPriceCollapse(PROVIDER_BOOKMAKERS, "alternate_spreads");
  const titans65 = collapsed.find((o) => o.name === "Tennessee Titans" && o.point === 6.5)!;
  assert.equal(titans65.price, 700); // FanDuel best
  // Exact loss: Outcome shape has no books field after collapse.
  assert.equal("books" in titans65, false);
  stageReport("0_legacy_best_price_collapse_LOSS_SITE", {
    ...titans65,
    books: null,
    noVigFair: null,
    edge: null,
  }, {
    lossFunction: "odds.ts legacy loop: bucket.set(k, { name, price, point }) without books",
    lossCondition: "americanToProb(o.price) < americanToProb(prev.price) keeps only best",
  });
});

test("FIXED PATH: Titans +6.5 retains 3 books through aggregate → Zod → Steals", () => {
  // Stage 1: provider → alternate aggregation
  const map = mergeAltPeriodMarkets(PROVIDER_BOOKMAKERS, ["alternate_spreads"]);
  const outs = map.get("alternate_spreads")!;
  const titans65 = outs.find((o) => o.name === "Tennessee Titans" && o.point === 6.5)!;
  const ravens = outs.find((o) => o.name === "Baltimore Ravens" && o.point === -6.5)!;
  assert.equal(titans65.books.length, 3);
  assert.ok(titans65.noVigFair != null, "opposing -6.5 present → no-vig allowed");
  assert.ok(titans65.edge != null);

  const s1 = stageReport("1_after_alternate_aggregation", titans65, {
    opposingSide: {
      selection: ravens.name,
      point: ravens.point,
      bestPrice: ravens.price,
      matchingBooks: ravens.books.length,
      books: ravens.books,
    },
  });
  assert.equal(s1.matchingBooks, 3);

  // Prove we did NOT invent fair by averaging same-side prices.
  const sameSideAvg =
    titans65.books.reduce((n, b) => n + americanToProb(b.price), 0) / titans65.books.length;
  assert.notEqual(
    Math.round(sameSideAvg * 1000) / 1000,
    titans65.noVigFair,
    "fair must come from two-sided no-vig, not same-side average",
  );

  // Stage 2: normalized odds object + API serialization (JSON / Zod-compatible)
  const gameObj = {
    id: EVENT_ID,
    sport: "nfl",
    homeTeam: "Baltimore Ravens",
    awayTeam: "Tennessee Titans",
    commenceTime: "2026-10-04T17:00:00Z",
    markets: [{ key: "alternate_spreads", outcomes: outs }],
  };
  const parsed = serializeOddsResponse([gameObj]);
  const pOut = parsed[0]!.markets[0]!.outcomes.find(
    (o) => o.name === "Tennessee Titans" && o.point === 6.5,
  )!;
  assert.equal(pOut.books?.length, 3);
  stageReport("2_after_API_serialization", pOut);

  // Stage 3: Steals scanner
  assert.equal(inStealBand(pOut.price), true);
  const steals = findGameSteals(parsed);
  const hit = steals.find((s) => s.pick.includes("+6.5") || s.pick.includes("6.5"));
  const ev = evPct(pOut.noVigFair ?? null, pOut.price);
  const qualifies =
    pOut.edge != null &&
    ev != null &&
    pOut.edge >= MIN_EDGE_PTS &&
    pOut.edge <= MAX_EDGE_PTS &&
    ev >= MIN_EV &&
    ev <= MAX_EV;
  stageReport("3_steals_scanner", pOut, {
    stealsFound: steals.length,
    qualified: qualifies,
    qualifiedSteal: hit ?? null,
  });

  // Different points stay separate
  const titans105 = outs.find((o) => o.name === "Tennessee Titans" && o.point === 10.5)!;
  assert.notEqual(titans65.noVigFair, titans105.noVigFair);
  assert.ok(titans65.books.every((b) => b.point === 6.5));
  assert.ok(titans105.books.every((b) => b.point === 10.5));
});

test("unevaluable when opposing side missing — books kept, fair null (never synthesized)", () => {
  const oneSided = [
    {
      title: "FanDuel",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [{ name: "Tennessee Titans", price: 700, point: 6.5 }],
        },
      ],
    },
    {
      title: "BetMGM",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [{ name: "Tennessee Titans", price: 530, point: 6.5 }],
        },
      ],
    },
    {
      title: "DraftKings",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [{ name: "Tennessee Titans", price: 520, point: 6.5 }],
        },
      ],
    },
  ];
  const outs = normalizeAltPeriodMarket("alternate_spreads", oneSided);
  const o = outs.find((x) => x.point === 6.5)!;
  assert.equal(o.books.length, 3);
  assert.equal(o.noVigFair, null);
  assert.equal(o.edge, null);
  assert.equal(
    findOpposingIdentity(
      "alternate_spreads",
      altOutcomeIdentity("Tennessee Titans", 6.5),
      outs.map((x) => altOutcomeIdentity(x.name, x.point)),
    ),
    null,
  );
  stageReport("unevaluable_no_opposing_side", o, {
    note: "3 same-side books retained; fair left null — never average FanDuel/BetMGM/DK",
  });
});
