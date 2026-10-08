import type { EligibleGame, FootballSport } from "./types.js";

export type ChronoFold = "train" | "val" | "holdout";

export type ChronoSplit = {
  sport: FootballSport;
  train: EligibleGame[];
  val: EligibleGame[];
  holdout: EligibleGame[];
  labels: { train: string; val: string; holdout: string };
};

/** Chronological splits — holdout never used for parameter estimation. */
export function splitChronological(
  sport: FootballSport,
  eligible: EligibleGame[],
): ChronoSplit {
  if (sport === "nfl") {
    return {
      sport,
      train: eligible.filter((e) => e.game.season === 2022),
      val: eligible.filter((e) => e.game.season === 2023),
      holdout: eligible.filter((e) => e.game.season === 2024),
      labels: { train: "NFL 2022", val: "NFL 2023", holdout: "NFL 2024" },
    };
  }
  return {
    sport,
    train: eligible.filter((e) => e.game.season === 2023),
    val: eligible.filter((e) => e.game.season === 2024 && e.game.week <= 7),
    holdout: eligible.filter((e) => e.game.season === 2024 && e.game.week >= 8),
    labels: {
      train: "NCAAF 2023",
      val: "NCAAF 2024 weeks 1–7",
      holdout: "NCAAF 2024 weeks 8–15",
    },
  };
}
