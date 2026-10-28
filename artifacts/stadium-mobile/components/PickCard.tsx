import { PlayerMatchupEvidence } from "@/components/PlayerMatchupEvidence";
import { sideOf } from "@/lib/pickCardModel";
import { norm, sameGame, parseEdgeStats, marketFamily, gameAltOptions, enrichPickMeta, gameSideFromPick, gameTotalFromPick, parsePicks, ALT_BACKFILL_ORDER, GENERIC_BACKFILL_ORDER, FULL_REACH_GAME_ORDER, PERIOD_BACKFILL_ORDER, backfillPicks, backfillProps } from "@/lib/pickCardModel";
export { norm, sameGame, parseEdgeStats, marketFamily, gameAltOptions, enrichPickMeta, gameSideFromPick, gameTotalFromPick, parsePicks, ALT_BACKFILL_ORDER, GENERIC_BACKFILL_ORDER, FULL_REACH_GAME_ORDER, PERIOD_BACKFILL_ORDER, backfillPicks, backfillProps } from "@/lib/pickCardModel";
import type { AltRungOption, SimAltTierLabel, SimAltLine, ParsedPick, AltRungBias } from "@/lib/pickCardModel";
export type { AltRungOption, SimAltTierLabel, SimAltLine, ParsedPick, AltRungBias } from "@/lib/pickCardModel";
import { totalSelection } from "@/lib/totalBreakdown";
import Feather from "@expo/vector-icons/Feather";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBetSlip } from "@/context/BetSlipContext";
import { deriveConfidenceScore } from "@/lib/confidence";
import {
  chooseMlCushionTwoBand,
  ML_CUSHION_MIN_PTS,
  ML_CUSHION_MAX_PTS,
} from "@/lib/mlCushion";
import { formatAmerican, formatGameTime } from "@/lib/format";
import { confidenceTierLabel } from "@/lib/finalAiScore";
import { marketSupportsSimulation, pickHasSimGrade } from "@/lib/simMarketSupport";
import { altLadderSimulationCaption } from "@/lib/coachPropProbabilityProvenance";
import { buildCoachCardHolistic } from "@/lib/propHolisticRecommendation";
import type { GameMeta, PropPoolEntry } from "@/lib/api";
import {
  normalizeCombinedPickScore,
  scoreLineValue,
  type CombinedPickScore,
} from "@/lib/pickScore";
import { rankPropPoolEntries, type PropSelectionOpts } from "@/lib/propSelection";
import { FILLER_BACKFILL_EDGE_NOTE } from "@/lib/coachScanPolicy";
import { shuffleWithSeed, varietyRankKey } from "@/lib/varietySeed";
import { deprioritizePropPoolEntries, parlayLegKeyFromPool } from "@/lib/parlayVarietyMemory";
import { pickShowsAltBadge } from "@/lib/altLinePool";
import { gameLabelsMatch } from "@/lib/gameLineOptimizer";
import { gameLineLegBucket, canonicalGameKey, normalizedGamePickKey } from "@/lib/gameSimScoring";
import { propCommitSide, propIdentityKey } from "@/lib/propSideConsistency";
import { humanizeOddsApiMarketKey } from "@/lib/postedMarketDiscovery";
import { compactPickLineLabel, parsePickLineNumber } from "@/lib/pickLineParse";
import {
  NOT_AI_RECOMMENDED,
  pickGradeDisplayCaption,
  pickGradeDisplayLabel,
} from "@/lib/pickRecommendation";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { LockedAiMetricsTeaser, useAiMetricsLocked } from "@/components/LockedAiMetrics";
import { FONT } from "@/components/ui";
import { SLIP_UI_ENABLED } from "@/lib/slipUi";
import {
  COACH_PREMIUM_FEATURE_LABEL,
  PREMIUM_VALUE_MASK,
  publicCoachPickSummary,
  lockedCoachGradeLabel,
} from "@/lib/coachPremiumGate";
import { useSubscriptionOptional } from "@/context/SubscriptionContext";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// The main pick and its alternate rungs (cushion / value) are the SAME bet at
// different lines — alternatives, not independent legs. Selecting any one must
// clear the others so a single card only ever contributes ONE leg to the slip.
// Returns the slip legKeys for this card's OTHER options (everything but the one
// being kept), so the caller can removeLeg() them before adding the chosen line.
// Every slip-able line on a card: the main pick plus its Safe/Value rungs. Each
// carries its OWN market label (a rung may differ from the main, e.g. "Alt
// Spread" vs "Spread") so leg keys match what addLeg() actually stored.
function cardLegs(parent: ParsedPick): { market: string; pick: string }[] {
  const legs: { market: string; pick: string }[] = [
    { market: parent.market, pick: parent.pick },
  ];
  const c = parent.altOptions?.cushion;
  const v = parent.altOptions?.value;
  const hc = parent.altOptions?.highConfidence;
  if (c) legs.push({ market: c.market ?? parent.market, pick: c.pick });
  if (v) legs.push({ market: v.market ?? parent.market, pick: v.pick });
  if (hc) legs.push({ market: hc.market ?? parent.market, pick: hc.pick });
  for (const alt of parent.simAltLines ?? []) {
    legs.push({ market: alt.market ?? parent.market, pick: alt.pick });
  }
  return legs;
}

