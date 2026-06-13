import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBetSlip } from "@/context/BetSlipContext";
import { deriveConfidenceScore, deriveVariance } from "@/lib/confidence";
import {
  chooseMlCushionTiers,
  ML_CUSHION_MIN_PTS,
  ML_CUSHION_MAX_PTS,
} from "@/lib/mlCushion";
import { formatAmerican, formatGameTime } from "@/lib/format";
import type { GameMeta, PropPoolEntry } from "@/lib/api";
import type { CombinedPickScore } from "@/lib/pickScore";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { FONT } from "@/components/ui";

export type ParsedPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  edge?: string;
  sport?: string;
  isProp?: boolean;
  // Real ESPN scheduled kickoff/tipoff (ISO). Render-only — shown as a local
  // date + time on the card so each leg names when its game starts.
  startsAt?: string | null;
  // Render-only (real ESPN data). headshot = player photo for prop legs;
  // teamLogo/teamAbbr = the picked team for game-level legs.
  headshot?: string | null;
  teamLogo?: string | null;
  teamAbbr?: string | null;
  // Game totals name no single team, so they carry BOTH teams' real logos/codes
  // for a matchup-style avatar + subtitle ("NYM @ SEA · TOTAL").
  awayLogo?: string | null;
  homeLogo?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  // Real alternate rungs for a prop leg (same player+market+side, REAL posted
  // lines + odds from the pool — never invented). cushion = the nearest SAFER
  // rung (more juice), value = the nearest HIGHER-PAYOUT rung. Tappable: each
  // chip adds/removes that exact rung as its own slip leg. `pick` is the full
  // slip pick-string for the rung (same format as the main leg, line swapped).
  // `market` lets a rung carry its OWN market label (e.g. a game leg's "Best" is
  // a "Spread" while its "Safe" rung is an "Alt Spread") so the slip leg key and
  // dedupe stay correct. Omitted for prop rungs, which share the parent's market.
  altOptions?: {
    cushion?: { side: string; line: number; odds: number; pick: string; market?: string };
    value?: { side: string; line: number; odds: number; pick: string; market?: string };
  };
  // Render-only prop metadata used to open the prop detail page. Carried on
  // AI-recommended prop cards so a tap can fetch the player's REAL game log and
  // show the line/side. Never affects the slip leg key (game/market/pick do).
  athleteId?: string | null;
  player?: string;
  propMarketKey?: string; // raw Odds API market key, e.g. "player_points"
  propLine?: number | null;
  propSide?: string; // "Over" | "Under" | "Yes"
  // The 5-component pick rubric (Matchup / Trend / Line Value / Injury /
  // Line-Shopping) rolled into AI Grade + Confidence + Edge. Attached at resolve
  // time ONLY when real scoring inputs are available (see lib/pickScoreContext);
  // every sub-score is nullable and the compact breakdown is shown in place of
  // the prose-derived EdgeReadout when present. Omitted entirely when no signal
  // grounds — the card then falls back to the existing readout. Never fabricated.
  scores?: CombinedPickScore | null;
};

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
  if (c) legs.push({ market: c.market ?? parent.market, pick: c.pick });
  if (v) legs.push({ market: v.market ?? parent.market, pick: v.pick });
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
function compactLine(pick: string): string | null {
  const n = norm(pick);
  const side = sideOf(pick);
  const m = n.match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  if (side) return `${side === "Over" ? "O" : "U"} ${m[0].replace(/^\+/, "")}`;
  const v = m[0];
  if (v.startsWith("+") || v.startsWith("-")) return v;
  return parseFloat(v) > 0 ? `+${v}` : v;
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
// market name.
function marketDisplayLabel(market: string, sport?: string): string {
  if (sport === "tennis") {
    if (/^spread$/i.test(market)) return "Game Handicap";
    if (/^alt spread$/i.test(market)) return "Alt Game Handicap";
  }
  return market;
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
}: {
  tone: "safe" | "best" | "value";
  label: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  sport?: string;
  lineLabel: string | null;
  parent: ParsedPick;
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
  const icon = tone === "safe" ? "shield" : tone === "value" ? "trending-up" : "star";
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
    </Pressable>
  );
}

