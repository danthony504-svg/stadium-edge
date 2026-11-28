/**
 * Evaluate one predeclared sport/cohort on a sealed holdout.
 * Input uses conditional non-push cover probabilities and a matched no-vig
 * closing probability for the same side, handicap and settlement rules.
 */
export function evaluateSpreadRelease({ rows, enabledBands, draws = 4000 }) {
  if (!enabledBands.length || enabledBands.some(band => !Number.isInteger(band) || band < 0 || band > 9)
      || !Number.isInteger(draws) || draws < 1000) throw new Error("invalid release evaluation settings");
  if (new Set(rows.map(row => row.eventId)).size !== rows.length) throw new Error("duplicate holdout game");
  const settled = rows.filter(row => row.result !== "push").map(row => {
    if (!row.eventId || !["win", "loss"].includes(row.result)
        || !(row.modelProbability >= 0 && row.modelProbability <= 1)
        || !Number.isFinite(row.price) || Math.abs(row.price) < 100) throw new Error("invalid settled quote");
    const profit = row.price > 0 ? row.price / 100 : 100 / -row.price;
    const win = Number(row.result === "win");
    const close = row.closingFairProbability;
    const matched = row.closeMatches === true && Number.isFinite(close) && close >= 0 && close <= 1;
    return {
      band: Math.min(9, Math.floor(row.modelProbability * 10)),
      gap: row.modelProbability - win,
      selected: row.edgeQualified === true,
      closingValue: matched ? close * (profit + 1) - 1 : null,
      realizedReturn: win ? profit : -1,
    };
  });

  const assess = (group, minimum) => {
    const selections = group.filter(row => row.selected);
    const matched = selections.filter(row => row.closingValue != null);
    const gap = mean(group.map(row => row.gap));
    const calibrationInterval = interval(group, ["gap"], draws)?.[0] ?? null;
    const edgeIntervals = interval(matched, ["closingValue", "realizedReturn"], draws);
    const calibrationPass = group.length >= minimum && Math.abs(gap) <= 0.05 + 1e-12
      && calibrationInterval[0] >= -0.10 - 1e-12 && calibrationInterval[1] <= 0.10 + 1e-12;
    const edgePass = matched.length > 0 && matched.length === selections.length
      && edgeIntervals.every(bounds => bounds[0] > 0);
    return {
      games: group.length, gap, calibrationInterval, calibrationPass,
      edgeSelections: selections.length, missingClosingQuote: selections.length - matched.length,
      closingValueInterval: edgeIntervals?.[0] ?? null, realizedReturnInterval: edgeIntervals?.[1] ?? null,
      edgePass,
    };
  };

  const allowed = new Set(enabledBands);
  const bands = Array.from({ length: 10 }, (_, band) => {
    const group = settled.filter(row => row.band === band);
    return { band, enabled: allowed.has(band), ...assess(group, 100) };
  });
  const overall = assess(settled.filter(row => allowed.has(row.band)), 500);
  const worstBand = bands.filter(band => band.games > 0)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0] ?? null;
  return {
    pushes: rows.length - settled.length, overall, bands, worstBand,
    release: overall.calibrationPass && overall.edgePass
      && bands.filter(band => band.enabled).every(band => band.calibrationPass && band.edgePass),
  };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// Resample a game once per draw and reuse that index for both edge metrics.
function interval(rows, keys, draws) {
  if (!rows.length) return null;
  let seed = 0x52ab9281;
  const results = keys.map(() => []);
  for (let draw = 0; draw < draws; draw++) {
    const sums = keys.map(() => 0);
    for (let i = 0; i < rows.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const row = rows[Math.floor(seed / 0x100000000 * rows.length)];
      keys.forEach((key, index) => { sums[index] += row[key]; });
    }
    sums.forEach((sum, index) => results[index].push(sum / rows.length));
  }
  return results.map(values => {
    values.sort((a, b) => a - b);
    return [values[Math.floor(draws * 0.025)], values[Math.ceil(draws * 0.975) - 1]];
  });
}