function siblingLegKeys(parent: ParsedPick, keepPick: string): string[] {
  return cardLegs(parent)
    .filter((l) => l.pick !== keepPick)
    .map((l) => `${parent.game}|${l.market}|${l.pick}`.toLowerCase());
}

// A short line label for a tier chip: Over/Under + number for a total/prop
// ("O 5.5"), or the signed handicap for a spread ("-3.5"). Moneyline and yes/no
// markets carry no number, so they return null and the chip shows odds only.
// Trailing-number parse — never the "49" in "49ers" (phone BEST LINE "+49" bug).
function compactLine(pick: string): string | null {
  return compactPickLineLabel(pick, sideOf(pick));
}

// Decorative market icon for the card's market pill. Purely visual — never
// asserts any data — so a missing mapping just falls back to a neutral glyph.
function marketIcon(pick: ParsedPick): keyof typeof Feather.glyphMap {
  if (pick.isProp) return "user";
  const m = (pick.market || "").toLowerCase();
  if (m.includes("total") || m.includes("over") || m.includes("under")) return "bar-chart-2";
  if (m.includes("moneyline") || m.includes("ml")) return "dollar-sign";
  return "flag";
}

// In tennis a "spread" is a GAMES handicap (e.g. -4.5 games), not a points
// spread — so the card badge should read "Game Handicap". This is a DISPLAY-ONLY
// relabel: the underlying `market` value is never changed, so slip leg keys,
// dedupe, and AI-pick resolution all keep using the real "Spread" / "Alt Spread"
// market name. Also humanizes leaked Odds API keys ("spreads_q2" → "Q2 Spread").
function marketDisplayLabel(market: string, sport?: string): string {
  const human = humanizeOddsApiMarketKey(market);
  if (sport === "tennis") {
    if (/^spread$/i.test(human)) return "Game Handicap";
    if (/^alt spread$/i.test(human)) return "Alt Game Handicap";
  }
  return human || market;
}

// "Away @ Home" with the away side in blue and the home side in red so the
// fixture reads at a glance. Falls back to a plain muted line when the label
// isn't a clean two-team matchup (e.g. a futures or oddly-formatted game).
function MatchupLine({ game }: { game: string }) {
  const colors = useColors();
  const parts = game.split(/\s+@\s+/);
  if (parts.length !== 2) {
    return (
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
        {game}
      </Text>
    );
  }
  return (
    <Text style={{ fontFamily: FONT.semibold, fontSize: 13 }}>
      <Text style={{ color: colors.primary }}>{parts[0]}</Text>
      <Text style={{ color: colors.mutedForeground }}> @ </Text>
      <Text style={{ color: colors.destructive }}>{parts[1]}</Text>
    </Text>
  );
}

