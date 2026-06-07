import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  getPlayerHistory,
  propMarketLabel,
  type PlayerProp,
} from "@/lib/api";
import { formatAmerican, formatGameTime } from "@/lib/format";
import {
  ambiguousLabels,
  confidenceTier,
  hitRate,
  impliedPct,
  recentValues,
  selectRungs,
  varianceTier,
} from "@/lib/propAnalytics";

type RungKey = "safe" | "best" | "value";

// One polished player-prop card matching the design mockup: market chip + big
// odds, the player headline, colored Away @ Home teams, game time, a
// Safe/Best/Value selector built from REAL alternate rungs, a stat grid
// (Model / Implied / Edge / Confidence / Variance) and an AI Edge expander.
//
// HONESTY: every number is derived from the player's REAL game log and the
// book's REAL posted prices. Model / Edge / Confidence / Variance are hidden
// when there's no usable game log — never fabricated. Implied % comes straight
// from the selected price and is always shown.
export function PropCard({
  prop,
  alts,
  gameLabel,
  startsAt,
  sport,
  onOpen,
}: {
  prop: PlayerProp;
  alts: PlayerProp[];
  gameLabel: string;
  startsAt: string;
  sport: string;
  onOpen: () => void;
}) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const [selected, setSelected] = useState<RungKey>("best");
  const [showEdge, setShowEdge] = useState(false);

  const label = propMarketLabel(prop.market);
  const isSoccer = sport === "soccer";

  // The full real ladder for this (player, market): the main line plus every
  // alternate rung the book posts. Used to choose the Safe/Best/Value rungs.
  const rungs = useMemo(() => selectRungs([prop, ...alts]), [prop, alts]);

  // The active rung drives the big odds, the headline line, and the add target.
  // Fall back to whichever slot exists if the chosen one isn't posted.
  const active =
    (selected === "safe" && rungs.safe) ||
    (selected === "value" && rungs.value) ||
    rungs.best ||
    prop;
  const activeLine = active.line ?? prop.line;
  const activeOver = active.overPrice ?? prop.overPrice ?? null;

  // Real game log — same query key as the props sheet so the cache is shared
  // (opening the sheet after viewing the card is instant). Enabled only when we
  // have a real source: an ESPN athleteId, or a soccer player name (StatMuse).
  const hasHistorySource = !!prop.athleteId || (isSoccer && !!prop.player);
  const historyQ = useQuery({
    queryKey: ["player-history", sport, prop.athleteId ?? null, isSoccer ? prop.player : null],
    enabled: hasHistorySource,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      getPlayerHistory(
        { sport, athleteId: prop.athleteId ?? null, name: isSoccer ? prop.player : null },
        signal,
      ),
  });

  // Derive the real analytics from the game log + posted price.
  const analytics = useMemo(() => {
    const ambiguous = ambiguousLabels(historyQ.data?.labels);
    const values = recentValues(prop.market, historyQ.data?.recent, ambiguous, 10);
    const hr = hitRate(values, activeLine ?? null);
    const implied = impliedPct(activeOver);
    const edge = hr && implied != null ? hr.pct - implied : null;
    const variance = varianceTier(values);
    const confidence = hr ? confidenceTier(values.length, edge ?? 0) : null;
    return { values, hr, implied, edge, variance, confidence };
  }, [historyQ.data, prop.market, activeLine, activeOver]);

  // Canonical pick string — matches the web app + the rest of the app so the
  // slip dedupes correctly. The side token is always present (yes/no markets
  // have no line, so lineTxt is "").
  const lineTxt = activeLine != null ? ` ${activeLine}` : "";
  const overPick = `${prop.player} Over${lineTxt} ${label}`;
  const underPick = `${prop.player} Under${lineTxt} ${label}`;
  const added = hasLeg(gameLabel, "Player Prop", overPick);

  const toggleAdd = () => {
    if (activeOver == null) return;
    if (added) {
      removeLeg(`${gameLabel}|Player Prop|${overPick}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    // Drop the opposite (Under at the same line) so the slip never holds both
    // sides of one prop, then add the Over at the active rung's real price.
    removeLeg(`${gameLabel}|Player Prop|${underPick}`.toLowerCase());
    const ok = addLeg({ game: gameLabel, market: "Player Prop", pick: overPick, odds: activeOver, sport });
    Haptics.impactAsync(ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  };

  // Teams: split "Away @ Home" → away in brand blue, home in red (per mockup).
  const [awayName, homeName] = useMemo(() => {
    const parts = gameLabel.split(" @ ");
    return [parts[0] ?? gameLabel, parts[1] ?? ""];
  }, [gameLabel]);

  const timeLabel = formatGameTime(startsAt);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 12,
      }}
    >
      {/* Header: market chip (tap → full breakdown) + big odds */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: "rgba(59,130,246,0.14)",
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 5,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Feather name="bar-chart-2" size={12} color={colors.primary} />
          <Text
            style={{
              color: colors.primary,
              fontFamily: FONT.bold,
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            {label}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 26 }}>
          {formatAmerican(activeOver)}
        </Text>
      </View>

      {/* Headline */}
      <Pressable onPress={onOpen}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 19 }}>
          {prop.player} Over{lineTxt} {label}
        </Text>
        {/* Teams + time */}
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 13 }}>{awayName}</Text>
          {homeName ? (
            <>
              <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}> @ </Text>
              <Text style={{ color: colors.destructive, fontFamily: FONT.semibold, fontSize: 13 }}>{homeName}</Text>
            </>
          ) : null}
        </View>
        {timeLabel ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
            <Feather name="clock" size={11} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>{timeLabel}</Text>
          </View>
        ) : null}
      </Pressable>

      {/* Safe • Best • Value rung selector (only rungs the book actually posts) */}
      <RungSelector rungs={rungs} selected={selected} onSelect={setSelected} />

      {/* Stat grid */}
      <StatGrid
        loading={hasHistorySource && historyQ.isLoading}
        modelPct={analytics.hr?.pct ?? null}
        impliedPct={analytics.implied}
        edge={analytics.edge}
        confidence={analytics.confidence}
        variance={analytics.variance?.tier ?? null}
      />

      {/* AI Edge expander */}
      <View style={{ gap: 8 }}>
        <Pressable
          onPress={() => setShowEdge((s) => !s)}
          hitSlop={6}
          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <Feather name="zap" size={13} color={colors.primary} />
          <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12, flex: 1 }}>
            AI Edge
          </Text>
          <Feather name={showEdge ? "chevron-up" : "chevron-down"} size={15} color={colors.primary} />
        </Pressable>
        {showEdge ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12, lineHeight: 18 }}>
            {edgeNarrative({
              player: prop.player,
              label,
              line: activeLine ?? null,
              price: activeOver,
              hr: analytics.hr,
              edge: analytics.edge,
              implied: analytics.implied,
              variance: analytics.variance?.tier ?? null,
              hasSource: hasHistorySource,
              loading: historyQ.isLoading,
            })}
          </Text>
        ) : null}
      </View>

      {/* Add to slip */}
      <Pressable
        onPress={toggleAdd}
        disabled={activeOver == null}
        style={({ pressed }) => ({
          borderRadius: 12,
          paddingVertical: 13,
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "center",
          gap: 7,
          backgroundColor: added ? "rgba(59,130,246,0.16)" : colors.primary,
          borderWidth: 1,
          borderColor: added ? colors.primary : colors.primary,
          opacity: activeOver == null ? 0.4 : pressed ? 0.85 : 1,
        })}
      >
        <Feather
          name={added ? "check" : "plus"}
          size={16}
          color={added ? colors.primary : colors.primaryForeground}
        />
        <Text
          style={{
            color: added ? colors.primary : colors.primaryForeground,
            fontFamily: FONT.bold,
            fontSize: 14,
          }}
        >
          {added ? "In slip" : "Add to slip"}
        </Text>
      </Pressable>
    </View>
  );
}

// Build a short, REAL narrative for the AI Edge expander — only from numbers we
// actually have. Fails closed to an honest "not enough data" line.
function edgeNarrative(a: {
  player: string;
  label: string;
  line: number | null;
  price: number | null;
  hr: { hits: number; total: number; pct: number } | null;
  edge: number | null;
  implied: number | null;
  variance: "Low" | "Medium" | "High" | null;
  hasSource: boolean;
  loading: boolean;
}): string {
  if (a.loading) return "Crunching the recent game log…";
  if (!a.hr) {
    return a.hasSource
      ? "Not enough recent game data to model this line yet."
      : "No game log available for this player, so there's no model read — the implied price is shown as posted.";
  }
  const lineTxt = a.line != null ? `${a.line} ${a.label.toLowerCase()}` : a.label.toLowerCase();
  const parts: string[] = [];
  parts.push(
    `${a.player} has cleared ${lineTxt} in ${a.hr.hits} of his last ${a.hr.total} games (${a.hr.pct}%).`,
  );
  if (a.edge != null && a.implied != null) {
    if (a.edge > 0) parts.push(`That's a +${a.edge}% edge over the ${formatAmerican(a.price)} price (${a.implied}% implied).`);
    else if (a.edge < 0) parts.push(`That's ${a.edge}% vs the ${formatAmerican(a.price)} price (${a.implied}% implied) — the market is ahead here.`);
    else parts.push(`That lines up almost exactly with the ${a.implied}% implied by the ${formatAmerican(a.price)} price.`);
  }
  if (a.variance === "High") parts.push("His output swings a lot game to game, so treat it as a volatile spot.");
  else if (a.variance === "Low") parts.push("His output is steady game to game, which makes the read more reliable.");
  return parts.join(" ");
}

// Three real rungs: Safe (lower line / easier), Best (main line), Value (higher
// line / bigger payout). Only renders the slots the book posts.
function RungSelector({
  rungs,
  selected,
  onSelect,
}: {
  rungs: { safe: PlayerProp | null; best: PlayerProp | null; value: PlayerProp | null };
  selected: RungKey;
  onSelect: (k: RungKey) => void;
}) {
  const colors = useColors();
  const items: { key: RungKey; label: string; icon: keyof typeof Feather.glyphMap; rung: PlayerProp | null }[] = [
    { key: "safe", label: "Safe", icon: "shield", rung: rungs.safe },
    { key: "best", label: "Best", icon: "star", rung: rungs.best },
    { key: "value", label: "Value", icon: "trending-up", rung: rungs.value },
  ];
  const visible = items.filter((it) => it.rung && it.rung.overPrice != null);
  // Nothing to choose from (single posted rung / no Over price) → no selector.
  if (visible.length <= 1) return null;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {visible.map((it) => {
        const isActive = selected === it.key;
        return (
          <Pressable
            key={it.key}
            onPress={() => onSelect(it.key)}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: isActive ? colors.primary : colors.border,
              backgroundColor: isActive ? "rgba(59,130,246,0.14)" : colors.surface,
              paddingVertical: 8,
              alignItems: "center",
              gap: 2,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name={it.icon} size={11} color={isActive ? colors.primary : colors.mutedForeground} />
              <Text
                style={{
                  color: isActive ? colors.primary : colors.mutedForeground,
                  fontFamily: FONT.bold,
                  fontSize: 10,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                {it.label}
              </Text>
            </View>
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 12 }}>
              O{it.rung!.line}
            </Text>
            <Text style={{ color: isActive ? colors.primary : colors.foreground, fontFamily: FONT.bold, fontSize: 13 }}>
              {formatAmerican(it.rung!.overPrice)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Five-cell stat grid. Implied is always available; Model / Edge / Confidence /
// Variance show "—" until the real game log resolves (and stay "—" if a player
// has no usable log — never fabricated).
function StatGrid({
  loading,
  modelPct,
  impliedPct,
  edge,
  confidence,
  variance,
}: {
  loading: boolean;
  modelPct: number | null;
  impliedPct: number | null;
  edge: number | null;
  confidence: "Low" | "Medium" | "High" | null;
  variance: "Low" | "Medium" | "High" | null;
}) {
  const colors = useColors();
  const dash = loading ? "…" : "—";
  const edgeColor = edge == null ? colors.mutedForeground : edge > 0 ? colors.success : edge < 0 ? colors.destructive : colors.mutedForeground;
  const edgeTxt = edge == null ? dash : `${edge > 0 ? "+" : ""}${edge}%`;
  const tierColor = (t: "Low" | "Medium" | "High" | null, kind: "confidence" | "variance") => {
    if (t == null) return colors.mutedForeground;
    if (kind === "confidence") return t === "High" ? colors.success : t === "Medium" ? colors.primary : colors.mutedForeground;
    return t === "High" ? colors.destructive : t === "Medium" ? colors.warning : colors.success;
  };
  const cells: { label: string; value: string; color: string; icon: keyof typeof Feather.glyphMap }[] = [
    { label: "Model", value: modelPct == null ? dash : `${modelPct}%`, color: colors.foreground, icon: "pie-chart" },
    { label: "Implied", value: impliedPct == null ? dash : `${impliedPct}%`, color: colors.foreground, icon: "percent" },
    { label: "Edge", value: edgeTxt, color: edgeColor, icon: "trending-up" },
    { label: "Conf", value: confidence ?? dash, color: tierColor(confidence, "confidence"), icon: "shield" },
    { label: "Var", value: variance ?? dash, color: tierColor(variance, "variance"), icon: "activity" },
  ];
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: 10,
      }}
    >
      {cells.map((c, i) => (
        <View
          key={c.label}
          style={{
            flex: 1,
            alignItems: "center",
            gap: 3,
            borderLeftWidth: i === 0 ? 0 : 1,
            borderLeftColor: colors.border,
          }}
        >
          <Feather name={c.icon} size={11} color={colors.mutedForeground} />
          <Text style={{ color: c.color, fontFamily: FONT.bold, fontSize: 13 }}>{c.value}</Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 9, letterSpacing: 0.3, textTransform: "uppercase" }}>
            {c.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
