/** Explicit research transfer, never a production compatibility certificate. */
import { createHash } from "node:crypto";
import {
  readFullGameReplayArchive,
  type TimedGame,
} from "./ncaafFullGameBacktest.js";
export const OT_TRANSFER_MODEL_VERSION =
  "ncaaf-observed-ot-transfer-research-v2";
export const OT_TRANSFER_REGIME = "ncaa-extra-periods-2025-2026-research-v1";
export const OT_RULE_REVIEW = {
  rule: "3-1-3",
  review: "procedural_text_match_only_not_transfer_calibration",
  normalizedArticleSha256:
    "7a88d48655dcf8ea6cc7645eeb58f338069ddb525363af64c71ae21a9181aaa5",
  source2025: {
    url: "https://sccfoa.org/docs/2025/2025%20NCAA%20Rules%20Book.pdf",
    sha256: "89215a1bdcbb211b5495eaa4f921b7b4c36bcabbd06cfaaa6026c279d10154dd",
  },
  source2026: {
    url: "https://ncaaorg.s3.amazonaws.com/championships/sports/football/rules/PRMFB_RulesBook.pdf",
    sha256: "2a9e63b038b6efc70ad846487f33fdda175993c2229c911c3e06291ec74a9dd5",
  },
  productionReady: false,
  transferCalibrationVerified: false,
} as const;
export type OvertimeSupport = {
  sourceKey: string;
  sourceSha256: string;
  games: TimedGame[];
};
export function researchOvertimeSupport(
  support: OvertimeSupport,
  targetSeason: number,
  now: string,
) {
  if (
    targetSeason !== 2026 ||
    !/^research:ncaaf:history-summary:2025:/.test(support?.sourceKey ?? "") ||
    !/^[a-f0-9]{64}$/.test(support?.sourceSha256 ?? "") ||
    !Number.isFinite(Date.parse(now))
  )
    throw Error("journal_invalid_overtime_transfer");
  const { games } = readFullGameReplayArchive({
    version: 1,
    games: support.games,
    forecasts: [],
    quotes: [],
  });
  if (
    !games.length ||
    games.some(
      (g) =>
        g.season !== 2025 ||
        g.ruleset !== "ncaa-football-season-2025-unverified" ||
        g.overtime !== true ||
        g.regulationHomePoints == null ||
        g.regulationAwayPoints == null ||
        Date.parse(g.observedAt) >= Date.parse(now),
    )
  )
    throw Error("journal_invalid_overtime_transfer");
  return games;
}

export function overtimeSupportFromArchive(
  sourceKey: string,
  value: { games: TimedGame[] },
): OvertimeSupport {
  if (!Array.isArray(value?.games))
    throw Error("journal_invalid_overtime_transfer");
  return {
    sourceKey,
    sourceSha256: createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex"),
    games: value.games.filter((g) => g.overtime === true),
  };
}
export function verifyOvertimeSupportArchive(
  support: OvertimeSupport,
  value: { games: TimedGame[] },
) {
  const expected = overtimeSupportFromArchive(support.sourceKey, value);
  if (JSON.stringify(support) !== JSON.stringify(expected))
    throw Error("journal_overtime_archive_mismatch");
}
