// Usage: node coach-settled-pick-review.mjs < verified-settled-picks.json
// Each row is a delivered pregame pick joined to a verified settlement.
// Key by exact sport, market and model version. Probabilities use a 0–1 scale.
// opportunity pairs use the same stat and units for projection and outcome.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const rows = Array.isArray(input) ? input : joinVerifiedSettlements(input);

function joinVerifiedSettlements(input) {
  if (!Array.isArray(input?.pregamePicks) || !Array.isArray(input?.verifiedSettlements)) {
    throw new Error("Expected settled rows or { pregamePicks, verifiedSettlements }.");
  }

  const identityFields = ["sport", "eventId", "selectionId", "market", "side", "line"];
  function identity(row) {
    if (typeof row?.pickId !== "string" || !row.pickId.trim() ||
        !identityFields.slice(0, -1).every((field) => typeof row[field] === "string" && row[field].trim()) ||
        (row.line !== null && !Number.isFinite(row.line))) {
      throw new Error("Each record needs pick, sport, event, selection and market identifiers, side, and line.");
    }
    return JSON.stringify(identityFields.map((field) => row[field]));
  }

  const picks = new Map();
  for (const pick of input.pregamePicks) {
    const key = identity(pick);
    const recordedAt = Date.parse(pick.recordedAt);
    const startsAt = Date.parse(pick.startsAt);
    if (!Number.isFinite(recordedAt) || !Number.isFinite(startsAt) || recordedAt >= startsAt) {
      throw new Error(`Pick ${pick.pickId} has no valid pregame timestamp.`);
    }
    if (picks.has(pick.pickId)) throw new Error(`Duplicate pregame pick ${pick.pickId}`);
    picks.set(pick.pickId, { pick, key, startsAt });
  }

  const settled = [];
  const matched = new Set();
  for (const settlement of input.verifiedSettlements) {
    const key = identity(settlement);
    const match = picks.get(settlement.pickId);
    if (!match || match.key !== key) throw new Error(`Settlement identity mismatch for ${settlement.pickId}`);
    if (matched.has(settlement.pickId)) throw new Error(`Duplicate settlement for ${settlement.pickId}`);
    matched.add(settlement.pickId);
    if (settlement.status === "ungraded" || settlement.status === "pending") continue;

    const settledAt = Date.parse(settlement.settledAt);
    if (!Number.isFinite(settledAt) || settledAt <= match.startsAt) {
      throw new Error(`Settlement for ${settlement.pickId} needs a valid post-start timestamp.`);
    }

    const opportunity = Object.fromEntries(Object.entries(match.pick.projectedOpportunity ?? {}).map(
      ([stat, projected]) => [stat, { projected, actual: settlement.actualOpportunity?.[stat] }],
    ));
    settled.push({ ...match.pick, status: settlement.status, opportunity });
  }
  process.stderr.write(`Joined ${settled.length} of ${picks.size} pregame picks with verified settlements.\n`);
  return settled;
}

const groups = new Map();
const seen = new Set();
for (const row of rows) {
  const { pickId, sport, market, modelVersion, status, hitProbability, opportunity } = row;
  if (![pickId, sport, market, modelVersion].every((value) => typeof value === "string" && value.trim())) {
    throw new Error("Every row needs a pickId, sport, market and modelVersion.");
  }
  if (!["win", "loss", "push", "void"].includes(status)) throw new Error(`Invalid settlement for ${pickId}`);
  if (seen.has(pickId)) throw new Error(`Duplicate settlement for ${pickId}`);
  seen.add(pickId);

  const key = JSON.stringify([sport, market, modelVersion]);
  const group = groups.get(key) ?? {
    sport, market, modelVersion, win: 0, loss: 0, push: 0, void: 0,
    probabilitySamples: 0, squaredError: 0, opportunity: new Map(),
  };
  groups.set(key, group);
  group[status]++;
  if (status !== "win" && status !== "loss") continue;

  if (Number.isFinite(hitProbability) && hitProbability >= 0 && hitProbability <= 1) {
    group.probabilitySamples++;
    group.squaredError += (hitProbability - Number(status === "win")) ** 2;
  }
  for (const [stat, pair] of Object.entries(opportunity ?? {})) {
    if (!pair || ![pair.projected, pair.actual].every((n) => Number.isFinite(n) && n >= 0)) continue;
    const key = JSON.stringify([stat, status]);
    const statGroup = group.opportunity.get(key) ?? { stat, status, samples: 0, error: 0, absoluteError: 0 };
    group.opportunity.set(key, statGroup);
    const error = pair.actual - pair.projected;
    statGroup.samples++;
    statGroup.error += error;
    statGroup.absoluteError += Math.abs(error);
  }
}

const report = [...groups.values()].map(({ squaredError, opportunity, ...group }) => ({
  ...group,
  hitRate: group.win + group.loss ? group.win / (group.win + group.loss) : null,
  brierScore: group.probabilitySamples ? squaredError / group.probabilitySamples : null,
  opportunity: [...opportunity.values()].map(({ error, absoluteError, ...stat }) => ({
    ...stat,
    meanActualMinusProjected: error / stat.samples,
    meanAbsoluteError: absoluteError / stat.samples,
  })),
}));
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
