/**
 * Provisional MLB weather → weatherImpact mapper for holdout research.
 *
 * Live Coach / subscriber prop sims leave weatherImpact null unless the caller
 * explicitly opts in (`applyPreparedWeatherImpact`). Wind direction relative to
 * the field is unknown from OpenWeather alone, so this mapper uses temperature
 * only and never invents park-direction effects.
 */
import type { PreparedGameContext } from "./preparedGameContext.js";

export type MlbWeatherImpactResolution = {
  /** Clamped [-1, 1] or null when evidence is insufficient. */
  impact: number | null;
  /** Why impact is present/absent — never silent. */
  reason: string;
  /** True only when a numeric impact was derived from verified outdoor temp. */
  derived: boolean;
  appliedToSimulation: boolean;
  evidence: {
    exposure: PreparedGameContext["environment"]["exposure"] | null;
    source: string | null;
    forecastAtMs: number | null;
    observedAtMs: number | null;
    tempF: number | null;
    windMph: number | null;
    precipChancePct: number | null;
  };
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function mlbPreparedWeatherImpact(
  prepared: PreparedGameContext | null | undefined,
  opts?: { applyToSimulation?: boolean },
): MlbWeatherImpactResolution {
  const apply = opts?.applyToSimulation === true;
  const exposure = prepared?.environment?.exposure ?? null;
  const weather = prepared?.environment?.weather ?? null;
  const evidence = {
    exposure,
    source: weather?.source ?? null,
    forecastAtMs: weather?.forecastAtMs ?? null,
    observedAtMs: weather?.observedAtMs ?? null,
    tempF: weather?.tempF ?? null,
    windMph: weather?.windMph ?? null,
    precipChancePct: weather?.precipChancePct ?? null,
  };

  if (!prepared || String(prepared.sport ?? "").toLowerCase() !== "mlb") {
    return {
      impact: null,
      reason: "not_mlb_or_missing_prepared_context",
      derived: false,
      appliedToSimulation: false,
      evidence,
    };
  }
  if (exposure === "indoors") {
    return {
      impact: 0,
      reason: "indoors_neutral",
      derived: true,
      appliedToSimulation: apply,
      evidence,
    };
  }
  if (exposure !== "outdoor") {
    return {
      impact: null,
      reason: "exposure_not_confirmed_outdoor",
      derived: false,
      appliedToSimulation: false,
      evidence,
    };
  }
  if (!weather) {
    return {
      impact: null,
      reason: "prepared_weather_missing",
      derived: false,
      appliedToSimulation: false,
      evidence,
    };
  }
  if (weather.tempF == null || !Number.isFinite(weather.tempF)) {
    return {
      impact: null,
      reason: "temp_missing_wind_direction_not_used",
      derived: false,
      appliedToSimulation: false,
      evidence,
    };
  }

  // Neutral ~62.5°F; warmer favors hitters in the existing MC multiplier contract.
  const impact = clamp((weather.tempF - 62.5) / 35, -1, 1);
  return {
    impact: Math.round(impact * 1000) / 1000,
    reason: "provisional_temp_only_unvalidated",
    derived: true,
    appliedToSimulation: apply,
    evidence,
  };
}

/**
 * Resolve weatherImpact for the prop-sim hot path.
 * Prefer an explicit request body value; otherwise keep null for subscribers
 * and optionally apply the provisional prepared mapper for holdout research.
 */
export function resolvePropSimWeatherImpact(opts: {
  sport: string;
  bodyWeatherImpact: number | null | undefined;
  prepared: PreparedGameContext | null | undefined;
  applyPreparedWeatherImpact?: boolean;
}): {
  weatherImpact: number | null;
  weatherResearch: MlbWeatherImpactResolution;
} {
  const sport = String(opts.sport ?? "").toLowerCase();
  const body =
    opts.bodyWeatherImpact != null && Number.isFinite(Number(opts.bodyWeatherImpact))
      ? Number(opts.bodyWeatherImpact)
      : null;

  if (sport !== "mlb") {
    return {
      weatherImpact: body,
      weatherResearch: {
        impact: null,
        reason: "not_mlb",
        derived: false,
        appliedToSimulation: false,
        evidence: {
          exposure: opts.prepared?.environment?.exposure ?? null,
          source: opts.prepared?.environment?.weather?.source ?? null,
          forecastAtMs: opts.prepared?.environment?.weather?.forecastAtMs ?? null,
          observedAtMs: opts.prepared?.environment?.weather?.observedAtMs ?? null,
          tempF: opts.prepared?.environment?.weather?.tempF ?? null,
          windMph: opts.prepared?.environment?.weather?.windMph ?? null,
          precipChancePct: opts.prepared?.environment?.weather?.precipChancePct ?? null,
        },
      },
    };
  }

  if (body != null) {
    const shadow = mlbPreparedWeatherImpact(opts.prepared, { applyToSimulation: false });
    return {
      weatherImpact: body,
      weatherResearch: {
        ...shadow,
        reason: `request_body_weather_impact;shadow=${shadow.reason}`,
        appliedToSimulation: true,
      },
    };
  }

  const resolved = mlbPreparedWeatherImpact(opts.prepared, {
    applyToSimulation: opts.applyPreparedWeatherImpact === true,
  });
  return {
    weatherImpact: resolved.appliedToSimulation ? resolved.impact : null,
    weatherResearch: resolved,
  };
}