// One tappable tier in the SAFE / BEST / VALUE ladder. BEST is the model's
// recommended line; SAFE (cushion) and VALUE are the nearest REAL alternate
// rungs. Each tier adds/removes its EXACT line as the card's single slip leg —
// selecting one clears the siblings (one leg per card). The line + odds are the
// REAL posted numbers, never invented.
function LineTierChip({
  tone,
  label,
  game,
  market,
  pick,
  odds,
  sport,
  lineLabel,
  parent,
  simMetrics,
}: {
  tone: "safe" | "best" | "value" | "confidence" | "overall" | "risk";
  label: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  lineLabel: string | null;
  parent: ParsedPick;
  simMetrics?: AltRungOption["simMetrics"];
}) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const added = hasLeg(game, market, pick);
  const isBest = tone === "best";
  const onPress = () => {
    if (added) {
      removeLeg(`${game}|${market}|${pick}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      // Mutually exclusive with the other tiers — selecting this line clears any
      // sibling line already on the slip (one leg per card).
      for (const k of siblingLegKeys(parent, pick)) removeLeg(k);
      const ok = addLeg({ game, market, pick, odds, sport });
      Haptics.impactAsync(
        ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    }
  };
  const icon =
    tone === "safe"
      ? "shield"
      : tone === "value"
        ? "trending-up"
        : tone === "risk"
          ? "zap"
          : tone === "confidence"
            ? "target"
            : tone === "overall"
              ? "star"
              : "star";
  const fg = added ? colors.primaryForeground : undefined;
  // BEST reads as the emphasized tier (primary outline) even before it's added.
  const idleBorder = isBest ? colors.primary : colors.border;
  const idleAccent = isBest ? colors.primary : colors.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flex: 1,
        gap: 4,
        paddingVertical: 8,
        paddingHorizontal: 9,
        borderRadius: 11,
        backgroundColor: added ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: added ? colors.primary : idleBorder,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Feather name={added ? "check" : (icon as never)} size={11} color={fg ?? idleAccent} />
        <Text
          style={{
            color: fg ?? (isBest ? colors.foreground : colors.mutedForeground),
            fontFamily: FONT.bold,
            fontSize: 11,
          }}
        >
          {label}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}>
        {lineLabel ? (
          <Text style={{ color: fg ?? colors.foreground, fontFamily: FONT.bold, fontSize: 14 }}>
            {lineLabel}
          </Text>
        ) : null}
        <Text style={{ color: fg ?? colors.accent, fontFamily: FONT.bold, fontSize: 12 }}>
          {formatAmerican(odds)}
        </Text>
      </View>
      {simMetrics ? (
        <Text style={{ color: fg ?? colors.mutedForeground, fontFamily: FONT.body, fontSize: 9, lineHeight: 12 }}>
          {Math.round(simMetrics.winProb * 100)}% win · {simMetrics.confidencePct}% conf ·{" "}
          {simMetrics.edgePct >= 0 ? "+" : ""}
          {simMetrics.edgePct.toFixed(1)}% edge · {simMetrics.evPct >= 0 ? "+" : ""}
          {simMetrics.evPct.toFixed(1)}% EV
        </Text>
      ) : null}
    </Pressable>
  );
}

function simAltTone(label: SimAltTierLabel): "safe" | "best" | "value" | "confidence" | "overall" | "risk" {
  if (label === "Safest") return "safe";
  if (label === "Best Value") return "value";
  if (label === "High Risk") return "risk";
  if (label === "Best") return "best";
  return "overall";
}

// Line ladder: heuristic Safe/Best/Value before sim; provenance-aware ALT caption.
function LineLadder({ pick, locked }: { pick: ParsedPick; locked?: boolean }) {
  const colors = useColors();
  const sub = useSubscriptionOptional();
  const simAlts = pick.simAltLines ?? [];
  const altCaption = altLadderSimulationCaption({
    parent: pick,
    alts: simAlts.map((alt) => ({
      propLine: alt.line,
      line: alt.line,
      propSide: alt.side,
      side: alt.side,
      propProbabilityProvenance: (alt as {
        propProbabilityProvenance?: ParsedPick["propProbabilityProvenance"];
      }).propProbabilityProvenance,
    })),
  });

  if (locked) {
    return (
      <Pressable
        onPress={() => sub?.openSoftPaywall(COACH_PREMIUM_FEATURE_LABEL)}
        accessibilityRole="button"
        accessibilityLabel="Unlock AI Picks"
        style={{
          gap: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 12,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather name="lock" size={12} color={colors.mutedForeground} />
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.bold,
              fontSize: 11,
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            Lines & odds locked
          </Text>
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
          {PREMIUM_VALUE_MASK} · Unlock AI Picks to see recommended lines
        </Text>
      </Pressable>
    );
  }

  if (simAlts.length > 0) {
    return (
      <View style={{ gap: 5 }}>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.bold,
            fontSize: 9,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          {altCaption}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "stretch" }}>
          {simAlts.map((alt) => (
            <LineTierChip
              key={`${alt.tierLabel}|${alt.pick}|${alt.odds}`}
              tone={simAltTone(alt.tierLabel)}
              label={alt.tierLabel}
              game={pick.game}
              market={alt.market ?? pick.market}
              pick={alt.pick}
              odds={alt.odds}
              sport={pick.sport}
              lineLabel={compactLine(alt.pick)}
              parent={pick}
              simMetrics={alt.simMetrics}
            />
          ))}
        </View>
      </View>
    );
  }

  const cushion = pick.altOptions?.cushion;
  const value = pick.altOptions?.value;
  const highConfidence = pick.altOptions?.highConfidence;
  const hasAlts = !!(cushion || value || highConfidence);
  return (
    <View style={{ gap: 5 }}>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.bold,
          fontSize: 9,
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {hasAlts ? "Safe · Best · Value" : "Best line"}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "stretch" }}>
        {cushion ? (
          <LineTierChip
            tone="safe"
            label="Safe"
            game={pick.game}
            market={cushion.market ?? pick.market}
            pick={cushion.pick}
            odds={cushion.odds}
            sport={pick.sport}
            lineLabel={compactLine(cushion.pick)}
            parent={pick}
          />
        ) : null}
        <LineTierChip
          tone="best"
          label="Best"
          game={pick.game}
          market={pick.market}
          pick={pick.pick}
          odds={pick.odds}
          sport={pick.sport}
          lineLabel={compactLine(pick.pick)}
          parent={pick}
        />
        {value ? (
          <LineTierChip
            tone="value"
            label="Value"
            game={pick.game}
            market={value.market ?? pick.market}
            pick={value.pick}
            odds={value.odds}
            sport={pick.sport}
            lineLabel={compactLine(value.pick)}
            parent={pick}
          />
        ) : null}
        {highConfidence ? (
          <LineTierChip
            tone="confidence"
            label="High Conf"
            game={pick.game}
            market={highConfidence.market ?? pick.market}
            pick={highConfidence.pick}
            odds={highConfidence.odds}
            sport={pick.sport}
            lineLabel={compactLine(highConfidence.pick)}
            parent={pick}
          />
        ) : null}
      </View>
    </View>
  );
}

// Pull the model's projected win/hit %, the price's implied %, and the edge gap
// out of the EDGE note prose. The chat prompt mandates a parseable shape
// ("... -110 implies ~52%, I project this OVER ~66% -> +14% edge"), so these
// regexes read the REAL numbers the model stated — they NEVER invent one. When
// the note carries no projection (an honest market-price leg with no data
// backing), everything comes back null and the card says so plainly.
function deriveGrade(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 9.0) return "A+";
  if (score >= 8.5) return "A";
  if (score >= 8.0) return "A-";
  if (score >= 7.5) return "B+";
  if (score >= 7.0) return "B";
  if (score >= 6.5) return "B-";
  if (score >= 6.0) return "C+";
  if (score >= 5.5) return "C";
  if (score >= 5.0) return "C-";
  if (score >= 4.0) return "D";
  return "F";
}

// Short plain-English captions under each metric — all derived from the SAME real
// signals (score = scaled edge; gap = the model's stated edge), never new data.
function gradeBlurb(score: number): string {
  if (score >= 8) return "Strong Value";
  if (score >= 6.5) return "Solid Value";
  if (score >= 5) return "Fair Value";
  return "Thin Value";
}
function edgeBlurb(gap: number): string {
  if (gap > 0) return "Positive Edge";
  if (gap < 0) return "Negative Edge";
  return "Even Edge";
}
function confidenceBlurb(score: number, odds?: number | null): string {
  return confidenceTierLabel({
    confidencePct: Math.round(score * 10),
    composite: score,
    odds,
  });
}

// Always-visible readout of the projected edge for a leg. Shows the model's
// projected win/hit %, the book's implied %, the gap between them, plus plain
// Confidence + Variance descriptors. When the model had no data to project (no
// game log etc.), it honestly reads "Market price" instead of manufacturing a
// number — but Variance (a property of the bet itself) still shows.
export function EdgeReadout({
  edge,
  odds,
  isProp,
  grid,
}: {
  edge?: string;
  odds?: number;
  isProp?: boolean;
  // Chat pick cards opt into the richer bordered stat grid; the slip + game-detail
  // surfaces leave this off and keep the original compact pill row.
  grid?: boolean;
}) {
  const colors = useColors();
  const { edge: gap } = parseEdgeStats(edge);
  // Grade rates VALUE (the edge-based line-value score); Confidence is the leg's
  // de-vigged WIN CHANCE (implied price + edge). The two are decoupled, so a
  // strong-value coin flip reads a high grade but a ~50% confidence. Confidence
  // is null when there's no real price to de-vig (it reads "—").
  const valueScore = scoreLineValue(gap);
  const grade = deriveGrade(valueScore);
  const confScore = deriveConfidenceScore(gap, odds);
  const edgeText = gap === null ? null : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`;
  const gapColor =
    gap === null ? colors.mutedForeground : gap >= 0 ? colors.success : colors.destructive;
  const gradeColor =
    valueScore === null
      ? colors.mutedForeground
      : valueScore >= 7
        ? colors.success
        : valueScore >= 5.5
          ? colors.primary
          : colors.mutedForeground;

  // CHAT (grid) layout: one bordered metric cell per signal — a small icon + an
  // uppercase label over its value. Every value is a REAL parsed number (or the
  // derived descriptor); cells with no backing data are simply not rendered.
  if (grid) {
    // One stat tile: icon + uppercase label on top, a large value, and a short
    // plain-English caption underneath. `suffix` renders muted/small after the
    // value (e.g. the "/10" on Confidence).
    const cell = (
      icon: keyof typeof Feather.glyphMap,
      label: string,
      value: string,
      valueColor: string,
      caption: string,
      suffix?: string,
    ) => (
      <View
        key={label}
        style={{
          flex: 1,
          minWidth: 96,
          paddingVertical: 12,
          paddingHorizontal: 11,
          borderRadius: 14,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Feather name={icon} size={12} color={valueColor} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{
              flexShrink: 1,
              color: colors.mutedForeground,
              fontFamily: FONT.medium,
              fontSize: 9.5,
              letterSpacing: 0.3,
              textTransform: "uppercase",
            }}
          >
            {label}
          </Text>
        </View>
        <Text style={{ color: valueColor, fontFamily: FONT.bold, fontSize: 26, marginTop: 8 }}>
          {value}
          {suffix ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 14 }}>
              {suffix}
            </Text>
          ) : null}
        </Text>
        <Text
          style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10.5, marginTop: 4 }}
        >
          {caption}
        </Text>
      </View>
    );
    if (gap === null) return null;
    const vs = valueScore ?? 0;
    return (
      <View style={{ flexDirection: "row", gap: 8 }}>
        {cell("award", "AI Grade", grade ?? "—", gradeColor, gradeBlurb(vs))}
        {cell("trending-up", "Edge", edgeText ?? "—", gapColor, edgeBlurb(gap))}
        {cell(
          "target",
          "Confidence",
          confScore === null ? "—" : String(Math.round(confScore * 10)),
          colors.primary,
          confScore === null ? "Win chance" : confidenceBlurb(confScore, odds),
          confScore === null ? undefined : "%",
        )}
      </View>
    );
  }

  // DEFAULT (pill) layout: compact rounded chips, used on the slip + game-detail
  // surfaces so only the chat cards get the richer grid.
  const chip = (label: string, fg: string, border: string) => (
    <View
      key={label}
      style={{
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text style={{ color: fg, fontFamily: FONT.bold, fontSize: 11 }}>{label}</Text>
    </View>
  );
  if (gap === null) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {chip(`AI Grade: ${grade ?? "—"}`, gradeColor, gradeColor)}
      {chip(`Edge: ${edgeText ?? "—"}`, gapColor, gapColor)}
      {chip(
        `Confidence: ${confScore === null ? "—" : `${Math.round(confScore * 10)}%`}`,
        colors.primary,
        colors.border,
      )}
    </View>
  );
}

