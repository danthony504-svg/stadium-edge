import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  altOutcomeIdentity,
  findOpposingIdentity,
  mergeAltPeriodMarkets,
  normalizeAltPeriodMarket,
} from "../src/lib/oddsAltDevig.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("api-server coachTeamIdResolve matches stadium-mobile copy", () => {
  const api = readFileSync(join(root, "src/lib/coachTeamIdResolve.ts"), "utf8");
  const mobile = readFileSync(
    join(root, "../stadium-mobile/lib/coachTeamIdResolve.ts"),
    "utf8",
  );
  assert.equal(api, mobile);
});

test("altOutcomeIdentity keeps exact points distinct (+6.5 ≠ +10.5)", () => {
  const a = altOutcomeIdentity("Ravens", 6.5, null);
  const b = altOutcomeIdentity("Ravens", 10.5, null);
  assert.notEqual(a, b);
  assert.equal(altOutcomeIdentity("Ravens", 6.5, null), a);
});

test("different alternate spread points are never paired for no-vig", () => {
  const ids = [
    altOutcomeIdentity("Ravens", 6.5),
    altOutcomeIdentity("Titans", -6.5),
    altOutcomeIdentity("Ravens", 10.5),
    altOutcomeIdentity("Titans", -10.5),
  ];
  // +6.5 pairs only with exact -6.5 on the other team — not -10.5.
  assert.equal(
    findOpposingIdentity("alternate_spreads", ids[0]!, ids),
    ids[1]!,
  );
  assert.equal(
    findOpposingIdentity("alternate_spreads", ids[2]!, ids),
    ids[3]!,
  );
  // Missing exact opposite → null (never synthesize).
  assert.equal(
    findOpposingIdentity(
      "alternate_spreads",
      altOutcomeIdentity("Ravens", 3.5),
      ids,
    ),
    null,
  );
});

test("normalizeAltPeriodMarket retains multi-book prices for the exact same line", () => {
  const bookmakers = [
    {
      title: "DraftKings",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [
            { name: "Baltimore Ravens", price: 520, point: 6.5 },
            { name: "Tennessee Titans", price: -700, point: -6.5 },
            { name: "Baltimore Ravens", price: 900, point: 10.5 },
            { name: "Tennessee Titans", price: -1400, point: -10.5 },
          ],
        },
      ],
    },
    {
      title: "FanDuel",
      markets: [
        {
          key: "alternate_spreads",
          outcomes: [
            { name: "Baltimore Ravens", price: 540, point: 6.5 },
            { name: "Tennessee Titans", price: -720, point: -6.5 },
            { name: "Baltimore Ravens", price: 950, point: 10.5 },
            { name: "Tennessee Titans", price: -1500, point: -10.5 },
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
            { name: "Baltimore Ravens", price: 510, point: 6.5 },
            { name: "Tennessee Titans", price: -690, point: -6.5 },
            { name: "Baltimore Ravens", price: 880, point: 10.5 },
            { name: "Tennessee Titans", price: -1350, point: -10.5 },
          ],
        },
      ],
    },
  ];

  const outcomes = normalizeAltPeriodMarket("alternate_spreads", bookmakers);
  const ravens65 = outcomes.find((o) => o.name === "Baltimore Ravens" && o.point === 6.5);
  const ravens105 = outcomes.find((o) => o.name === "Baltimore Ravens" && o.point === 10.5);
  assert.ok(ravens65);
  assert.ok(ravens105);
  assert.equal(ravens65!.books.length, 3);
  assert.equal(ravens105!.books.length, 3);

  // Best price for +6.5 is FanDuel +540 (lowest implied).
  assert.equal(ravens65!.price, 540);
  assert.deepEqual(
    ravens65!.books.map((b) => b.book).sort(),
    ["BetMGM", "DraftKings", "FanDuel"],
  );
  // Exact line prices preserved — +6.5 books must not include +10.5 prices.
  assert.ok(ravens65!.books.every((b) => b.point === 6.5));
  assert.ok(ravens65!.books.every((b) => [510, 520, 540].includes(b.price)));
  assert.ok(ravens105!.books.every((b) => b.point === 10.5));

  // Enough two-sided books → real no-vig fair + edge (not assigned to best alone).
  assert.ok(ravens65!.noVigFair != null && ravens65!.noVigFair > 0);
  assert.ok(ravens65!.edge != null);
  // +10.5 is a different market — has its own fair, not pooled with +6.5.
  assert.ok(ravens105!.noVigFair != null);
  assert.notEqual(ravens65!.noVigFair, ravens105!.noVigFair);
});

