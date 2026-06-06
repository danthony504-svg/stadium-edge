import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useBetSlip } from "@/context/BetSlipContext";
import { formatAmerican, formatGameTime } from "@/lib/format";
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
  altOptions?: {
    cushion?: { side: string; line: number; odds: number; pick: string };
    value?: { side: string; line: number; odds: number; pick: string };
  };
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
function siblingLegKeys(parent: ParsedPick, keepPick: string): string[] {
  return [
    parent.pick,
    parent.altOptions?.cushion?.pick,
    parent.altOptions?.value?.pick,
  ]
    .filter((p): p is string => !!p && p !== keepPick)
    .map((p) => `${parent.game}|${parent.market}|${p}`.toLowerCase());
}

// A compact, TAPPABLE chip for an alternate prop rung (safer cushion or
// higher-payout value). Shows the REAL posted side+line and REAL odds, and
// adds/removes that exact rung as its own slip leg on tap. The rung is a real
// posted line from the same player+market+side ladder — never invented — so it
// flows through addLeg() exactly like the main pick. It's a DISTINCT leg from
// the main (different line), so the user can keep the main or swap to a rung.
function AltRungChip({
  tone,
  rung,
  parent,
}: {
  tone: "cushion" | "value";
  rung: { side: string; line: number; odds: number; pick: string };
  parent: ParsedPick;
}) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const added = hasLeg(parent.game, parent.market, rung.pick);
  const s = rung.side === "Over" ? "O" : rung.side === "Under" ? "U" : rung.side;
  const fg = added ? colors.primaryForeground : undefined;
  const onPress = () => {
    if (added) {
      removeLeg(`${parent.game}|${parent.market}|${rung.pick}`.toLowerCase());
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      // Mutually exclusive with the main pick + the other rung — selecting this
      // line clears any sibling line already on the slip (one leg per card).
      for (const k of siblingLegKeys(parent, rung.pick)) removeLeg(k);
      const ok = addLeg({
        game: parent.game,
        market: parent.market,
        pick: rung.pick,
        odds: rung.odds,
        sport: parent.sport,
      });
      Haptics.impactAsync(
        ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    }
  };
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 8,
        backgroundColor: added ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: added ? colors.primary : colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Feather
        name={added ? "check" : tone === "cushion" ? "shield" : "trending-up"}
        size={11}
        color={fg ?? colors.mutedForeground}
      />
      <Text style={{ color: fg ?? colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
        {tone === "cushion" ? "Safer" : "Value"}
      </Text>
      <Text style={{ color: fg ?? colors.foreground, fontFamily: FONT.bold, fontSize: 11 }}>
        {`${s} ${rung.line}`}
      </Text>
      <Text style={{ color: fg ?? colors.accent, fontFamily: FONT.bold, fontSize: 11 }}>
        {formatAmerican(rung.odds)}
      </Text>
    </Pressable>
  );
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
      {formatGameTime(pick.startsAt) ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: -3 }}>
          <Feather name="clock" size={11} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
            {formatGameTime(pick.startsAt)}
          </Text>
        </View>
      ) : null}

      {pick.altOptions && (pick.altOptions.cushion || pick.altOptions.value) ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {pick.altOptions.cushion ? (
            <AltRungChip tone="cushion" rung={pick.altOptions.cushion} parent={pick} />
          ) : null}
          {pick.altOptions.value ? (
            <AltRungChip tone="value" rung={pick.altOptions.value} parent={pick} />
          ) : null}
        </View>
      ) : null}

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
  const pm = m.match(/\b(1h|2h|h1|h2|q1|q2|q3|q4)\b/);
  const period = pm ? `${pm[1].replace("h1", "1h").replace("h2", "2h")}:` : "";
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