export function PickCard({
  pick,
  onPress,
  hideReadout,
  badge,
  /** Coach cards: also blur pick side/line/odds (not just AI metrics). */
  lockPickDetails,
  /**
   * Automatic N-leg Coach tickets pass false — Add-to-slip is not a ticket
   * fallback. Individual recommendation mode may pass true when slip UI is on.
   */
  allowSlipActions = true,
  freeCoachPreview = false,
}: {
  pick: ParsedPick;
  // When set, the card's header/info area becomes tappable (e.g. to open the
  // prop detail page). Inner controls (line ladder, AI-edge pill, add button)
  // keep their own taps — RN gives the touched child the responder.
  onPress?: () => void;
  // Hide the AI Edge / market-price readout tile (used on the Props tab, where
  // the full breakdown lives on the detail page instead).
  hideReadout?: boolean;
  // Optional ranking badge shown at the very top of the card. `tone` picks the
  // accent: "grade" for a real hit-rate letter grade, "upset" for a model-lean
  // underdog. The caption states what the badge MEANS in plain English so it
  // never reads as a fabricated rating.
  badge?: { text: string; caption?: string; tone: "grade" | "upset" | "value" } | null;
  lockPickDetails?: boolean;
  allowSlipActions?: boolean;
  /** Exactly-two-leg Coach preview; suppress contradictory reveal CTA only. */
  freeCoachPreview?: boolean;
}) {
  const colors = useColors();
  const sub = useSubscriptionOptional();
  const metricsLocked = useAiMetricsLocked();
  const premiumLocked = !!lockPickDetails && metricsLocked;
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const added = hasLeg(pick.game, pick.market, pick.pick);
  const [edgeOpen, setEdgeOpen] = useState(false);
  const publicSummary = publicCoachPickSummary(pick);
  const altPickBadge = {
    text: "ALT PICK",
    caption: premiumLocked
      ? "Alternate line — unlock to view"
      : "Alternate rung — positive EV, edge, and sim grade",
    tone: "grade" as const,
  };
  const liveMeta = pick.liveCoach;
  const livePickBadge = liveMeta
    ? {
        text: "LIVE",
        caption: premiumLocked
          ? `${liveMeta.score} · ${liveMeta.periodLabel ?? (liveMeta.period != null ? `Q${liveMeta.period}` : "")}${liveMeta.clock ? ` ${liveMeta.clock}` : ""}`.replace(/\s+/g, " ").trim()
          : `${liveMeta.score} · ${liveMeta.periodLabel ?? (liveMeta.period != null ? `Q${liveMeta.period}` : "")}${liveMeta.clock ? ` ${liveMeta.clock}` : ""} · edge ${liveMeta.edgePct > 0 ? "+" : ""}${liveMeta.edgePct.toFixed(1)}% · ${liveMeta.ageMs != null ? `${Math.round(liveMeta.ageMs / 1000)}s` : "age ?"}${liveMeta.freshness === "fresh" ? " fresh" : ""}`.replace(/\s+/g, " ").trim(),
        tone: "value" as const,
      }
    : null;
  const isAltLeg = pickShowsAltBadge(pick);
  const cardBadge = livePickBadge ?? (isAltLeg ? altPickBadge : badge);
  const headerPress = () => {
    if (premiumLocked) {
      sub?.openSoftPaywall(COACH_PREMIUM_FEATURE_LABEL);
      return;
    }
    onPress?.();
  };

  // Soccer ML/spread legs: tag the picked side as HOME or AWAY. Soccer uses the
  // FULL team name (multi-word national teams) on a 3-way line, so "Canada -0.5"
  // alone doesn't read as the home or away side at a glance. gameSideFromPick
  // resolves the REAL side from the pick's own "Away @ Home" label — it returns
  // null for totals, props, the Draw outcome, and any ambiguous label, so the
  // tag is never guessed. Tag color mirrors MatchupLine: away = blue (primary),
  // home = red (destructive).
  const soccerSide = pick.sport === "soccer" ? gameSideFromPick(pick) : null;
  const homeAwayTag = soccerSide
    ? {
        label: soccerSide.isHome ? "HOME" : "AWAY",
        color: soccerSide.isHome ? colors.destructive : colors.primary,
      }
    : null;

  // The AI edge note is collapsed behind a pill so cards stay compact; tapping
  // the pill animates the reasoning open/closed.
  const toggleEdge = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEdgeOpen((v) => !v);
  };

  // Tapping the button toggles the leg in/out of the slip: add when it's not
  // there, remove when it already is. The leg id matches BetSlipContext's
  // legKey(game, market, pick) so removeLeg targets the right entry.
  const onToggle = () => {
    if (added) {
      const id = `${pick.game}|${pick.market}|${pick.pick}`.toLowerCase();
      removeLeg(id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      // Selecting the main line clears any alternate rung (cushion/value) for the
      // same bet so a card only ever contributes ONE leg.
      for (const k of siblingLegKeys(pick, pick.pick)) removeLeg(k);
      const ok = addLeg(pick);
      Haptics.impactAsync(
        ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: added ? colors.primary : colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 12,
        gap: 8,
      }}
    >
      {cardBadge ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{
              paddingVertical: 3,
              paddingHorizontal: 8,
              borderRadius: 999,
              backgroundColor:
                cardBadge.tone === "grade"
                  ? colors.success
                  : cardBadge.tone === "value"
                    ? colors.primary
                    : colors.accent,
            }}
          >
            <Text
              style={{
                color: colors.background,
                fontFamily: FONT.bold,
                fontSize: 11,
                letterSpacing: 0.4,
              }}
            >
              {cardBadge.text}
            </Text>
          </View>
          {cardBadge.caption ? (
            <Text
              style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, flex: 1 }}
              numberOfLines={1}
            >
              {cardBadge.caption}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onPress={premiumLocked || onPress ? headerPress : undefined}
        disabled={!premiumLocked && !onPress}
        accessibilityRole={premiumLocked || onPress ? "button" : undefined}
        accessibilityLabel={
          premiumLocked
            ? `${publicSummary.title}. ${COACH_PREMIUM_FEATURE_LABEL}`
            : undefined
        }
        style={({ pressed }) => ({
          gap: 8,
          opacity: pressed && (premiumLocked || onPress) ? 0.7 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingVertical: 4,
              paddingHorizontal: 9,
              borderRadius: 999,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Feather name={marketIcon(pick)} size={12} color={colors.accent} />
            <Text
              style={{
                color: colors.accent,
                fontFamily: FONT.bold,
                fontSize: 11,
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              {marketDisplayLabel(pick.market, pick.sport)}
            </Text>
          </View>
          <Text
            style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 22 }}
            accessibilityElementsHidden={premiumLocked}
            importantForAccessibility={premiumLocked ? "no" : "auto"}
          >
            {premiumLocked ? PREMIUM_VALUE_MASK : formatAmerican(pick.odds)}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 18, lineHeight: 23 }}>
            {premiumLocked ? `${publicSummary.title} · ${PREMIUM_VALUE_MASK}` : pick.pick}
          </Text>
          {!premiumLocked && homeAwayTag ? (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: homeAwayTag.color,
              }}
            >
              <Text
                style={{
                  color: homeAwayTag.color,
                  fontFamily: FONT.bold,
                  fontSize: 10,
                  letterSpacing: 0.5,
                }}
              >
                {homeAwayTag.label}
              </Text>
            </View>
          ) : null}
        </View>
        {premiumLocked ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 13 }}>
            {PREMIUM_VALUE_MASK} @ {PREMIUM_VALUE_MASK}
          </Text>
        ) : (
          <MatchupLine game={pick.game} />
        )}
        {liveMeta ? (
          <View style={{ gap: 2, marginTop: -2 }}>
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 12 }}>
              {premiumLocked
                ? `LIVE · ${PREMIUM_VALUE_MASK}`
                : `LIVE · ${liveMeta.score}${
                    liveMeta.periodLabel || liveMeta.period != null
                      ? ` · ${liveMeta.periodLabel ?? `Q${liveMeta.period}`}`
                      : ""
                  }${liveMeta.clock ? ` ${liveMeta.clock}` : ""}`}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {premiumLocked
                ? `${marketDisplayLabel(pick.market, pick.sport)} · ${PREMIUM_VALUE_MASK}`
                : `${pick.market}${liveMeta.line != null ? ` ${liveMeta.line}` : ""} · ${formatAmerican(liveMeta.price)} · ${liveMeta.ageMs != null ? `${Math.round(liveMeta.ageMs / 1000)}s` : "age ?"} (${liveMeta.freshness}) · edge ${liveMeta.edgePct > 0 ? "+" : ""}${liveMeta.edgePct.toFixed(1)}% · conf ${liveMeta.confidencePct}%`}
            </Text>
          </View>
        ) : premiumLocked ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: -3 }}>
            <Feather name="clock" size={11} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {PREMIUM_VALUE_MASK}
            </Text>
          </View>
        ) : formatGameTime(pick.startsAt) ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: -3 }}>
            <Feather name="clock" size={11} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {formatGameTime(pick.startsAt)}
            </Text>
          </View>
        ) : null}
        {premiumLocked ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
            <Feather name="lock" size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 11 }}>
              Sign In / Subscribe to Reveal Picks
            </Text>
            <Feather name="chevron-right" size={13} color={colors.primary} />
          </View>
        ) : onPress ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
            <Feather name="bar-chart-2" size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: FONT.bold, fontSize: 11 }}>
              View AI breakdown
            </Text>
            <Feather name="chevron-right" size={13} color={colors.primary} />
          </View>
        ) : null}
      </Pressable>

      <View style={{ height: 1, backgroundColor: colors.border, marginTop: 1 }} />

      {!premiumLocked && !hideReadout && pick.isProp && pick.sport && pick.propMarketKey &&
        pick.propLine != null && Number.isFinite(pick.propLine) &&
        (pick.propSide === "Over" || pick.propSide === "Under") && (
        <PlayerMatchupEvidence key={`${pick.athleteId}:${pick.propMarketKey}:${pick.propLine}:${pick.propSide}`}
          sport={pick.sport} athleteId={pick.athleteId} playerTeamId={pick.playerTeamId}
          game={pick.game} startsAt={pick.startsAt} market={pick.propMarketKey}
          line={pick.propLine} side={pick.propSide} />
      )}
      <LineLadder pick={pick} locked={premiumLocked} />

      {hideReadout ? null : pick.scores ||
        pick.finalAiScore?.rubric ||
        pick.finalAiScore?.grade ||
        pick.finalAiScore?.confidencePct != null ||
        pick.finalAiScore?.edgePct != null ||
        ((pick.isProp || pick.player) &&
          (pick.finalAiScore?.simHit != null || pick.finalAiScore?.propHolistic)) ? (
        <ScoreBreakdown
          data={
            normalizeCombinedPickScore({
              ...(pick.finalAiScore?.rubric ?? pick.scores ?? {}),
              composite: pick.finalAiScore?.composite ?? pick.scores?.composite ?? null,
              grade: pick.finalAiScore?.grade ?? pick.scores?.grade ?? null,
              confidencePct:
                pick.finalAiScore?.confidencePct ?? pick.scores?.confidencePct ?? null,
              edgePct: pick.finalAiScore?.edgePct ?? pick.scores?.edgePct ?? null,
            }) ?? {
              scores: {
                matchup: null,
                trend: null,
                lineValue: null,
                injury: null,
                lineShopping: null,
                simulation: null,
              },
              composite: pick.finalAiScore?.composite ?? null,
              grade: pick.finalAiScore?.grade ?? null,
              confidencePct: pick.finalAiScore?.confidencePct ?? null,
              edgePct: pick.finalAiScore?.edgePct ?? null,
            }
          }
          variant="compact"
          hideLockedTeaser={!premiumLocked}
          pick={premiumLocked ? undefined : pick}
          propHolistic={
            premiumLocked
              ? undefined
              : pick.isProp || pick.player
                ? buildCoachCardHolistic(pick)
                : undefined
          }
          simulationPending={pick.simulationPending}
          simGradePending={
            !premiumLocked &&
            marketSupportsSimulation(pick.market ?? "", pick) &&
            !pickHasSimGrade(pick, pick.finalAiScore?.simHit ?? null)
          }
          gradeLabel={
            premiumLocked
              ? lockedCoachGradeLabel(pick)
              : marketSupportsSimulation(pick.market ?? "", pick)
              ? pickHasSimGrade(pick, pick.finalAiScore?.simHit ?? null)
                ? (pickGradeDisplayLabel(pick, pick.finalAiScore) ?? NOT_AI_RECOMMENDED)
                : undefined
              : undefined
          }
          gradeCaption={
            premiumLocked
              ? undefined
              : marketSupportsSimulation(pick.market ?? "", pick) &&
                  !pickHasSimGrade(pick, pick.finalAiScore?.simHit ?? null)
                ? undefined
                : pickGradeDisplayCaption(pick, pick.finalAiScore)
          }
        />
      ) : premiumLocked ? (
        <LockedAiMetricsTeaser dense />
      ) : (
        <EdgeReadout edge={pick.edge} odds={pick.odds} isProp={pick.isProp} grid />
      )}

      {pick.edge && !premiumLocked ? (
        <View>
          <Pressable
            onPress={toggleEdge}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              alignSelf: "flex-start",
              gap: 5,
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: edgeOpen ? colors.primary : colors.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Feather name="zap" size={12} color={colors.accent} />
            <Text
              style={{
                color: edgeOpen ? colors.foreground : colors.mutedForeground,
                fontFamily: FONT.bold,
                fontSize: 11,
              }}
            >
              AI Edge
            </Text>
            <Feather
              name={edgeOpen ? "chevron-up" : "chevron-down"}
              size={13}
              color={colors.mutedForeground}
            />
          </Pressable>

          {edgeOpen ? (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FONT.body,
                fontSize: 12,
                lineHeight: 17,
                marginTop: 8,
              }}
            >
              {pick.edge}
            </Text>
          ) : null}
        </View>
      ) : null}

      {SLIP_UI_ENABLED && allowSlipActions ? (
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          marginTop: 2,
          paddingVertical: 10,
          borderRadius: 10,
          backgroundColor: added ? colors.card : colors.primary,
          borderWidth: added ? 1 : 0,
          borderColor: colors.border,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Feather
          name={added ? "x" : "plus"}
          size={15}
          color={added ? colors.mutedForeground : colors.primaryForeground}
        />
        <Text
          style={{
            color: added ? colors.mutedForeground : colors.primaryForeground,
            fontFamily: FONT.bold,
            fontSize: 13,
          }}
        >
          {added ? "Added — tap to remove" : "Add to slip"}
        </Text>
      </Pressable>
      ) : null}
    </View>
  );
}

// Parse PICK / EDGE / ALT lines out of an assistant reply and resolve each one
// back to a REAL odds entry we actually sent as context. The slip can therefore
// only ever contain real fixtures, markets, and prices — fail-closed:
//   - empty real-odds pool (feed outage)  -> no add-to-slip cards
//   - game not in the pool                -> dropped
//   - selection that matches no real line -> dropped
//   - the odds value is taken from the REAL entry, never from the AI text
