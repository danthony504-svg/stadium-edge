/**
 * Score persisted NCAAB research probabilities against an authenticated final.
 * Never recomputes from a simulator and never enables release.
 */
export type NcaabSettledOutcome = {
  eventId: string;
  season: number;
  homeId: string;
  awayId: string;
  kickoff: string;
  homePoints: number;
  awayPoints: number;
  ruleset: "full_game_including_overtime";
};

export type NcaabForecastMarket = {
  bookmaker: string;
  market: "ml" | "spread" | "total";
  line: number | null;
  firstPrice: number;
  secondPrice: number;
  conditionalWinProbability: number | null;
};

export type NcaabResearchForecast = {
  researchOnly: true;
  modelVersion: string;
  recordedAt: string;
  forecastAt: string;
  inputCutoffAt: string;
  target: {
    eventId: string;
    season: number;
    homeId: string;
    awayId: string;
    kickoff: string;
    ruleset: "full_game_including_overtime";
  };
  markets: NcaabForecastMarket[];
};

const ms = (value: string) => Date.parse(value);

function assertOutcome(outcome: NcaabSettledOutcome) {
  if (
    !/^\d+$/.test(outcome.eventId) ||
    !Number.isSafeInteger(outcome.season) ||
    !/^\d+$/.test(outcome.homeId) ||
    !/^\d+$/.test(outcome.awayId) ||
    outcome.homeId === outcome.awayId ||
    !Number.isFinite(ms(outcome.kickoff)) ||
    !Number.isSafeInteger(outcome.homePoints) ||
    !Number.isSafeInteger(outcome.awayPoints) ||
    outcome.homePoints < 0 ||
    outcome.awayPoints < 0 ||
    outcome.ruleset !== "full_game_including_overtime"
  )
    throw Error("ncaab_settlement_invalid_outcome");
}

/** Score saved market probabilities; pushes yield null Brier. */
export function scoreNcaabRecordedForecast(
  record: NcaabResearchForecast,
  outcome: NcaabSettledOutcome,
) {
  assertOutcome(outcome);
  const t = record.target;
  if (
    !record.researchOnly ||
    typeof record.modelVersion !== "string" ||
    !record.modelVersion ||
    ![
      record.recordedAt,
      record.forecastAt,
      record.inputCutoffAt,
      t.kickoff,
    ].every((v) => Number.isFinite(ms(v))) ||
    ms(record.inputCutoffAt) > ms(record.forecastAt) ||
    ms(record.recordedAt) < ms(record.forecastAt) ||
    ms(record.recordedAt) >= ms(t.kickoff) ||
    outcome.eventId !== t.eventId ||
    outcome.season !== t.season ||
    outcome.homeId !== t.homeId ||
    outcome.awayId !== t.awayId ||
    ms(outcome.kickoff) !== ms(t.kickoff) ||
    t.ruleset !== "full_game_including_overtime" ||
    !Array.isArray(record.markets) ||
    record.markets.length === 0
  )
    throw Error("ncaab_settlement_unmatched_or_late_record");

  return record.markets.map((q) => {
    if (!["ml", "spread", "total"].includes(q.market))
      throw Error("ncaab_settlement_unknown_market");
    if (
      (q.market === "ml" && q.line != null) ||
      (q.market !== "ml" && !Number.isFinite(q.line as number))
    )
      throw Error("ncaab_settlement_invalid_line");
    const p = q.conditionalWinProbability;
    if (p !== null && (!Number.isFinite(p) || p < 0 || p > 1))
      throw Error("ncaab_settlement_invalid_saved_probability");
    if (
      !Number.isFinite(q.firstPrice) ||
      !Number.isFinite(q.secondPrice) ||
      Math.abs(q.firstPrice) < 100 ||
      Math.abs(q.secondPrice) < 100
    )
      throw Error("ncaab_settlement_invalid_price");

    const value =
      q.market === "ml"
        ? outcome.homePoints - outcome.awayPoints
        : q.market === "spread"
          ? outcome.homePoints - outcome.awayPoints + (q.line as number)
          : outcome.homePoints + outcome.awayPoints - (q.line as number);
    const implied = (price: number) =>
      price < 0 ? -price / (-price + 100) : 100 / (price + 100);
    const a = implied(q.firstPrice);
    const b = implied(q.secondPrice);
    const marketProbability = a / (a + b);
    const hit = value > 0 ? 1 : 0;
    return {
      eventId: t.eventId,
      season: t.season,
      modelVersion: record.modelVersion,
      bookmaker: q.bookmaker,
      market: q.market,
      line: q.line,
      result: value === 0 ? ("push" as const) : value > 0 ? ("win" as const) : ("loss" as const),
      modelBrier: value === 0 || p === null ? null : (p - hit) ** 2,
      marketBrier:
        value === 0 || p === null ? null : (marketProbability - hit) ** 2,
      validationReady: false,
      releaseEligible: false,
    };
  });
}
