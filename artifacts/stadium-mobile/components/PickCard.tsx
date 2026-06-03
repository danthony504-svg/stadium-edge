import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBetSlip } from "@/context/BetSlipContext";
import { formatAmerican } from "@/lib/format";
import { Badge, FONT } from "@/components/ui";

export type ParsedPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  edge?: string;
  sport?: string;
};

export function PickCard({ pick }: { pick: ParsedPick }) {
  const colors = useColors();
  const { addLeg, hasLeg } = useBetSlip();
  const added = hasLeg(pick.game, pick.market, pick.pick);

  const onAdd = () => {
    const ok = addLeg(pick);
    Haptics.impactAsync(
      ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Badge label={pick.market} tone="primary" />
        <Text style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 15 }}>
          {formatAmerican(pick.odds)}
        </Text>
      </View>

      <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
        {pick.pick}
      </Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 12 }}>
        {pick.game}
      </Text>

      {pick.edge ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.body,
            fontSize: 12,
            lineHeight: 17,
          }}
        >
          {pick.edge}
        </Text>
      ) : null}

      <Pressable
        onPress={onAdd}
        disabled={added}
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
          name={added ? "check" : "plus"}
          size={15}
          color={added ? colors.success : colors.primaryForeground}
        />
        <Text
          style={{
            color: added ? colors.success : colors.primaryForeground,
            fontFamily: FONT.bold,
            fontSize: 13,
          }}
        >
          {added ? "Added to slip" : "Add to slip"}
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
const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[^a-z0-9+\-. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const gameTokens = (s: string) =>
  new Set(norm(s).split(" ").filter((w) => /[a-z]/.test(w) && w.length > 2));

function sameGame(a: string, b: string): boolean {
  const ta = gameTokens(a);
  const tb = gameTokens(b);
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits >= 2; // two shared team tokens = same fixture
}

// Collapse market wording to a family so an AI "Spread" pick can only ever
// resolve to a real Spread line (never accidentally to a Moneyline entry).
function marketFamily(s: string): string {
  const m = norm(s);
  if (/spread|run ?line|puck ?line/.test(m)) return "spread";
  if (/total|over|under|o\/u/.test(m)) return "total";
  if (/money|h2h|\bml\b/.test(m)) return "moneyline";
  return m;
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

export function parsePicks(text: string, realOdds: ParsedPick[] | RealOddsLike[]): ParsedPick[] {
  const pool = realOdds as RealOddsLike[];
  if (!pool || pool.length === 0) return []; // fail-closed: no real data -> no cards

  const lines = text.split("\n");
  const out: ParsedPick[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^(?:PICK|ALT)\s*:\s*(.+)$/i);
    if (!m) continue;
    const parts = m[1].split("|").map((p) => p.trim());
    if (parts.length < 4) continue;
    const [game, market, selection] = parts;

    // Resolve to the real odds entry: same game + same market family +
    // matching real selection.
    const fam = marketFamily(market);
    const candidates = pool.filter(
      (e) => sameGame(e.game, game) && marketFamily(e.market) === fam,
    );
    let best: RealOddsLike | null = null;
    let bestScore = 0;
    for (const e of candidates) {
      if (!selectionMatches(e.pick, selection)) continue;
      const et = norm(e.pick).split(" ").filter(Boolean);
      const at = new Set(norm(selection).split(" ").filter(Boolean));
      const score = et.filter((t) => at.has(t)).length / Math.max(1, et.length);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) continue; // selection/price not in the real pool -> drop

    let edge: string | undefined;
    const em = lines[i + 1]?.trim().match(/^EDGE\s*:\s*(.+)$/i);
    if (em) edge = em[1].trim();

    // Canonical, real fields only (real odds, real market, real selection).
    const id = `${best.game}|${best.market}|${best.pick}`.toLowerCase();
    if (out.some((p) => `${p.game}|${p.market}|${p.pick}`.toLowerCase() === id)) continue;
    out.push({
      game: best.game,
      market: best.market,
      pick: best.pick,
      odds: best.odds,
      sport: best.sport,
      edge,
    });
  }
  return out;
}

type RealOddsLike = {
  sport?: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
};
