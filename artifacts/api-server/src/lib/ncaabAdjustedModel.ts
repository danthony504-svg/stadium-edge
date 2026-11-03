/**
 * NCAAB odds-context ridge research trainer.
 * Separate from NCAAF and from product sim ncaab-score-v2.
 * Never enables Coach or marks releaseEligible.
 */
import { createHash } from "node:crypto";

export const NCAAB_ADJUSTED_MODEL_VERSION = "ncaab-context-ridge-research-v1";
export const NCAAB_ADJUSTED_FEATURE_VERSION = "ncaab-odds-score-features-v1";
export const NCAAB_ADJUSTED_FEATURE_NAMES = [
  "intercept",
  "market_home_spread_line",
  "market_total_line",
  "market_home_ml_implied",
  "market_away_ml_implied",
  "market_spread_home_price",
  "market_spread_away_price",
] as const;
export const NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES =
  NCAAB_ADJUSTED_FEATURE_NAMES.length + 2; // 9
export const NCAAB_BOOK_PRIORITY = [
  "fanduel",
  "draftkings",
  "betmgm",
  "betrivers",
  "caesars",
  "williamhill_us",
  "fanatics",
] as const;
export const NCAAB_SCORE_SUPPORT_MAX = 200;
export const NCAAB_RESEARCH_SCORE_SIGMA = 11;

export type NcaabScoreFeatures = {
  baseline: number;
  values: number[];
  historyGameIds: string[];
};

export type NcaabScoreFeaturePair = {
  home: NcaabScoreFeatures;
  away: NcaabScoreFeatures;
  /** Explicit venue evidence only — never invent false when unknown. */
  neutralSite: boolean | null;
};

export type NcaabAdjustedTrainingGame = {
  id: string;
  inputSha256: string;
  labelSha256: string;
  observedAt: string;
  regulationHome: number;
  regulationAway: number;
  features: NcaabScoreFeaturePair;
};

export type NcaabAdjustedModel = {
  version: 1;
  sport: "ncaab";
  trainerVersion: typeof NCAAB_ADJUSTED_MODEL_VERSION;
  featureVersion: typeof NCAAB_ADJUSTED_FEATURE_VERSION;
  featureNames: string[];
  ridge: number;
  frozenAt: string;
  implementationCommit: string;
  implementationSha256: string;
  developmentManifestSha256: string;
  trainingGameIds: string[];
  excludedGameIds: string[];
  centers: number[];
  scales: number[];
  coefficients: number[];
  ranges: { min: number; max: number }[];
  researchOnly: true;
  productionReady: false;
  validationReady: false;
  releaseEligible: false;
  coachEnabled: false;
  evaluationPolicy: {
    bookPriority: string[];
    primaryMarket: "spread";
    secondaryMarkets: ["ml", "total"];
  };
  limitations: string[];
};

const time = (v: string) => Date.parse(v);

export function canonicalEvidenceJson(value: unknown): string {
  const sort = (x: any): any =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, sort(x[k])]),
          )
        : x;
  return JSON.stringify(sort(value));
}

export function ncaabAdjustedHash(value: unknown): string {
  return createHash("sha256").update(canonicalEvidenceJson(value)).digest("hex");
}

