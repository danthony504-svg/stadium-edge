// Structured scouting reports from verified feeds only — missing data stays labeled.

import type {
  MlbBatterSplits,
  MlbGameEnv,
  MlbProbable,
  PlayerHistory,
  PlayerSearchResult,
  RealPropEntry,
  TeamHistory,
  TeamSearchResult,
} from "./api.ts";
import { impliedProb, formatAmerican, decimalToAmerican } from "./format.ts";
import { gradeFromComposite } from "./propHolisticRecommendation.ts";
import { deriveConfidenceScore } from "./confidence.ts";

export type ScoutingField = {
  label: string;
  value: string | null;
};

export type ScoutingSection = {
  title: string;
  fields: ScoutingField[];
};

export type PriceVerdict = "fair" | "overpriced" | "underpriced" | null;

export type ScoutingReport = {
  kind: "player" | "team";
  title: string;
  subtitle: string;
  asOf: string;
  sources: string[];
  sections: ScoutingSection[];
  marketExpectation: string | null;
  modelExpectation: string | null;
  priceVerdict: PriceVerdict;
  aiGrade: string | null;
  confidencePct: number | null;
  riskLevel: string | null;
  bestProp: string | null;
  bestOdds: string | null;
};

export type PlayerScoutingEnrichment = {
  splits?: MlbBatterSplits | null;
  probables?: { pitcher?: MlbProbable | null; gameEnv?: MlbGameEnv | null };
  props?: RealPropEntry[];
  injuryStatus?: string | null;
};

export type TeamScoutingEnrichment = {
  injuries?: string | null;
  bookOdds?: number | null;
  fairOdds?: number | null;
  winProb?: number | null;
  startingPitcher?: string | null;
  gameEnv?: MlbGameEnv | null;
};

const NA = null;

function section(title: string, fields: ScoutingField[]): ScoutingSection {
  return { title, fields: fields.filter((f) => f.label) };
}

function fmtAvg(map: Record<string, number> | null | undefined, key: string): string | null {
  const v = map?.[key];
  if (v == null || !Number.isFinite(v)) return null;
  return String(v);
}

