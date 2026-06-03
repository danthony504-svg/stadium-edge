import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBetSlip } from "@/context/BetSlipContext";
import { formatAmerican } from "@/lib/format";
import type { GameMeta, PropPoolEntry } from "@/lib/api";
import { Badge, FONT } from "@/components/ui";

export type ParsedPick = {
  game: string;
  market: string;
  pick: string;
  odds: number;
  edge?: string;
  sport?: string;
  isProp?: boolean;
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
};

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function PickCard({ pick }: { pick: ParsedPick }) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const added = hasLeg(pick.game, pick.market, pick.pick);
  const [edgeOpen, setEdgeOpen] = useState(false);

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
const norm = (s: string) =>
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
function matchProp(
  game: string,
  market: string,
  selection: string,
  propPool: PropPoolEntry[],
): ParsedPick | null {
  const side = sideOf(selection);
  const selTokens = new Set(norm(selection).split(" ").filter(Boolean));
  const mkN = norm(market);
  let best: PropPoolEntry | null = null;
  let bestScore = -1;
  for (const e of propPool) {
    if (!sameGame(e.game, game)) continue;
    const ln = norm(e.player).split(" ").filter(Boolean).pop() || "";
    if (!ln || !selTokens.has(ln)) continue; // player must be named
    if (e.line != null) {
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
  };
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
  // Props show a player headshot, never a team logo — leave them alone even when
  // the headshot is null (feed miss) so we never paint a team logo on a prop.
  if (pick.isProp) return pick;
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

export function parsePicks(
  text: string,
  realOdds: ParsedPick[] | RealOddsLike[],
  propPool: PropPoolEntry[] = [],
  gameMeta: GameMeta[] = [],
): ParsedPick[] {
  const pool = (realOdds as RealOddsLike[]) || [];
  if (pool.length === 0 && propPool.length === 0) return []; // fail-closed: no real data -> no cards

  const lines = text.split("\n");
  const out: ParsedPick[] = [];

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
      resolved = matchProp(game, market, selection, propPool);
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
          },
          gameMeta,
        );
      }
    }

    if (!resolved) continue; // selection/price not in any real pool -> drop

    const em = lines[i + 1]?.trim().match(/^EDGE\s*:\s*(.+)$/i);
    if (em) resolved.edge = em[1].trim();

    // Canonical, real fields only (real odds, real market, real selection).
    const id = `${resolved.game}|${resolved.market}|${resolved.pick}`.toLowerCase();
    if (out.some((p) => `${p.game}|${p.market}|${p.pick}`.toLowerCase() === id)) continue;
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
};