export function americanToImplied(price: number): number {
  if (!Number.isFinite(price) || Math.abs(price) < 100)
    throw Error("ncaab_adjusted_invalid_price");
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

type RawQuote = {
  book: string;
  market: string;
  name?: string | null;
  price: number;
  point?: number | null;
  sourceUpdatedAt: string;
};

export type NcaabPrimaryQuotes = {
  ml: {
    bookmaker: string;
    market: "ml";
    line: null;
    firstPrice: number;
    secondPrice: number;
    observedAt: string;
  } | null;
  spread: {
    bookmaker: string;
    market: "spread";
    line: number;
    firstPrice: number;
    secondPrice: number;
    observedAt: string;
  } | null;
  total: {
    bookmaker: string;
    market: "total";
    line: number;
    firstPrice: number;
    secondPrice: number;
    observedAt: string;
  } | null;
};

/** Normalize team names for exact identity matching — no mascot/substring fallback. */
export function normalizeNcaabTeamName(name: string): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Require exactly one home and one away quote row with unambiguous full-name
 * identity. Rejects substring/mascot matches and shared-name collisions.
 */
export function pairOpposingNcaabQuotes(
  rows: RawQuote[],
  homeName: string,
  awayName: string,
): { home: RawQuote; away: RawQuote } | null {
  const homeNorm = normalizeNcaabTeamName(homeName);
  const awayNorm = normalizeNcaabTeamName(awayName);
  if (!homeNorm || !awayNorm || homeNorm === awayNorm) return null;
  const homes = rows.filter(
    (r) => normalizeNcaabTeamName(String(r.name ?? "")) === homeNorm,
  );
  const aways = rows.filter(
    (r) => normalizeNcaabTeamName(String(r.name ?? "")) === awayNorm,
  );
  if (homes.length !== 1 || aways.length !== 1) return null;
  if (homes[0] === aways[0]) return null;
  return { home: homes[0], away: aways[0] };
}

/** Select primary ml/spread/total pairs from archived Odds API quote rows. */
export function selectPrimaryNcaabQuotes(
  quotes: RawQuote[],
  homeName: string,
  awayName: string,
): NcaabPrimaryQuotes {
  const byBookMarket = new Map<string, RawQuote[]>();
  for (const q of quotes) {
    if (!q?.book || !["h2h", "spreads", "totals"].includes(q.market)) continue;
    if (!Number.isFinite(q.price) || Math.abs(q.price) < 100) continue;
    const key = `${q.book}:${q.market}`;
    const list = byBookMarket.get(key) ?? [];
    list.push(q);
    byBookMarket.set(key, list);
  }
  const books = [
    ...new Set([...byBookMarket.keys()].map((k) => k.split(":")[0])),
  ].sort((a, b) => {
    const ia = NCAAB_BOOK_PRIORITY.indexOf(a as any);
    const ib = NCAAB_BOOK_PRIORITY.indexOf(b as any);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  let ml: NcaabPrimaryQuotes["ml"] = null;
  let spread: NcaabPrimaryQuotes["spread"] = null;
  let total: NcaabPrimaryQuotes["total"] = null;

  for (const book of books) {
    if (!ml) {
      const paired = pairOpposingNcaabQuotes(
        byBookMarket.get(`${book}:h2h`) ?? [],
        homeName,
        awayName,
      );
      if (paired) {
        ml = {
          bookmaker: book,
          market: "ml",
          line: null,
          firstPrice: paired.home.price,
          secondPrice: paired.away.price,
          observedAt: paired.home.sourceUpdatedAt,
        };
      }
    }
    if (!spread) {
      const paired = pairOpposingNcaabQuotes(
        byBookMarket.get(`${book}:spreads`) ?? [],
        homeName,
        awayName,
      );
      if (
        paired &&
        Number.isFinite(paired.home.point) &&
        Number.isFinite(paired.away.point) &&
        Math.abs((paired.home.point as number) + (paired.away.point as number)) <=
          1e-9
      ) {
        spread = {
          bookmaker: book,
          market: "spread",
          line: paired.home.point as number,
          firstPrice: paired.home.price,
          secondPrice: paired.away.price,
          observedAt: paired.home.sourceUpdatedAt,
        };
      }
    }
    if (!total) {
      const rows = byBookMarket.get(`${book}:totals`) ?? [];
      const overs = rows.filter((r) => /^over$/i.test(String(r.name ?? "").trim()));
      const unders = rows.filter((r) =>
        /^under$/i.test(String(r.name ?? "").trim()),
      );
      if (
        overs.length === 1 &&
        unders.length === 1 &&
        Number.isFinite(overs[0].point) &&
        overs[0].point === unders[0].point
      ) {
        total = {
          bookmaker: book,
          market: "total",
          line: overs[0].point as number,
          firstPrice: overs[0].price,
          secondPrice: unders[0].price,
          observedAt: overs[0].sourceUpdatedAt,
        };
      }
    }
  }

  return { ml, spread, total };
}

export function contextScoreFeaturesFromPrimary(
  primary: {
    ml: { firstPrice: number; secondPrice: number } | null;
    spread: { line: number; firstPrice: number; secondPrice: number } | null;
    total: { line: number } | null;
  },
  venue?: { neutralSite?: boolean | null },
): { features: NcaabScoreFeaturePair; missing: string[] } {
  const missing: string[] = [];
  if (!primary.ml) missing.push("ml_pair_missing");
  if (!primary.spread) missing.push("spread_pair_missing");
  if (!primary.total) missing.push("total_pair_missing");
  const neutralSite =
    typeof venue?.neutralSite === "boolean" ? venue.neutralSite : null;
  if (missing.length)
    return {
      features: {
        home: { baseline: 0, values: [], historyGameIds: [] },
        away: { baseline: 0, values: [], historyGameIds: [] },
        neutralSite,
      },
      missing,
    };

  const L = primary.spread!.line;
  const T = primary.total!.line;
  const homeBaseline = (T - L) / 2;
  const awayBaseline = (T + L) / 2;
  const homeMl = americanToImplied(primary.ml!.firstPrice);
  const awayMl = americanToImplied(primary.ml!.secondPrice);
  const homeValues = [
    1,
    L,
    T,
    homeMl,
    awayMl,
    primary.spread!.firstPrice,
    primary.spread!.secondPrice,
  ];
  const awayValues = [
    1,
    -L,
    T,
    awayMl,
    homeMl,
    primary.spread!.secondPrice,
    primary.spread!.firstPrice,
  ];
  return {
    features: {
      home: { baseline: homeBaseline, values: homeValues, historyGameIds: [] },
      away: { baseline: awayBaseline, values: awayValues, historyGameIds: [] },
      neutralSite,
    },
    missing,
  };
}

function solve(a: number[][], b: number[]) {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    if (!Number.isFinite(m[p][i]) || Math.abs(m[p][i]) < 1e-10)
      throw Error("ncaab_adjusted_singular_fit");
    [m[i], m[p]] = [m[p], m[i]];
    const div = m[i][i];
    for (let j = i; j <= n; j++) m[i][j] /= div;
    for (let k = 0; k < n; k++)
      if (k !== i) {
        const mult = m[k][i];
        for (let j = i; j <= n; j++) m[k][j] -= mult * m[i][j];
      }
  }
  return m.map((row) => row[n]);
}

export function fitNcaabAdjustedModel(
  games: NcaabAdjustedTrainingGame[],
  meta: {
    now: string;
    implementationCommit: string;
    implementationSha256: string;
    manifestSha256: string;
  },
): {
  state: string;
  reasons: string[];
  model?: NcaabAdjustedModel;
  modelSha256?: string;
} {
  if (
    !Number.isFinite(time(meta.now)) ||
    !/^[a-f0-9]{40}$/.test(meta.implementationCommit) ||
    !/^[a-f0-9]{64}$/.test(meta.implementationSha256) ||
    !/^[a-f0-9]{64}$/.test(meta.manifestSha256)
  )
    throw Error("ncaab_adjusted_invalid_fit_metadata");

  const sorted = [...games].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const g of sorted) {
    if (
      !/^\d{4}:\d+$/.test(g.id) ||
      ids.has(g.id) ||
      ![g.inputSha256, g.labelSha256].every((s) => /^[a-f0-9]{64}$/.test(s)) ||
      !Number.isFinite(time(g.observedAt)) ||
      time(g.observedAt) > time(meta.now) ||
      ![g.regulationHome, g.regulationAway].every(
        (v) =>
          Number.isSafeInteger(v) && v >= 0 && v <= NCAAB_SCORE_SUPPORT_MAX,
      ) ||
      [g.features.home, g.features.away].some(
        (s) =>
          s.values.length !== NCAAB_ADJUSTED_FEATURE_NAMES.length ||
          s.values[0] !== 1 ||
          s.values.some((v) => !Number.isFinite(v)) ||
          !Number.isFinite(s.baseline),
      )
    )
      throw Error("ncaab_adjusted_invalid_training_record");
    ids.add(g.id);
  }
  if (sorted.length < NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES)
    return {
      state: "waiting_for_more_development_games",
      reasons: [
        `requires_${NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES}_distinct_development_games`,
      ],
    };

  const rows = sorted.flatMap((g) => [
    { ...g.features.home, y: g.regulationHome - g.features.home.baseline },
    { ...g.features.away, y: g.regulationAway - g.features.away.baseline },
  ]);
  const p = NCAAB_ADJUSTED_FEATURE_NAMES.length;
  const centers = Array.from({ length: p }, (_, i) =>
    i ? rows.reduce((s, r) => s + r.values[i], 0) / rows.length : 0,
  );
  const scales = centers.map((mu, i) =>
    i
      ? Math.sqrt(
          rows.reduce((s, r) => s + (r.values[i] - mu) ** 2, 0) / rows.length,
        ) || 1
      : 1,
  );
  const ranges = centers.map((_, i) => ({
    min: Math.min(...rows.map((r) => r.values[i])),
    max: Math.max(...rows.map((r) => r.values[i])),
  }));
  const reasons: string[] = [];
  if (ranges[1].max - ranges[1].min < 1e-8)
    reasons.push("spread_line_effect_not_identifiable");
  if (ranges[2].max - ranges[2].min < 1e-8)
    reasons.push("total_line_effect_not_identifiable");
  if (ranges[3].max - ranges[3].min < 1e-8)
    reasons.push("ml_implied_effect_not_identifiable");
  if (reasons.length) return { state: "waiting_for_signal_variation", reasons };

  const matrix = Array.from({ length: p }, () => Array(p).fill(0));
  const target = Array(p).fill(0);
  const ridge = 4;
  for (const row of rows) {
    const x = row.values.map((v, i) => (v - centers[i]) / scales[i]);
    for (let i = 0; i < p; i++) {
      target[i] += x[i] * row.y;
      for (let j = 0; j < p; j++) matrix[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < p; i++) matrix[i][i] += ridge;
  const coefficients = solve(matrix, target);
  if (coefficients.some((v) => !Number.isFinite(v)))
    throw Error("ncaab_adjusted_nonfinite_fit");

  const model: NcaabAdjustedModel = {
    version: 1,
    sport: "ncaab",
    trainerVersion: NCAAB_ADJUSTED_MODEL_VERSION,
    featureVersion: NCAAB_ADJUSTED_FEATURE_VERSION,
    featureNames: [...NCAAB_ADJUSTED_FEATURE_NAMES],
    ridge,
    frozenAt: meta.now,
    implementationCommit: meta.implementationCommit,
    implementationSha256: meta.implementationSha256,
    developmentManifestSha256: meta.manifestSha256,
    trainingGameIds: [...ids].sort(),
    excludedGameIds: [...ids].sort(),
    centers,
    scales,
    coefficients,
    ranges,
    researchOnly: true,
    productionReady: false,
    validationReady: false,
    releaseEligible: false,
    coachEnabled: false,
    evaluationPolicy: {
      bookPriority: [...NCAAB_BOOK_PRIORITY],
      primaryMarket: "spread",
      secondaryMarkets: ["ml", "total"],
    },
    limitations: [
      "odds_context_ridge_not_causal",
      "regulation_fit_only_no_ot_transfer_model",
      "fixed_experimental_ridge_not_holdout_tuned",
      "no_injury_usage_or_history_priors_in_v1",
      "product_sim_ncaab_score_v2_is_not_this_artifact",
      "no_coach_release_authority",
    ],
  };
  return {
    state: "fitted_research_candidate",
    reasons: [],
    model,
    modelSha256: ncaabAdjustedHash(model),
  };
}

export function validateNcaabAdjustedModel(
  model: NcaabAdjustedModel,
  hash: string,
) {
  const n = NCAAB_ADJUSTED_FEATURE_NAMES.length;
  if (
    !model ||
    ncaabAdjustedHash(model) !== hash ||
    model.version !== 1 ||
    model.sport !== "ncaab" ||
    model.trainerVersion !== NCAAB_ADJUSTED_MODEL_VERSION ||
    model.featureVersion !== NCAAB_ADJUSTED_FEATURE_VERSION ||
    canonicalEvidenceJson(model.featureNames) !==
      canonicalEvidenceJson(NCAAB_ADJUSTED_FEATURE_NAMES) ||
    model.ridge !== 4 ||
    model.researchOnly !== true ||
    model.productionReady !== false ||
    model.validationReady !== false ||
    model.releaseEligible !== false ||
    model.coachEnabled !== false ||
    !Number.isFinite(time(model.frozenAt)) ||
    ![model.implementationSha256, model.developmentManifestSha256].every((s) =>
      /^[a-f0-9]{64}$/.test(s),
    ) ||
    !/^[a-f0-9]{40}$/.test(model.implementationCommit) ||
    ![model.centers, model.scales, model.coefficients, model.ranges].every(
      (a) => Array.isArray(a) && a.length === n,
    ) ||
    model.trainingGameIds.length < NCAAB_MIN_ADJUSTED_DEVELOPMENT_GAMES ||
    model.trainingGameIds.some((id) => !model.excludedGameIds.includes(id))
  )
    throw Error("ncaab_adjusted_invalid_frozen_artifact");
}

export function predictNcaabAdjustedMeans(
  model: NcaabAdjustedModel,
  hash: string,
  features: NcaabScoreFeaturePair,
) {
  validateNcaabAdjustedModel(model, hash);
  const score = (row: NcaabScoreFeatures) => {
    if (
      row.values.length !== model.featureNames.length ||
      row.values.some(
        (v, i) =>
          !Number.isFinite(v) ||
          v < model.ranges[i].min - 1e-9 ||
          v > model.ranges[i].max + 1e-9,
      )
    )
      throw Error("ncaab_adjusted_feature_outside_training_support");
    const mean =
      row.baseline +
      row.values.reduce(
        (sum, v, i) =>
          sum +
          ((v - model.centers[i]) / model.scales[i]) * model.coefficients[i],
        0,
      );
    if (
      !Number.isFinite(mean) ||
      mean < 0 ||
      mean > NCAAB_SCORE_SUPPORT_MAX
    )
      throw Error("ncaab_adjusted_prediction_outside_score_support");
    return mean;
  };
  return { home: score(features.home), away: score(features.away) };
}

/** Closed-form Normal CDF for research probabilities only. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function ncaabConditionalWinProbability(
  market: "ml" | "spread" | "total",
  line: number | null,
  homeMean: number,
  awayMean: number,
  sigma = NCAAB_RESEARCH_SCORE_SIGMA,
): number {
  if (!(sigma > 0)) throw Error("ncaab_adjusted_invalid_sigma");
  if (market === "ml") {
    const margin = homeMean - awayMean;
    return normalCdf(margin / (Math.SQRT2 * sigma));
  }
  if (market === "spread") {
    if (!Number.isFinite(line as number))
      throw Error("ncaab_adjusted_invalid_line");
    const value = homeMean - awayMean + (line as number);
    return normalCdf(value / (Math.SQRT2 * sigma));
  }
  if (!Number.isFinite(line as number))
    throw Error("ncaab_adjusted_invalid_line");
  const value = homeMean + awayMean - (line as number);
  return normalCdf(value / (Math.SQRT2 * sigma));
}