function statNum(stats: Record<string, string> | undefined, keys: string[]): number | null {
  if (!stats) return null;
  for (const k of keys) {
    const raw = stats[k];
    if (raw == null) continue;
    const v = parseFloat(String(raw).replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function recentWindowAvg(
  history: PlayerHistory,
  n: 5 | 10 | 20,
  statKeys: string[],
): string | null {
  const recent = history.recent ?? [];
  if (!recent.length) return null;
  const slice = recent.slice(0, n);
  const vals: number[] = [];
  for (const g of slice) {
    const v = statNum(g.stats, statKeys);
    if (v != null) vals.push(v);
  }
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `${avg.toFixed(2)} avg (${slice.length} games)`;
}

function homeAwaySplit(history: PlayerHistory, statKeys: string[]): string | null {
  const recent = history.recent ?? [];
  const home: number[] = [];
  const away: number[] = [];
  for (const g of recent) {
    const v = statNum(g.stats, statKeys);
    if (v == null) continue;
    if (g.isHome === true) home.push(v);
    else if (g.isHome === false) away.push(v);
  }
  if (!home.length && !away.length) return null;
  const avg = (arr: number[]) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : "—");
  return `Home ${avg(home)} (${home.length}g) / Away ${avg(away)} (${away.length}g)`;
}

function projectedStatLine(history: PlayerHistory, sport: string): string | null {
  const avgs = history.seasonSummary?.averages ?? {};
  const keys =
    sport === "mlb"
      ? ["HR", "H", "RBI", "R"]
      : sport === "nba" || sport === "wnba"
        ? ["PTS", "REB", "AST"]
        : ["G", "PTS", "SOG"];
  const parts: string[] = [];
  for (const k of keys) {
    const v = avgs[k];
    if (v != null && Number.isFinite(v)) parts.push(`${k} ~${v.toFixed(1)}`);
  }
  return parts.length ? parts.join(", ") : null;
}

function priceVerdict(edgePct: number | null): PriceVerdict {
  if (edgePct == null || !Number.isFinite(edgePct)) return null;
  if (edgePct >= 2) return "underpriced";
  if (edgePct <= -2) return "overpriced";
  return "fair";
}

function findBestPlayerProp(player: string, props: RealPropEntry[]): RealPropEntry | null {
  const want = player.toLowerCase();
  let best: RealPropEntry | null = null;
  let bestEdge = -Infinity;
  for (const p of props) {
    if (!p.player?.toLowerCase().includes(want.split(" ").pop() ?? want)) continue;
    const edge = p.edge ?? p.ev ?? null;
    if (edge != null && Number.isFinite(edge) && edge > bestEdge) {
      bestEdge = edge;
      best = p;
    }
  }
  return best ?? props.find((p) => p.player?.toLowerCase().includes(want.split(" ").pop() ?? want)) ?? null;
}

export function buildPlayerScoutingReport(
  resolved: PlayerSearchResult,
  history: PlayerHistory,
  enrich: PlayerScoutingEnrichment = {},
): ScoutingReport {
  const sport = (resolved.sport ?? "").toLowerCase();
  const isMlb = sport === "mlb";
  const splits = enrich.splits;
  const props = enrich.props ?? [];
  const bestProp = findBestPlayerProp(resolved.name, props);
  const implied =
    bestProp?.over != null
      ? impliedProb(bestProp.over)
      : bestProp?.under != null
        ? impliedProb(bestProp.under)
        : null;
  const modelProb = bestProp?.fairProb ?? (bestProp?.simHitPct != null ? bestProp.simHitPct / 100 : null);
  const edgePct = bestProp?.edge ?? null;
  const confidence = deriveConfidenceScore(edgePct, bestProp?.over ?? bestProp?.under ?? null, bestProp?.fairProb);
  const composite = confidence != null ? (confidence / 10) * 9 + 1 : null;
  const grade = gradeFromComposite(composite);

  const statKeys =
    sport === "mlb"
      ? ["HR", "H", "RBI", "R"]
      : sport === "nba" || sport === "wnba"
        ? ["PTS", "REB", "AST"]
        : ["G", "PTS", "SOG"];

  const season = history.seasonSummary;
  const seasonLine =
    season?.averages?.PTS != null
      ? `PTS ${season.averages.PTS.toFixed(1)}/g`
      : season?.averages?.HR != null
        ? `HR ${season.averages.HR?.toFixed?.(2) ?? season.totals?.HR} /g`
        : season?.games
          ? `${season.games} GP`
          : null;

  const pitcher = enrich.probables?.pitcher;
  const gameEnv = enrich.probables?.gameEnv;
  const wx = gameEnv?.weather;

  const sections: ScoutingSection[] = [
    section("Season & form", [
      { label: "Season stats", value: seasonLine },
      { label: "Last 5 games", value: recentWindowAvg(history, 5, statKeys) },
      { label: "Last 10 games", value: recentWindowAvg(history, 10, statKeys) },
      { label: "Last 20 games", value: recentWindowAvg(history, 20, statKeys) },
      { label: "Recent trend", value: history.recent?.length ? `${history.recent.length} games on file` : NA },
      { label: "AI projected stat line", value: projectedStatLine(history, sport) },
    ]),
    section("Splits", [
      { label: "Home vs away", value: homeAwaySplit(history, statKeys) },
      {
        label: "vs LHP",
        value: splits?.vsLeft ? `OPS ${fmtAvg(splits.vsLeft, "OPS") ?? "—"}, HR ${fmtAvg(splits.vsLeft, "HR") ?? "—"}` : NA,
      },
      {
        label: "vs RHP",
        value: splits?.vsRight ? `OPS ${fmtAvg(splits.vsRight, "OPS") ?? "—"}, HR ${fmtAvg(splits.vsRight, "HR") ?? "—"}` : NA,
      },
      { label: "Day vs night", value: NA },
      { label: "Handedness", value: splits?.bats ?? NA },
    ]),
    section("Matchup & usage", [
      { label: "Injury status", value: enrich.injuryStatus ?? NA },
      { label: "Lineup / playing time", value: NA },
      { label: "Opposing pitcher", value: pitcher?.name ?? NA },
      { label: "Pitcher handedness", value: pitcher?.throws ?? NA },
      { label: "Pitcher HR/9", value: pitcher?.tendency?.hrPer9 != null ? String(pitcher.tendency.hrPer9) : NA },
      {
        label: "Head-to-head",
        value: history.vsOpponent?.length
          ? `${history.vsOpponent.length} games vs ${history.vsOpponentName ?? "opponent"}`
          : NA,
      },
    ]),
    ...(isMlb
      ? [
          section("Park & weather", [
            { label: "Stadium", value: gameEnv?.venue ?? NA },
            { label: "Park HR factor", value: gameEnv?.park?.hrIndex != null ? String(gameEnv.park.hrIndex) : NA },
            { label: "Wind", value: wx?.windMph != null ? `${wx.windMph} mph` : NA },
            { label: "Temperature", value: wx?.tempF != null ? `${wx.tempF}°F` : NA },
            { label: "Weather impact", value: wx ? "See factors below" : NA },
          ]),
        ]
      : []),
    section("Advanced (when available)", [
      {
        label: "Barrel % allowed",
        value: pitcher?.tendency?.barrelPctAllowed != null ? `${pitcher.tendency.barrelPctAllowed}%` : NA,
      },
      {
        label: "Hard-hit % allowed",
        value: pitcher?.tendency?.hardHitPctAllowed != null ? `${pitcher.tendency.hardHitPctAllowed}%` : NA,
      },
      {
        label: "Fly-ball rate",
        value: pitcher?.tendency?.flyBallPct != null ? `${pitcher.tendency.flyBallPct}%` : NA,
      },
      { label: "wOBA / xwOBA / xSLG", value: NA },
    ]),
    section("Betting snapshot", [
      { label: "Best available prop", value: bestProp ? `${bestProp.player} ${bestProp.market} ${bestProp.line ?? ""}` : NA },
      {
        label: "Best odds",
        value:
          bestProp?.over != null
            ? formatAmerican(bestProp.over)
            : bestProp?.under != null
              ? formatAmerican(bestProp.under)
              : NA,
      },
      { label: "Implied probability", value: implied != null ? `${Math.round(implied * 1000) / 10}%` : NA },
      { label: "Model probability", value: modelProb != null ? `${Math.round(modelProb * 1000) / 10}%` : NA },
      { label: "Edge %", value: edgePct != null ? `${edgePct >= 0 ? "+" : ""}${edgePct}%` : NA },
      { label: "Confidence", value: confidence != null ? `${confidence}/10` : NA },
      { label: "AI grade", value: grade },
      {
        label: "Risk level",
        value:
          modelProb != null && modelProb < 0.15
            ? "High"
            : modelProb != null && modelProb < 0.35
              ? "Moderate"
              : modelProb != null
                ? "Lower"
                : NA,
      },
    ]),
  ];

  const fairOdds =
    modelProb != null && modelProb > 0 && modelProb < 1 ? formatAmerican(decimalToAmerican(1 / modelProb)) : null;

  return {
    kind: "player",
    title: resolved.name,
    subtitle: [resolved.team, sport.toUpperCase()].filter(Boolean).join(" · "),
    asOf: new Date().toISOString(),
    sources: [
      "ESPN game logs",
      ...(isMlb ? ["MLB probables", "Platoon splits"] : []),
      ...(props.length ? ["Live props board"] : []),
    ],
    sections,
    marketExpectation: implied != null ? `${Math.round(implied * 1000) / 10}% implied` : null,
    modelExpectation:
      modelProb != null ? `${Math.round(modelProb * 1000) / 10}% model` : fairOdds ? `Fair ~${fairOdds}` : null,
    priceVerdict: priceVerdict(edgePct),
    aiGrade: grade,
    confidencePct: confidence != null ? Math.round(confidence * 10) : null,
    riskLevel:
      modelProb != null && modelProb < 0.15 ? "High" : modelProb != null && modelProb < 0.35 ? "Moderate" : null,
    bestProp: bestProp ? `${bestProp.market} ${bestProp.line ?? ""}` : null,
    bestOdds:
      bestProp?.over != null ? formatAmerican(bestProp.over) : bestProp?.under != null ? formatAmerican(bestProp.under) : null,
  };
}

export function buildTeamScoutingReport(
  resolved: TeamSearchResult,
  history: TeamHistory,
  enrich: TeamScoutingEnrichment = {},
): ScoutingReport {
  const f10 = history.last10;
  const rec = history.record;
  const implied = enrich.bookOdds != null ? impliedProb(enrich.bookOdds) : null;
  const modelProb = enrich.winProb ?? null;
  const edgePct =
    implied != null && modelProb != null ? Math.round((modelProb - implied) * 1000) / 10 : null;
  const home = history.homeSplit;
  const away = history.awaySplit;
  const wx = enrich.gameEnv?.weather;

  const sections: ScoutingSection[] = [
    section("Record & momentum", [
      { label: "Record", value: rec.games ? `${rec.wins}-${rec.losses}` : NA },
      { label: "Last 10", value: f10.games ? `${f10.wins}-${f10.losses}` : NA },
      {
        label: "Home / away",
        value:
          home.games || away.games
            ? `Home ${home.wins}-${home.losses}, Away ${away.wins}-${away.losses}`
            : NA,
      },
      { label: "Streak", value: history.streak ? `${history.streak.type}${history.streak.count}` : NA },
      {
        label: "Pts for / against (L10)",
        value: f10.ptsFor != null ? `${f10.ptsFor.toFixed(1)} / ${f10.ptsAgainst?.toFixed(1) ?? "—"}` : NA,
      },
    ]),
    section("Context", [
      { label: "Injuries", value: enrich.injuries ?? NA },
      { label: "Starting pitcher / goalie", value: enrich.startingPitcher ?? NA },
      { label: "Bullpen / pace", value: NA },
      { label: "Travel / rest", value: NA },
      {
        label: "Park factor",
        value: enrich.gameEnv?.park?.hrIndex != null ? `HR index ${enrich.gameEnv.park.hrIndex}` : NA,
      },
      {
        label: "Weather",
        value:
          wx?.tempF != null
            ? `${wx.tempF}°F${wx.windMph != null ? `, wind ${wx.windMph} mph` : ""}`
            : NA,
      },
    ]),
    section("Betting snapshot", [
      { label: "Sportsbook odds", value: enrich.bookOdds != null ? formatAmerican(enrich.bookOdds) : NA },
      { label: "Implied win %", value: implied != null ? `${Math.round(implied * 1000) / 10}%` : NA },
      { label: "Model win %", value: modelProb != null ? `${Math.round(modelProb * 1000) / 10}%` : NA },
      { label: "Fair odds", value: enrich.fairOdds != null ? formatAmerican(enrich.fairOdds) : NA },
      { label: "Edge %", value: edgePct != null ? `${edgePct >= 0 ? "+" : ""}${edgePct}%` : NA },
    ]),
  ];

  return {
    kind: "team",
    title: history.teamName || resolved.name,
    subtitle: String(resolved.sport).toUpperCase(),
    asOf: new Date().toISOString(),
    sources: ["ESPN schedule & results", ...(enrich.bookOdds != null ? ["Live odds"] : [])],
    sections,
    marketExpectation: implied != null ? `${Math.round(implied * 1000) / 10}% implied` : null,
    modelExpectation: modelProb != null ? `${Math.round(modelProb * 1000) / 10}% model` : null,
    priceVerdict: priceVerdict(edgePct),
    aiGrade: null,
    confidencePct: null,
    riskLevel: null,
    bestProp: null,
    bestOdds: enrich.bookOdds != null ? formatAmerican(enrich.bookOdds) : null,
  };
}

export function serializeScoutingReportForAI(report: ScoutingReport): string {
  const lines = [
    "SCOUTING REPORT (verified data only — cite these numbers; label anything missing as unavailable):",
    `${report.title} (${report.kind})`,
    `As of: ${report.asOf}`,
    `Sources: ${report.sources.join(", ")}`,
    `Market: ${report.marketExpectation ?? "Not available"}`,
    `Model: ${report.modelExpectation ?? "Not available"}`,
    `Price verdict: ${report.priceVerdict ?? "Not available"}`,
    `AI grade: ${report.aiGrade ?? "Not available"}`,
  ];
  for (const sec of report.sections) {
    lines.push(`\n## ${sec.title}`);
    for (const f of sec.fields) {
      lines.push(`- ${f.label}: ${f.value ?? "Not available"}`);
    }
  }
  lines.push(
    "\nWrite a complete scouting report in prose using ONLY the fields above. Include market vs model, price verdict, grade, risk, and a clear explanation of why the model likes or dislikes the subject. Never invent stats.",
  );
  return lines.join("\n");
}