// The SAFE / BEST / VALUE line ladder shown on every pick card. BEST is the
// model's recommended line (always present). SAFE (cushion) and VALUE
// (higher-payout) are the nearest REAL alternate rungs from the same ladder when
// the book posts them — moneyline and yes/no props have no alternate line, so
// those cards honestly show BEST only. Every tier is tappable + mutually
// exclusive.
function LineLadder({ pick }: { pick: ParsedPick }) {
  const colors = useColors();
  const cushion = pick.altOptions?.cushion;
  const value = pick.altOptions?.value;
  const hasAlts = !!(cushion || value);
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
      <View style={{ flexDirection: "row", gap: 6, alignItems: "stretch" }}>
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
export function parseEdgeStats(edge?: string): {
  projected: number | null;
  implied: number | null;
  edge: number | null;
} {
  const empty = { projected: null, implied: null, edge: null };
  if (!edge) return empty;
  const s = edge.replace(/[−–—]/g, "-");
  // Preserve the model's stated decimal precision — rounding happens only at
  // display time (toFixed). Rounding here would distort a subtraction-derived
  // edge (66.1% vs 52.4% must stay +13.7, not +14).
  const pct = (m: RegExpMatchArray | null): number | null => {
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  };
  // The gap between the projection word and its percent must NOT cross a sign
  // ([+-]) or another digit — otherwise "Model edge is +14% edge" would skip to
  // the "+14" and mislabel an EDGE number as a projected win rate.
  const projected = pct(
    s.match(
      /\b(?:i\s+project|project(?:ed)?(?:\s+this)?|model|puts(?:\s+this)?|lean)\b[^%\d+\-]{0,24}?(\d{1,3}(?:\.\d+)?)\s*%/i,
    ),
  );
  const implied = pct(s.match(/\bimplies?\b[^%\d+\-]{0,16}?(\d{1,3}(?:\.\d+)?)\s*%/i));
  let edgeGap: number | null = null;
  const em = s.match(/([+-])\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*edge\b/i);
  if (em) {
    const n = parseFloat(em[2]);
    if (Number.isFinite(n)) edgeGap = em[1] === "-" ? -n : n;
  }
  // No explicit "+N% edge" token but both percentages are present → derive the
  // gap by subtraction. This is pure arithmetic on the model's OWN numbers.
  if (edgeGap === null && projected !== null && implied !== null) {
    edgeGap = projected - implied;
  }
  return { projected, implied, edge: edgeGap };
}

// AI Grade is just the confidence score re-expressed as a familiar letter — same
// underlying signal, no new data. Null score (no edge) means no grade.
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
function confidenceBlurb(score: number): string {
  if (score >= 7.5) return "High Confidence";
  if (score >= 6) return "Solid Confidence";
  if (score >= 4.5) return "Moderate Confidence";
  return "Low Confidence";
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
  const variance = deriveVariance(odds, isProp);
  // AI Grade + Confidence are one derived rating of the model's OWN stated edge
  // (nudged by the bet's variance), re-expressed as a 0–10 score and a letter.
  const score = deriveConfidenceScore(gap, variance);
  const grade = deriveGrade(score);
  const edgeText = gap === null ? null : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`;
  const gapColor =
    gap === null ? colors.mutedForeground : gap >= 0 ? colors.success : colors.destructive;
  const gradeColor =
    score === null
      ? colors.mutedForeground
      : score >= 7
        ? colors.success
        : score >= 5.5
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
    const s = score ?? 0;
    return (
      <View style={{ flexDirection: "row", gap: 8 }}>
        {cell("award", "AI Grade", grade ?? "—", gradeColor, gradeBlurb(s))}
        {cell("trending-up", "Edge", edgeText ?? "—", gapColor, edgeBlurb(gap))}
        {cell("target", "Confidence", s.toFixed(1), colors.primary, confidenceBlurb(s), "/10")}
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
      {chip(`Confidence: ${(score ?? 0).toFixed(1)}/10`, colors.primary, colors.border)}
    </View>
  );
}

export function PickCard({
  pick,
  onPress,
  hideReadout,
  badge,
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
}) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const added = hasLeg(pick.game, pick.market, pick.pick);
  const [edgeOpen, setEdgeOpen] = useState(false);

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
      {badge ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{
              paddingVertical: 3,
              paddingHorizontal: 8,
              borderRadius: 999,
              backgroundColor:
                badge.tone === "grade"
                  ? colors.success
                  : badge.tone === "value"
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
              {badge.text}
            </Text>
          </View>
          {badge.caption ? (
            <Text
              style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 10, flex: 1 }}
              numberOfLines={1}
            >
              {badge.caption}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => ({ gap: 8, opacity: pressed && onPress ? 0.7 : 1 })}
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
          <Text style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 22 }}>
            {formatAmerican(pick.odds)}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 18, lineHeight: 23 }}>
            {pick.pick}
          </Text>
          {homeAwayTag ? (
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
        <MatchupLine game={pick.game} />
        {formatGameTime(pick.startsAt) ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: -3 }}>
            <Feather name="clock" size={11} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {formatGameTime(pick.startsAt)}
            </Text>
          </View>
        ) : null}
        {onPress ? (
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

      <LineLadder pick={pick} />

      {hideReadout ? null : pick.scores ? (
        <ScoreBreakdown data={pick.scores} variant="compact" />
      ) : (
        <EdgeReadout edge={pick.edge} odds={pick.odds} isProp={pick.isProp} grid />
      )}

      {pick.edge ? (
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
export const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[^a-z0-9+\-. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const gameTokens = (s: string) =>
  new Set(norm(s).split(" ").filter((w) => /[a-z]/.test(w) && w.length > 2));

export function sameGame(a: string, b: string): boolean {
  const ta = gameTokens(a);
  const tb = gameTokens(b);
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits >= 2; // two shared team tokens = same fixture
}

// A team's nickname = the last alphabetic token of its name ("New York Liberty"
// -> "liberty", "Toronto Tempo" -> "tempo"). Nicknames are unique per team and
// consistent across the ESPN + Odds feeds, so they identify a side far more
// reliably than raw token overlap — which over-matches multi-word city names
// ("New York" alone is two tokens, so sameGame() treats ANY other game with
// that team as the same fixture).
function teamNick(team: string): string {
  const t = norm(team)
    .split(" ")
    .filter((w) => /[a-z]/.test(w));
  return t[t.length - 1] || "";
}

const teamTokens = (team: string): Set<string> =>
  new Set(norm(team).split(" ").filter((w) => /[a-z]/.test(w)));

const tokenOverlap = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

// Resolve a pick's "Away @ Home" label to the real scheduled start time from the
// per-game ESPN meta table. A team is identified by its NICKNAME (last alphabetic
// token) — unique per team and consistent across the ESPN + Odds feeds — and a
// fixture matches when BOTH nicknames match (either orientation), scoped by sport.
// Because college nicknames are NOT unique (many "Tigers"/"Bulldogs"), candidates
// are ranked by full-token specificity (city + nickname) so the better-identified
// fixture wins, then exact orientation, then soonest upcoming. The SAME matchup on
// multiple dates (a playoff series or doubleheader) resolves to the soonest
// upcoming game. It only fails closed (null) when two DIFFERENT fixtures (distinct
// team identities, e.g. two different college "Tigers @ Bulldogs" games) tie as
// equally-good matches — so a card never shows a possibly-wrong time.
function gameStartFromMeta(
  pickGame: string,
  sport: string | undefined,
  gameMeta: GameMeta[],
): string | null {
  const parts = pickGame.split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const pa = teamNick(parts[0]);
  const ph = teamNick(parts[1]);
  if (!pa || !ph) return null;
  const paSet = teamTokens(parts[0]);
  const phSet = teamTokens(parts[1]);

  const now = Date.now();
  type Scored = {
    startsAt: string | null;
    spec: number;
    exact: boolean;
    upcoming: boolean;
    t: number;
    idKey: string;
  };
  const scored: Scored[] = [];
  for (const m of gameMeta) {
    if (sport && m.sport && m.sport !== sport) continue;
    const ma = teamNick(m.awayTeam);
    const mh = teamNick(m.homeTeam);
    if (!ma || !mh) continue;
    const sameOrient = ma === pa && mh === ph;
    const flipOrient = ma === ph && mh === pa;
    if (!sameOrient && !flipOrient) continue;
    const maSet = teamTokens(m.awayTeam);
    const mhSet = teamTokens(m.homeTeam);
    const spec = sameOrient
      ? tokenOverlap(paSet, maSet) + tokenOverlap(phSet, mhSet)
      : tokenOverlap(paSet, mhSet) + tokenOverlap(phSet, maSet);
    const t = m.startsAt ? Date.parse(m.startsAt) : NaN;
    scored.push({
      startsAt: m.startsAt ?? null,
      spec,
      exact: sameOrient,
      upcoming: Number.isFinite(t) && t >= now - 4 * 3600 * 1000,
      t: Number.isFinite(t) ? t : Number.POSITIVE_INFINITY,
      // Orientation-independent team identity so the SAME matchup on multiple
      // dates (playoff series / doubleheader) is recognized as one fixture, while
      // a different team pairing that merely shares nicknames is recognized as a
      // genuine collision.
      idKey: [norm(m.awayTeam), norm(m.homeTeam)].sort().join("|"),
    });
  }
  if (scored.length === 0) return null;
  scored.sort(
    (a, b) =>
      b.spec - a.spec ||
      Number(b.exact) - Number(a.exact) ||
      Number(b.upcoming) - Number(a.upcoming) ||
      a.t - b.t,
  );
  const top = scored[0];
  // Fail closed on a true collision: another fixture with a DIFFERENT team
  // identity matches just as specifically (same spec + orientation). We do NOT
  // require the same `upcoming` flag here — otherwise a stale in-window live game
  // (3-4h old) could be silently displaced by a future same-nickname different
  // fixture and show its wrong time. Same-identity ties (a series/doubleheader)
  // are fine — the sort above already put the soonest upcoming game first.
  const collision = scored.some(
    (s) => s.idKey !== top.idKey && s.spec === top.spec && s.exact === top.exact,
  );
  if (collision) return null;
  return top.startsAt;
}

// Collapse market wording to a family so an AI "Spread" pick can only ever
// resolve to a real Spread line (never accidentally to a Moneyline entry).
export function marketFamily(s: string): string {
  const m = norm(s);
  // Period prefix (1H/2H/Q1–Q4). Kept in the family so a period pick can only
  // resolve to the matching period line — e.g. a "Q3 Moneyline" pick (selection
  // "Knicks ML") must NOT collapse onto the full-game moneyline, which shares the
  // identical selection. Full-game markets have no prefix. "h1"/"h2" normalize to
  // "1h"/"2h"; "h2h" (a moneyline word) has no \b after it so it never matches.
  const pm = m.match(/\b(1h|2h|h1|h2|q1|q2|q3|q4|f5)\b/);
  // Baseball innings periods: "F5 …" (first five innings) and "1st Inning …".
  // Kept in the family so an "F5 Total" can't collapse onto the full-game total.
  let period = pm ? `${pm[1].replace("h1", "1h").replace("h2", "2h")}:` : "";
  if (!period && /\b1st inning\b/.test(m)) period = "1i:";
  let fam: string;
  if (/spread|run ?line|puck ?line/.test(m)) fam = "spread";
  else if (/total|over|under|o\/u/.test(m)) fam = "total";
  else if (/money|h2h|\bml\b/.test(m)) fam = "moneyline";
  else fam = m;
  return period + fam;
}

// Generic market words that carry no team/side identity — ignored when checking
// that the AI named the right team/side (so "Brewers ML" still matches the AI's
// "Milwaukee Brewers moneyline").
const GENERIC_WORDS = new Set([
  "ml",
  "moneyline",
  "money",
  "line",
  "over",
  "under",
  "total",
  "spread",
  "runline",
  "puckline",
]);

// Returns true if `entryPick` (a real line like "Brewers ML" / "Over 8.5" /
// "Brewers -1.5") is the selection the AI named. To never leak a fabricated or
// wrong-side pick, it requires:
//   - every numeric token of the real line (the side/line) to appear exactly, AND
//   - every team/side identifier token (non-generic word) to appear, AND
//   - at least one positive token in common.
function selectionMatches(entryPick: string, aiSelection: string): boolean {
  const et = norm(entryPick).split(" ").filter(Boolean);
  if (et.length === 0) return false;
  const at = new Set(norm(aiSelection).split(" ").filter(Boolean));

  for (const t of et) {
    if (/^[+-]?\d/.test(t) && !at.has(t)) return false; // line/side number must match exactly
  }
  for (const t of et) {
    if (/[a-z]/.test(t) && !GENERIC_WORDS.has(t) && !at.has(t)) return false; // team/side must match
  }
  return et.some((t) => at.has(t));
}

// Which Over/Under side an AI selection names. Tolerates both full words
// ("Over 5.5") and the shorthand the model sometimes emits ("o5.5"/"u5.5").
function sideOf(sel: string): "Over" | "Under" | null {
  const n = norm(sel);
  if (/\bunder\b/.test(n) || /\bu\s?\d/.test(n)) return "Under";
  if (/\bover\b/.test(n) || /\bo\s?\d/.test(n)) return "Over";
  return null;
}

// Resolve a prop PICK line ("Skubal Over 5.5 Strikeouts") to a REAL posted prop
// in the pool. Fail-closed: requires the same game + the player's last name +
// the exact posted line + a matching Over/Under side (yes/no markets like
// "Anytime TD" skip the line/side checks). The display label is rebuilt from
// the real entry in full words so the card never shows the AI's "o5.5"
// shorthand, and the odds come from the real entry, never the AI text.
// Which rung an explicit "alt" request should resolve to. "cushion" = safe
// deep-juice rungs (-200..-500); "value" = least-aggressive plus-money rung.
export type AltRungBias = "value" | "cushion" | null;
// Deepest (safest) cushion we'll snap an alt prop to — keeps legs in the
// -200..-500 band the user asks for without burying them in no-payout juice.
const CUSHION_FLOOR = -550;

// Yes/no prop markets: the feed surfaces these as an Over 0.5 (HR / anytime TD)
// or null-line (anytime goalscorer) entry, but the books — and the AI, per the
// shared chat prompt — phrase them as "<Player> To Hit a HR" / "Anytime TD" /
// "Anytime Goal", with NO line number and NO Over/Under token. The exact
// line/side gate in matchProp would otherwise reject every such leg, which is
// exactly why "3 leg home run?" came back "couldn't ground any of those legs".
const YES_NO_PROP_MARKETS = new Set([
  "batter_home_runs",
  "player_anytime_td",
  "player_goals",
  "player_goal_scorer_anytime",
]);

function matchProp(
  game: string,
  market: string,
  selection: string,
  propPool: PropPoolEntry[],
  altRungBias: AltRungBias = null,
): ParsedPick | null {
  const side = sideOf(selection);
  const selTokens = new Set(norm(selection).split(" ").filter(Boolean));
  const mkN = norm(market);
  // Detect a yes/no-phrased selection ("To Hit a HR" / "Anytime TD" / "Anytime
  // Goal") so the line/side gate below can be skipped for those markets — the
  // "Yes" side maps to the feed's Over leg.
  const selN = norm(selection);
  const selYesNo =
    /\bto hit a hr\b|\banytime (?:td|touchdown|goal)\b|\banytime scorer\b|\bto score (?:a )?(?:td|touchdown|goal)\b/.test(
      selN,
    );
  let best: PropPoolEntry | null = null;
  let bestScore = -1;
  for (const e of propPool) {
    if (!sameGame(e.game, game)) continue;
    const ln = norm(e.player).split(" ").filter(Boolean).pop() || "";
    if (!ln || !selTokens.has(ln)) continue; // player must be named
    const isYesNoEntry =
      YES_NO_PROP_MARKETS.has(String(e.marketKey || "")) &&
      (e.line == null || e.line === 0.5);
    if (selYesNo && isYesNoEntry) {
      // Yes-phrased pick → the Over (= "Yes") leg only; never the Under/No side.
      if (e.line != null && e.side !== "Over") continue;
    } else if (e.line != null) {
      if (!selTokens.has(String(e.line))) continue; // exact posted line
      if (!side || side !== e.side) continue; // exact Over/Under side
    }
    const lbl = norm(e.marketLabel).split(" ").filter(Boolean);
    const score = lbl.filter((t) => selTokens.has(t) || mkN.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (!best) return null;
  // BARE-ALT PLUS-MONEY UPGRADE. The shared chat prompt steers bare-alt props to
  // their plus-money value rung using playerHistory reachability — but the MOBILE
  // context carries no per-player game log, so the model has no basis to step up
  // and defaults every prop to the shorter-priced cushion rung (e.g. Over 6.5
  // -245 instead of the player's real Over 8.5 +120). For an explicit bare-alt
  // ask, when the resolved rung is a cushion (priced worse than +100), swap it to
  // the LEAST-AGGRESSIVE real plus-money rung on the SAME player+market+side — the
  // closest-to-even upside upgrade, never the deep longshot. Real posted rung +
  // real odds from the pool, never invented; bounded by picking the smallest
  // positive price. yes/no markets (best.line == null) are left untouched.
  // ALT RUNG BIAS (deterministic, mobile only). Mobile sends no per-player
  // game-log data, so the model can't reason about which alt rung to pick and
  // lands on whatever it first emits. For an explicit "alt" ask we snap the
  // resolved prop to the rung the user wants — chosen from REAL posted rungs on
  // the SAME game + EXACT player (full name, so a same-surname teammate can't be
  // swapped in) + market + side, with their REAL odds (never invented):
  //   "cushion" (default for a bare alt): the SAFEST deep-juice rung — the
  //     most-negative price still no worse than CUSHION_FLOOR (-550), so legs land
  //     in the -200..-500 band. Each player's ladder differs, so this naturally
  //     spreads the legs across that band.
  //   "value": the LEAST-aggressive plus-money rung (smallest odds >= +100) — the
  //     closest-to-even upside, never a deep longshot. Only when the resolved rung
  //     is itself a cushion (odds < +100).
  // yes/no markets (line == null) are left untouched.
  if (altRungBias && best.line != null) {
    const bestName = norm(best.player);
    const bestMkt = norm(best.marketLabel);
    const bestSide = best.side;
    const bestGame = best.game;
    const bestOdds = best.odds;
    const eligible = (e: PropPoolEntry) =>
      e.line != null &&
      e.side === bestSide &&
      sameGame(e.game, bestGame) &&
      norm(e.player) === bestName &&
      norm(e.marketLabel) === bestMkt;
    let up: PropPoolEntry | null = null;
    if (altRungBias === "value" && bestOdds < 100) {
      for (const e of propPool) {
        if (!eligible(e) || e.odds < 100) continue; // plus-money rungs only
        if (!up || e.odds < up.odds) up = e; // least-aggressive (closest to even)
      }
    } else if (altRungBias === "cushion") {
      for (const e of propPool) {
        if (!eligible(e) || e.odds >= 0 || e.odds < CUSHION_FLOOR) continue; // safe rungs within floor
        if (!up || e.odds < up.odds) up = e; // deepest (safest) within floor
      }
    }
    if (up) best = up;
  }
  // ALT OPTIONS (display-only, deterministic). From the SAME real ladder
  // (same game + EXACT player + market + side), surface the two nearest rungs to
  // the chosen one so the user can see a safer / longer alternative at a glance:
  //   cushion = nearest SAFER rung (odds < best, within CUSHION_FLOOR juice)
  //   value   = nearest HIGHER-PAYOUT rung (odds > best)
  // Real posted line + real odds from the pool, never invented. yes/no markets
  // (best.line == null) have no ladder, so no alt options.
  let altOptions: ParsedPick["altOptions"];
  if (best.line != null) {
    const bn = norm(best.player);
    const bm = norm(best.marketLabel);
    const bs = best.side;
    const bg = best.game;
    const bestLine = best.line;
    const bestOdds = best.odds;
    let cushion: PropPoolEntry | null = null;
    let value: PropPoolEntry | null = null;
    for (const e of propPool) {
      if (
        e.line == null ||
        e.line === bestLine ||
        e.side !== bs ||
        norm(e.player) !== bn ||
        norm(e.marketLabel) !== bm ||
        !sameGame(e.game, bg)
      )
        continue;
      if (e.odds < bestOdds && e.odds >= CUSHION_FLOOR) {
        if (!cushion || e.odds > cushion.odds) cushion = e; // nearest safer rung
      } else if (e.odds > bestOdds) {
        if (!value || e.odds < value.odds) value = e; // nearest higher-payout rung
      }
    }
    // Full slip pick-string for a rung — same format as the main leg
    // (`player side line marketLabel`) with only the line swapped, so the slip
    // dedupe / AI parity keyed on game|market|pick stays consistent.
    const rungPick = (e: PropPoolEntry) =>
      `${e.player} ${e.side} ${e.line} ${e.marketLabel}`;
    if (cushion || value) {
      altOptions = {};
      if (cushion)
        altOptions.cushion = { side: cushion.side, line: cushion.line as number, odds: cushion.odds, pick: rungPick(cushion) };
      if (value)
        altOptions.value = { side: value.side, line: value.line as number, odds: value.odds, pick: rungPick(value) };
    }
  }
  const pick =
    best.line != null
      ? `${best.player} ${best.side} ${best.line} ${best.marketLabel}`
      : `${best.player} ${best.marketLabel}`;
  return {
    game: best.game,
    market: best.marketLabel,
    pick,
    odds: best.odds,
    sport: best.sport,
    isProp: true,
    headshot: best.headshot ?? null,
    teamAbbr: best.teamAbbr ?? null,
    altOptions,
    // Carried so a tap on this card can open the player's real stats sheet.
    player: best.player,
    athleteId: best.athleteId ?? null,
    propMarketKey: best.marketKey,
    propLine: best.line,
    propSide: best.side,
  };
}

// The numeric line of a pick string ("Knicks -3.5" -> -3.5, "Over 8.5" -> 8.5).
// null when no number is present (moneyline / yes-no markets).
function numLine(pick: string): number | null {
  const m = norm(pick).match(/[+-]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Team-identity tokens of a game pick (non-generic alpha words) so two spread
// rungs can be confirmed to name the SAME side ("Knicks -3.5" vs "Knicks +1.5").
function teamIdToks(pick: string): Set<string> {
  return new Set(
    norm(pick)
      .split(" ")
      .filter((t) => /[a-z]/.test(t) && !GENERIC_WORDS.has(t)),
  );
}

// Same team? One token set must be a non-empty subset of the other so a full
// name ("New York Knicks") still matches its nickname-only rung ("Knicks") while
// two different teams ("LA Lakers" vs "LA Clippers") never collide.
function sameTeam(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

// Build the SAFE (cushion) / VALUE rungs for a GAME-level spread or total pick
// from the real odds pool, mirroring matchProp's prop ladder. Scans the SAME
// game + market family + side (the team for a spread, Over/Under for a total),
// REAL posted rungs only — including the feed's "Alt Spread"/"Alt Total" entries
// — never invented. cushion = nearest SAFER rung (lower odds, within
// CUSHION_FLOOR juice); value = nearest HIGHER-PAYOUT rung. Moneyline / yes-no
// have no alternate line, so they get no rungs (the card shows BEST only).
// MONEYLINE CUSHION BAND. A moneyline only cashes on an outright win; a spread
// giving the SAME team +1..+20 points also cashes if they merely lose by fewer
// than the line, so within this band EVERY rung is strictly safer than the ML
// (more juice, less risk). For an ML pick we therefore surface the book's REAL
// posted spread / Alt Spread rungs on that team inside the band as the card's
// Safe/Value tiers — Safe = the safest price (lowest odds), Value = the highest
// payout (highest odds); see chooseMlCushionTiers. REAL posted rungs only, never
// invented; an ML with no posted +point spread in band shows BEST only (honest).
// Period prefix is preserved so a "Q3 ML" pick only pulls Q3 spread rungs, never
// the full-game spread.
function moneylineCushionOptions(
  best: RealOddsLike,
  pool: RealOddsLike[],
  fam: string,
): ParsedPick["altOptions"] | undefined {
  const bestTeam = teamIdToks(best.pick);
  if (bestTeam.size === 0) return undefined; // can't tell whose ML this is
  const wantFam = fam.replace(/moneyline$/, "spread"); // same period, spread family
  const rungs: RealOddsLike[] = [];
  for (const e of pool) {
    if (e === best) continue;
    if (typeof e.odds !== "number") continue;
    if (!sameGame(e.game, best.game)) continue;
    if (marketFamily(e.market) !== wantFam) continue;
    if (!sameTeam(bestTeam, teamIdToks(e.pick))) continue;
    const ln = numLine(e.pick);
    // +1..+20 points TO the team only (a positive handicap = a cushion).
    if (ln == null || ln < ML_CUSHION_MIN_PTS || ln > ML_CUSHION_MAX_PTS) continue;
    if (e.odds < CUSHION_FLOOR) continue; // skip buried no-payout juice
    rungs.push(e);
  }
  const tiers = chooseMlCushionTiers(
    rungs.map((e) => ({ line: numLine(e.pick) ?? 0, odds: e.odds })),
  );
  if (!tiers) return undefined;
  const rung = (e: RealOddsLike) => ({
    side: "",
    line: numLine(e.pick) ?? 0,
    odds: e.odds,
    pick: e.pick,
    market: e.market,
  });
  const out: ParsedPick["altOptions"] = { cushion: rung(rungs[tiers.safe]!) };
  if (tiers.value != null) out.value = rung(rungs[tiers.value]!);
  return out;
}

function gameAltOptions(
  best: RealOddsLike,
  pool: RealOddsLike[],
): ParsedPick["altOptions"] | undefined {
  const fam = marketFamily(best.market);
  const isTotal = fam.endsWith("total");
  const isSpread = fam.endsWith("spread");
  // Moneyline: no alternate line in its OWN family — instead offer the +1..+20
  // point spread cushion on the same team (real posted rungs only).
  if (fam.endsWith("moneyline")) return moneylineCushionOptions(best, pool, fam);
  if (!isTotal && !isSpread) return undefined;
  const bestLine = numLine(best.pick);
  if (bestLine == null) return undefined;
  const bestSide = isTotal ? sideOf(best.pick) : null;
  if (isTotal && !bestSide) return undefined;
  const bestTeam = isTotal ? null : teamIdToks(best.pick);
  if (bestTeam && bestTeam.size === 0) return undefined;
  const bestOdds = best.odds;
  let cushion: RealOddsLike | null = null;
  let value: RealOddsLike | null = null;
  for (const e of pool) {
    if (e === best) continue;
    if (typeof e.odds !== "number") continue;
    if (!sameGame(e.game, best.game)) continue;
    if (marketFamily(e.market) !== fam) continue;
    const ln = numLine(e.pick);
    if (ln == null || ln === bestLine) continue;
    if (isTotal) {
      if (sideOf(e.pick) !== bestSide) continue;
    } else if (!sameTeam(bestTeam as Set<string>, teamIdToks(e.pick))) {
      continue;
    }
    if (e.odds < bestOdds && e.odds >= CUSHION_FLOOR) {
      if (!cushion || e.odds > cushion.odds) cushion = e; // nearest safer rung
    } else if (e.odds > bestOdds) {
      if (!value || e.odds < value.odds) value = e; // nearest higher-payout rung
    }
  }
  if (!cushion && !value) return undefined;
  const rung = (e: RealOddsLike) => ({
    side: isTotal ? sideOf(e.pick) ?? "" : "",
    line: numLine(e.pick) ?? 0,
    odds: e.odds,
    pick: e.pick,
    market: e.market,
  });
  const out: ParsedPick["altOptions"] = {};
  if (cushion) out.cushion = rung(cushion);
  if (value) out.value = rung(value);
  return out;
}

// Resolve which team a game-level pick is on (logo + abbr) from the game's ESPN
// metadata. Matches the selection's tokens against each team's name tokens and
// abbreviation. Totals ("Over 8.5") name no team and return null (no logo).
function teamSideFromPick(
  meta: GameMeta,
  selection: string,
): { logo: string | null; abbr: string | null } | null {
  const toks = new Set(norm(selection).split(" ").filter(Boolean));
  const teamHits = (team: string) =>
    norm(team)
      .split(" ")
      .filter((t) => t.length > 2)
      .filter((t) => toks.has(t)).length;
  const homeHit = teamHits(meta.homeTeam) + (meta.homeAbbr && toks.has(norm(meta.homeAbbr)) ? 1 : 0);
  const awayHit = teamHits(meta.awayTeam) + (meta.awayAbbr && toks.has(norm(meta.awayAbbr)) ? 1 : 0);
  if (homeHit === 0 && awayHit === 0) return null; // total / no team named
  if (homeHit >= awayHit) return { logo: meta.homeLogo, abbr: meta.homeAbbr };
  return { logo: meta.awayLogo, abbr: meta.awayAbbr };
}

// Attach real ESPN team logos/codes to a game-level pick from the per-game meta
// table. A single-team pick (ML/spread) gets that team's logo; a game total
// names no team, so BOTH teams' logos/codes ride along for a matchup avatar.
// Idempotent + non-destructive: a pick that already carries a headshot (prop) or
// any logo is returned untouched, so re-enriching stored slip picks is safe.
export function enrichPickMeta(pick: ParsedPick, gameMeta: GameMeta[]): ParsedPick {
  // Props show a player headshot, never a team logo. The player's single team
  // code (teamAbbr) comes from the props feed's playerTeamId and can resolve to
  // the wrong club (e.g. a Knicks player tagged "NO"), so for the subtitle we
  // attach the game's matchup abbreviations (always correct, from ESPN) and let
  // the card render "AWAY @ HOME · MARKET" instead of a lone, possibly-wrong
  // code. Logos are never set here so the headshot stays the avatar.
  if (pick.isProp) {
    if (pick.awayAbbr && pick.homeAbbr) return pick;
    const m = gameMeta.find((gm) => sameGame(gm.game, pick.game));
    if (!m) return pick;
    return { ...pick, awayAbbr: m.awayAbbr, homeAbbr: m.homeAbbr };
  }
  if (pick.headshot || pick.teamLogo || pick.awayLogo || pick.homeLogo) return pick;
  const meta = gameMeta.find((gm) => sameGame(gm.game, pick.game));
  if (!meta) return pick;
  const side = teamSideFromPick(meta, pick.pick);
  if (side) return { ...pick, teamLogo: side.logo, teamAbbr: side.abbr };
  return {
    ...pick,
    awayLogo: meta.awayLogo,
    homeLogo: meta.homeLogo,
    awayAbbr: meta.awayAbbr,
    homeAbbr: meta.homeAbbr,
  };
}

// Resolve which side of a game-level pick names a single team, so a tap can open
// that team's real stats sheet. Reads ONLY the pick's own "Away @ Home" label
// and selection text (no feed lookup needed). Returns null for props and totals
// (which name no single team) and for ambiguous picks (both teams present), so a
// card never opens the wrong team's breakdown. The spread number (if any) is
// parsed off the selection.
export function gameSideFromPick(
  pick: ParsedPick,
): { name: string; opp: string; isHome: boolean; line: number | null } | null {
  if (pick.isProp) return null;
  const text = norm(pick.pick);
  if (sideOf(pick.pick)) return null; // total — no single team
  const parts = pick.game.split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const [away, home] = parts.map((s) => s.trim());
  const homeNick = teamNick(home);
  const awayNick = teamNick(away);
  const matchHome =
    text.includes(norm(home)) || (homeNick.length > 2 && text.split(" ").includes(homeNick));
  const matchAway =
    text.includes(norm(away)) || (awayNick.length > 2 && text.split(" ").includes(awayNick));
  if (matchHome === matchAway) return null; // neither, or both (ambiguous) → don't guess
  const m = pick.pick.match(/([+-]\d+(?:\.\d+)?)/);
  const line = m ? Number(m[1]) : null;
  return matchHome
    ? { name: home, opp: away, isHome: true, line }
    : { name: away, opp: home, isHome: false, line };
}

// A GAME total ("Over/Under 214.5") names NO single team — it's about the two
// teams' combined score — so unlike gameSideFromPick this surfaces BOTH teams so
// a matchup stats sheet can show each side's real scoring. Returns null for
// props, non-totals (moneyline/spread), and malformed "Away @ Home" labels.
export function gameTotalFromPick(
  pick: ParsedPick,
): { away: string; home: string; side: "Over" | "Under"; line: number | null } | null {
  if (pick.isProp) return null;
  const side = sideOf(pick.pick);
  if (!side) return null;
  const parts = pick.game.split(/\s+@\s+/);
  if (parts.length !== 2) return null;
  const [away, home] = parts.map((s) => s.trim());
  if (!away || !home) return null;
  const m = pick.pick.match(/(\d+(?:\.\d+)?)/);
  const line = m ? Number(m[1]) : null;
  return { away, home, side, line };
}

export function parsePicks(
  text: string,
  realOdds: ParsedPick[] | RealOddsLike[],
  propPool: PropPoolEntry[] = [],
  gameMeta: GameMeta[] = [],
  altRungBias: AltRungBias = null,
): ParsedPick[] {
  const pool = (realOdds as RealOddsLike[]) || [];
  if (pool.length === 0 && propPool.length === 0) return []; // fail-closed: no real data -> no cards

  const lines = text.split("\n");
  const out: ParsedPick[] = [];
  // Anti-correlation guard for GAME-LEVEL markets: a single game can have only
  // ONE defensible moneyline / spread / total side — the AI emitting both sides
  // (e.g. "Smotritsky ML -250" AND "Stargel ML +170" for the same match) is a
  // contradiction. Keep the FIRST game-level pick per (game, market-family) and
  // drop later same-family picks on that game. Player props are EXCLUDED: two
  // different players' props on the same game legitimately share a family
  // (marketFamily lumps player + game totals together), so they must not collide.
  const gameLevelSeen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Only PICK lines are real legs. ALT lines are alternate/swap suggestions
    // for a leg the AI already emitted (e.g. the safe-ticket "alt -3.5 vs laying
    // -260" rung), NOT additional legs — counting them double-counted a safe
    // 3-leg ticket as 6 cards. The web app likewise parses PICK lines only.
    const m = line.match(/^PICK\s*:\s*(.+)$/i);
    if (!m) continue;
    const parts = m[1].split("|").map((p) => p.trim());
    if (parts.length < 4) continue;
    const [game, market, selection] = parts;
    const selTokens = new Set(norm(selection).split(" ").filter(Boolean));

    // Decide the pool up front. A selection is a PLAYER PROP iff some pooled
    // prop for this game has its player's last name in the selection. When it
    // is, resolve ONLY against the prop pool — never the game-level pool — so a
    // prop like "Over 5.5 Total Bases" or "Over 5.5 Shots" can't collide with a
    // same-numbered game total (marketFamily lumps both under "total"). Game
    // totals/spreads/moneylines never carry a player last-name token, so they
    // fall through to the game-level branch.
    const isPropSelection = propPool.some((e) => {
      if (!sameGame(e.game, game)) return false;
      const ln = norm(e.player).split(" ").filter(Boolean).pop() || "";
      return !!ln && selTokens.has(ln);
    });

    let resolved: ParsedPick | null = null;

    if (isPropSelection) {
      // Player-prop pool only (fail-closed: drop if not a real posted prop).
      resolved = matchProp(game, market, selection, propPool, altRungBias);
    } else {
      // Game-level pool: same game + same market family + matching selection.
      const fam = marketFamily(market);
      const candidates = pool.filter(
        (e) => sameGame(e.game, game) && marketFamily(e.market) === fam,
      );
      let best: RealOddsLike | null = null;
      let bestScore = 0;
      for (const e of candidates) {
        if (!selectionMatches(e.pick, selection)) continue;
        const et = norm(e.pick).split(" ").filter(Boolean);
        const score = et.filter((t) => selTokens.has(t)).length / Math.max(1, et.length);
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      if (best) {
        resolved = enrichPickMeta(
          {
            game: best.game,
            market: best.market,
            pick: best.pick,
            odds: best.odds,
            sport: best.sport,
            // SAFE / VALUE rungs for a game spread/total from the real pool's
            // alt lines (BEST is this pick). Moneyline -> undefined (BEST only).
            altOptions: gameAltOptions(best, pool),
          },
          gameMeta,
        );
      } else {
        // PERIOD MAIN-LINE SALVAGE. The model loves to "buy a cushion" on a
        // period leg by emitting an ALT rung — "1H Alt Spread Knicks +4.5",
        // "1H Alt Total Over 111" — but the feed sends only ONE curated alt rung
        // per side, so a self-reasoned alt point fails selectionMatches above and
        // the leg is dropped. On a single-game first-half ask that turns a real
        // 2-3 leg ticket into a lone moneyline. When a PERIOD game-side pick can't
        // resolve, snap it to the MAIN posted period line on the SAME side (a real
        // realOdds entry — never invented, never a side flip): the team named (for
        // spread/moneyline) or the Over/Under named (for total). Only main (non-
        // "Alt") period entries are eligible, so the substitute is always a clean,
        // renderable line. If no such main line exists, fall through and drop.
        const periodFam = fam.match(/^(1h|2h|q[1-4]):(spread|total|moneyline)$/);
        if (periodFam) {
          const base = periodFam[2];
          const wantSide = base === "total" ? sideOf(selection) : null;
          const teamToks = [...selTokens].filter(
            (t) => /[a-z]/.test(t) && !GENERIC_WORDS.has(t),
          );
          const mains = pool.filter(
            (e) =>
              sameGame(e.game, game) &&
              marketFamily(e.market) === fam &&
              !/\balt\b/i.test(e.market),
          );
          let salv: RealOddsLike | undefined;
          if (base === "total") {
            // Over/Under is unambiguous — snap to the named side's main rung.
            salv = mains.find((e) => !!wantSide && sideOf(e.pick) === wantSide);
          } else {
            // Spread / moneyline: pick the side whose team tokens overlap the AI
            // selection the MOST, and FAIL CLOSED if two different teams tie — a
            // naive "any token overlaps" match would side-flip on shared words
            // ("Michigan State" vs "Ohio State", "LA Lakers" vs "LA Clippers").
            const teamKey = (toks: string[]) =>
              toks.filter((t) => /[a-z]/.test(t) && !GENERIC_WORDS.has(t)).sort().join(" ");
            const scored = mains.map((e) => {
              const et = norm(e.pick).split(" ").filter(Boolean);
              return {
                e,
                key: teamKey(et),
                n: et.filter((t) => /[a-z]/.test(t) && !GENERIC_WORDS.has(t) && teamToks.includes(t)).length,
              };
            });
            const maxN = Math.max(0, ...scored.map((s) => s.n));
            if (maxN > 0) {
              const top = scored.filter((s) => s.n === maxN);
              // Every top-scoring candidate must name the SAME team; otherwise the
              // selection is ambiguous and we drop rather than guess a side.
              if (new Set(top.map((s) => s.key)).size === 1) salv = top[0].e;
            }
          }
          if (salv) {
            resolved = enrichPickMeta(
              { game: salv.game, market: salv.market, pick: salv.pick, odds: salv.odds, sport: salv.sport },
              gameMeta,
            );
          }
        }
      }
    }

    if (!resolved) continue; // selection/price not in any real pool -> drop

    // Attach the game's real scheduled start (ESPN) so the card can show its
    // date/time. Matched by BOTH team nicknames + sport (see gameStartFromMeta)
    // — NOT sameGame()'s token overlap, which over-matches multi-word city names.
    if (!resolved.startsAt) {
      const start = gameStartFromMeta(resolved.game, resolved.sport ?? undefined, gameMeta);
      if (start) resolved.startsAt = start;
    }

    const em = lines[i + 1]?.trim().match(/^EDGE\s*:\s*(.+)$/i);
    if (em) resolved.edge = em[1].trim();

    // Canonical, real fields only (real odds, real market, real selection).
    const id = `${resolved.game}|${resolved.market}|${resolved.pick}`.toLowerCase();
    if (out.some((p) => `${p.game}|${p.market}|${p.pick}`.toLowerCase() === id)) continue;

    // Game-level anti-correlation: only ONE moneyline/spread/total side per game.
    // (Props are excluded — different players can share a family on one game.)
    if (!isPropSelection) {
      const famKey = `${norm(resolved.game)}|${marketFamily(resolved.market)}`;
      if (gameLevelSeen.has(famKey)) continue; // contradictory second side -> drop
      gameLevelSeen.add(famKey);
    }

    out.push(resolved);
  }
  return out;
}

type RealOddsLike = {
  sport?: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  startsAt?: string | null;
};

// Market-matcher passes for an explicit "+ alt" / "- alt" ticket: all full-game
// Alt Spreads first (one per game), then Alt Totals — so an alt ticket spreads
// across distinct games before doubling up a single game.
export const ALT_BACKFILL_ORDER: RegExp[] = [/^Alt Spread$/, /^Alt Total$/];

// Market-matcher passes for a PLAIN N-leg parlay that resolves short. Real
// FULL-GAME mains only (no alts, no period slices), Moneyline first so each
// added leg lands on a DISTINCT unused game before the fill ever doubles a game
// up with its spread/total. Each label resolves to a real `buildRealOdds` entry.
export const GENERIC_BACKFILL_ORDER: RegExp[] = [
  /^Moneyline$/,
  /^Spread$/,
  /^Total$/,
];

// Market-matcher passes for a PERIOD / same-game ticket. Honors the user's
// requested period+alt intent FIRST — the explicit "alt spreads" ask, then the
// period winners/sides/totals the model most often skips (Q1/1H/2H Moneyline is
// the usual omission) — only dipping into first-half alt ladders, the full-game
// alt total, deeper-quarter markets, and finally full-game mains if the ticket is
// STILL short. Each label resolves to a real `buildRealOdds` entry; marketFamily
// keeps every period distinct so these never collide with each other.
export const PERIOD_BACKFILL_ORDER: RegExp[] = [
  /^Alt Spread$/,
  /^(1H|2H|Q1) Moneyline$/,
  /^(1H|2H|Q1) (Spread|Total)$/,
  /^1H Alt (Spread|Total)$/,
  /^Alt Total$/,
  /^(Q2|Q3|Q4) (Moneyline|Spread|Total)$/,
  /^(Moneyline|Spread|Total)$/,
];

// Reach-the-count backstop for parlays that resolve SHORT of an explicit leg
// count. The model routinely under-delivers despite the prompt's REACH-N rule —
// a "- 9 leg alt" stops at one Alt Spread per game and ignores the alt-total
// ladder; a single-game "15 leg ... 1 quarter ... half time ... alt spreads"
// stops at the period spreads/totals and skips the period MONEYLINES and the
// full-game ALT SPREAD the user explicitly asked for. Prompt-only reach-N is
// unreliable, so this DETERMINISTICALLY fills toward `target` from the SAME real
// context — never fabricating: every added leg is a real `realOdds` entry.
// `order` is an ordered list of market-label matchers (ALT_BACKFILL_ORDER /
// PERIOD_BACKFILL_ORDER); each pass adds one leg per (game, market-family),
// honoring the SAME exact-leg + period-scoped anti-correlation dedup parsePicks
// uses, and — when `altSign` is set — the requested odds sign. Never exceeds
// `target`; returns the list unchanged when already at/over target or no
// eligible rungs remain.
export function backfillPicks(
  existing: ParsedPick[],
  realOdds: RealOddsLike[],
  gameMeta: GameMeta[],
  opts: { target: number; order: RegExp[]; altSign?: "plus" | "minus" | null },
): ParsedPick[] {
  const { target, order, altSign = null } = opts;
  if (existing.length >= target) return existing;
  const out = [...existing];
  // (game, market-family) keys already used by GAME-LEVEL legs, so we never stack
  // a second same-family side on the same game (marketFamily is period-scoped, so
  // Q1/1H/2H/full-game spreads stay distinct). Props are excluded, exactly like
  // parsePicks' anti-correlation guard.
  const famSeen = new Set(
    out
      .filter((p) => !p.isProp)
      .map((p) => `${norm(p.game)}|${marketFamily(p.market)}`),
  );
  // Exact-leg keys so a backfill rung can never duplicate an existing card.
  const legSeen = new Set(
    out.map((p) => `${p.game}|${p.market}|${p.pick}`.toLowerCase()),
  );
  const signOk = (odds: number) =>
    altSign == null ? true : altSign === "plus" ? odds > 0 : odds < 0;
  for (const matcher of order) {
    for (const e of realOdds) {
      if (out.length >= target) return out;
      if (!matcher.test(e.market)) continue;
      if (typeof e.odds !== "number" || !signOk(e.odds)) continue;
      const famKey = `${norm(e.game)}|${marketFamily(e.market)}`;
      if (famSeen.has(famKey)) continue;
      const legKey = `${e.game}|${e.market}|${e.pick}`.toLowerCase();
      if (legSeen.has(legKey)) continue;
      famSeen.add(famKey);
      legSeen.add(legKey);
      out.push(
        enrichPickMeta(
          {
            game: e.game,
            market: e.market,
            pick: e.pick,
            odds: e.odds,
            sport: e.sport,
            startsAt: e.startsAt ?? null,
            // Honest note: a backfilled leg is a real posted line added to reach
            // the requested ticket size — NOT a model read. We never fabricate an
            // analytical edge it doesn't have; we just say why it's on the slip.
            edge:
              "Added to round out your requested ticket size — this is a real posted line from tonight's board, not a separate model edge.",
          },
          gameMeta,
        ),
      );
    }
  }
  return out;
}

// Reach-the-count PROP backfill — the prop analogue of backfillPicks, used by the
// today-only salvage when an "N-leg parlay" refusal (or an all-filtered ticket)
// leaves only a couple of game-level mains on one match. Appends REAL posted
// player / game props (never invented) for the SAME today games until the ticket
// reaches `target`, so the salvage ticket isn't all moneylines/spreads on one
// game. One leg per (game, player, market) — never two rungs of the same prop.
// Today-gating + each leg's real kickoff come from `realToday` (the salvage's
// already-`startsTodayUpcoming`-filtered realOdds for the named sport): only props
// whose game appears there are eligible, so a tomorrow/started game's prop can
// never slip in. Each leg's odds are the rung closest to even money among that
// prop's real posted rungs (the most "main" line), skipping no-equity juice
// (<= -1000). The edge note is honest — added to reach the size, not a model read.
export function backfillProps(
  existing: ParsedPick[],
  propPool: PropPoolEntry[],
  realToday: RealOddsLike[],
  gameMeta: GameMeta[],
  opts: { target: number },
): ParsedPick[] {
  const { target } = opts;
  if (existing.length >= target) return existing;
  const out = [...existing];
  // Allowed games come from realToday (= the salvage's sport-filtered,
  // already-startsTodayUpcoming realOdds). For each game label we keep BOTH a
  // representative kickoff (for the leg's startsAt) AND the SET of calendar days
  // it occurs on. propPool can include non-today props (the server prop backfill
  // bypasses the today filter), so a game-label-only gate would let a repeated
  // matchup (series play) on a future date inherit today's slot. We close that by
  // date-matching each prop's OWN kickoff to an allowed day. Day-bucketing (not
  // exact timestamp) tolerates odds-vs-props feed jitter for the same event while
  // still excluding a different-date instance of the same matchup.
  const dayOf = (s?: string | null): string | null => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime())
      ? null
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const startsAtByGame = new Map<string, string | null>();
  const daysByGame = new Map<string, Set<string>>();
  for (const e of realToday) {
    const k = norm(e.game);
    if (!startsAtByGame.has(k)) startsAtByGame.set(k, e.startsAt ?? null);
    const day = dayOf(e.startsAt);
    if (day) {
      const set = daysByGame.get(k) ?? new Set<string>();
      set.add(day);
      daysByGame.set(k, set);
    }
  }
  const legSeen = new Set(
    out.map((p) => `${p.game}|${p.market}|${p.pick}`.toLowerCase()),
  );
  const ip = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
  // One entry per (game, player, market): the rung closest to even money among
  // the real posted rungs — never a deep longshot or a no-equity favorite.
  const byKey = new Map<string, PropPoolEntry>();
  for (const e of propPool) {
    const k = norm(e.game);
    if (!startsAtByGame.has(k)) continue; // named sport's allowed games only
    if (typeof e.odds !== "number" || e.odds <= -1000) continue;
    // Date guard: if we know both the prop's day and the game's allowed days,
    // the prop must fall on one of them — otherwise it's a same-label game on a
    // different date and must NOT be admitted (would be a fabricated kickoff).
    const propDay = dayOf(e.startsAt);
    const allowedDays = daysByGame.get(k);
    if (propDay && allowedDays && allowedDays.size > 0 && !allowedDays.has(propDay)) {
      continue;
    }
    const key = `${k}|${norm(e.player)}|${norm(e.marketLabel)}`;
    const cur = byKey.get(key);
    if (!cur || Math.abs(ip(e.odds) - 0.5) < Math.abs(ip(cur.odds) - 0.5)) {
      byKey.set(key, e);
    }
  }
  for (const e of byKey.values()) {
    if (out.length >= target) break;
    const pick =
      e.line != null
        ? `${e.player} ${e.side} ${e.line} ${e.marketLabel}`
        : `${e.player} ${e.marketLabel}`;
    const legKey = `${e.game}|${e.marketLabel}|${pick}`.toLowerCase();
    if (legSeen.has(legKey)) continue;
    legSeen.add(legKey);
    out.push(
      enrichPickMeta(
        {
          game: e.game,
          market: e.marketLabel,
          pick,
          odds: e.odds,
          sport: e.sport,
          isProp: true,
          // Prefer the prop's OWN real kickoff; fall back to the game's
          // representative kickoff only when the feed didn't carry one.
          startsAt: e.startsAt ?? startsAtByGame.get(norm(e.game)) ?? null,
          headshot: e.headshot ?? null,
          teamAbbr: e.teamAbbr ?? null,
          player: e.player,
          athleteId: e.athleteId ?? null,
          propMarketKey: e.marketKey,
          propLine: e.line,
          propSide: e.side,
          edge:
            "Added to round out your requested ticket size — this is a real posted line from tonight's board, not a separate model edge.",
        },
        gameMeta,
      ),
    );
  }
  return out;
}