test("alt totals pair Over/Under at the same exact point only", () => {
  const bookmakers = [
    {
      title: "DraftKings",
      markets: [
        {
          key: "alternate_totals",
          outcomes: [
            { name: "Over", price: 550, point: 55.5 },
            { name: "Under", price: -750, point: 55.5 },
            { name: "Over", price: 800, point: 60.5 },
            { name: "Under", price: -1200, point: 60.5 },
          ],
        },
      ],
    },
    {
      title: "FanDuel",
      markets: [
        {
          key: "alternate_totals",
          outcomes: [
            { name: "Over", price: 560, point: 55.5 },
            { name: "Under", price: -760, point: 55.5 },
            { name: "Over", price: 820, point: 60.5 },
            { name: "Under", price: -1250, point: 60.5 },
          ],
        },
      ],
    },
    {
      title: "Caesars",
      markets: [
        {
          key: "alternate_totals",
          outcomes: [
            { name: "Over", price: 540, point: 55.5 },
            { name: "Under", price: -740, point: 55.5 },
            { name: "Over", price: 790, point: 60.5 },
            { name: "Under", price: -1180, point: 60.5 },
          ],
        },
      ],
    },
  ];
  const outcomes = normalizeAltPeriodMarket("alternate_totals", bookmakers);
  const over55 = outcomes.find((o) => o.name === "Over" && o.point === 55.5)!;
  const over60 = outcomes.find((o) => o.name === "Over" && o.point === 60.5)!;
  assert.equal(over55.books.length, 3);
  assert.ok(over55.noVigFair != null);
  assert.ok(over60.noVigFair != null);
  assert.notEqual(over55.noVigFair, over60.noVigFair);
});

test("team totals require same description + point; never synthesize missing side", () => {
  const bookmakers = [
    {
      title: "DraftKings",
      markets: [
        {
          key: "team_totals",
          outcomes: [
            { name: "Over", description: "Ravens", price: 500, point: 27.5 },
            { name: "Under", description: "Ravens", price: -700, point: 27.5 },
            // Opposing team total at same point — different description, not a pair for Ravens Over.
            { name: "Over", description: "Titans", price: 480, point: 27.5 },
            // No Titans Under → Titans Over stays unqualified.
          ],
        },
      ],
    },
    {
      title: "FanDuel",
      markets: [
        {
          key: "team_totals",
          outcomes: [
            { name: "Over", description: "Ravens", price: 510, point: 27.5 },
            { name: "Under", description: "Ravens", price: -710, point: 27.5 },
            { name: "Over", description: "Titans", price: 490, point: 27.5 },
          ],
        },
      ],
    },
    {
      title: "BetMGM",
      markets: [
        {
          key: "team_totals",
          outcomes: [
            { name: "Over", description: "Ravens", price: 505, point: 27.5 },
            { name: "Under", description: "Ravens", price: -705, point: 27.5 },
            { name: "Over", description: "Titans", price: 485, point: 27.5 },
          ],
        },
      ],
    },
  ];
  const outcomes = normalizeAltPeriodMarket("team_totals", bookmakers);
  const ravensOver = outcomes.find((o) => o.name === "Ravens Over" && o.point === 27.5)!;
  const titansOver = outcomes.find((o) => o.name === "Titans Over" && o.point === 27.5)!;
  assert.ok(ravensOver.books.length >= 3);
  assert.ok(ravensOver.noVigFair != null);
  assert.equal(titansOver.noVigFair, null);
  assert.equal(titansOver.edge, null);
});

test("period alternate markets keep books[] via mergeAltPeriodMarkets", () => {
  const bookmakers = [
    {
      title: "DraftKings",
      markets: [
        {
          key: "alternate_spreads_h1",
          outcomes: [
            { name: "Home", price: 600, point: 3.5 },
            { name: "Away", price: -850, point: -3.5 },
          ],
        },
      ],
    },
    {
      title: "FanDuel",
      markets: [
        {
          key: "alternate_spreads_h1",
          outcomes: [
            { name: "Home", price: 620, point: 3.5 },
            { name: "Away", price: -880, point: -3.5 },
          ],
        },
      ],
    },
    {
      title: "Caesars",
      markets: [
        {
          key: "alternate_spreads_h1",
          outcomes: [
            { name: "Home", price: 590, point: 3.5 },
            { name: "Away", price: -830, point: -3.5 },
          ],
        },
      ],
    },
  ];
  const map = mergeAltPeriodMarkets(bookmakers, ["alternate_spreads_h1", "alternate_totals_h1"]);
  const outs = map.get("alternate_spreads_h1")!;
  assert.ok(outs);
  const home = outs.find((o) => o.name === "Home" && o.point === 3.5)!;
  assert.equal(home.books.length, 3);
  assert.ok(home.noVigFair != null);
  assert.equal(map.has("alternate_totals_h1"), false);
});
