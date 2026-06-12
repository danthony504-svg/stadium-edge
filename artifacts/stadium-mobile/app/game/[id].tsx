import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiPickCard } from "@/components/AiPickCard";
import { GamePropsSection } from "@/components/GamePropsSection";
import { parsePicks, sameGame, type ParsedPick } from "@/components/PickCard";
import { SlipBar, useSlipClearance } from "@/components/SlipBar";
import { TennisPlayerSheet } from "@/components/TennisPlayerSheet";
import { Badge, ErrorState, FONT, Loading, PrimaryButton } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { buildChatContext, getFightAnalysis, getOdds, getTennisMatchup, streamChat, type FightAnalysis, type OddsGame, type OddsMarket, type TennisMatchup, type TennisPlayer } from "@/lib/api";
import { formatAmerican } from "@/lib/format";

const nickname = (full: string) => (full || "").split(/\s+/).filter(Boolean).pop() || full;

const PERIOD_LABEL: Record<string, string> = {
  h1: "1H",
  h2: "2H",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
};

const BASE_LABEL: Record<"h2h" | "spreads" | "totals", string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};

type Decoded = { base: "h2h" | "spreads" | "totals"; period: string; alt: boolean };

// Decode an Odds API market key into its base market, period label, and whether
// it's an alternate ladder. Returns null for keys we don't render. The feed
// (api-server odds.ts) sends h2h/spreads/totals, alternate_spreads/_totals, the
// per-period h2h/spreads/totals (h1/h2/q1–q4), and alternate_*_h1.
function decodeMarket(key: string): Decoded | null {
  if (key === "h2h" || key === "spreads" || key === "totals") {
    return { base: key, period: "", alt: false };
  }
  if (key === "alternate_spreads") return { base: "spreads", period: "", alt: true };
  if (key === "alternate_totals") return { base: "totals", period: "", alt: true };
  let m = key.match(/^alternate_(spreads|totals)_(h1|h2|q1|q2|q3|q4)$/);
  if (m) return { base: m[1] as "spreads" | "totals", period: PERIOD_LABEL[m[2]], alt: true };
  m = key.match(/^(h2h|spreads|totals)_(h1|h2|q1|q2|q3|q4)$/);
  if (m) return { base: m[1] as Decoded["base"], period: PERIOD_LABEL[m[2]], alt: false };
  return null;
}

// Title doubles as the slip market string, kept in lockstep with
// buildPicksFromOdds (api.ts) — e.g. "Alt Spread", "1H Total", "Q2 Moneyline",
// "1H Alt Spread" — so a leg added here dedupes with the same leg from the Coach.
function marketTitle(d: Decoded): string {
  return [d.period, d.alt ? "Alt" : "", BASE_LABEL[d.base]].filter(Boolean).join(" ");
}

// The pick string depends ONLY on the base market (period/alt don't change it),
// matching buildPicksFromOdds exactly for slip dedupe parity.
function pickFor(base: Decoded["base"], name: string, point?: number | null): string {
  if (base === "h2h") return `${nickname(name)} ML`;
  if (base === "spreads") {
    const pt = point == null ? "" : ` ${point > 0 ? "+" : ""}${point}`;
    return `${nickname(name)}${pt}`;
  }
  const pt = point == null ? "" : ` ${point}`;
  return `${name}${pt}`.trim();
}

function MarketBlock({ game, market, decoded }: { game: OddsGame; market: OddsMarket; decoded: Decoded }) {
  const colors = useColors();
  const { addLeg, removeLeg, hasLeg } = useBetSlip();
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
  const title = marketTitle(decoded);
  // Main full-game markets stay expanded; alternate ladders and period markets
  // collapse (they can carry many rungs) so the screen opens tidy.
  const collapsible = decoded.alt || decoded.period !== "";
  const [open, setOpen] = useState(!collapsible);

  // Alt ladders read low→high per side; mains keep the feed's order.
  const outcomes = useMemo(() => {
    const list = [...(market.outcomes ?? [])];
    if (decoded.base === "h2h") return list;
    return list.sort((a, b) => {
      const sa = decoded.base === "totals" ? a.name : nickname(a.name);
      const sb = decoded.base === "totals" ? b.name : nickname(b.name);
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (a.point ?? 0) - (b.point ?? 0);
    });
  }, [market.outcomes, decoded.base]);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
        gap: 10,
      }}
    >
      <Pressable
        disabled={!collapsible}
        onPress={() => collapsible && setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <Text style={{ color: colors.foreground, fontFamily: FONT.displaySemi, fontSize: 15 }}>{title}</Text>
        {collapsible ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 11 }}>
              {outcomes.length} line{outcomes.length === 1 ? "" : "s"}
            </Text>
            <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
          </View>
        ) : null}
      </Pressable>
      {open
        ? outcomes.map((o, idx) => {
        const pick = pickFor(decoded.base, o.name, o.point);
        const mk = title;
        const added = hasLeg(gameLabel, mk, pick);
        const best =
          o.books && o.books.length > 0
            ? o.books.reduce((a, b) => (b.price > a.price ? b : a))
            : null;
        return (
          <Pressable
            key={`${market.key}-${idx}`}
            onPress={() => {
              const id = `${gameLabel}|${mk}|${pick}`.toLowerCase();
              if (added) {
                // Tap an already-added line to unclick it.
                removeLeg(id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                return;
              }
              // One pick per market section: the rungs/sides in this block are
              // alternatives of the same bet (a game has ONE moneyline / spread /
              // total), so drop any other line already selected here before adding.
              for (let j = 0; j < outcomes.length; j++) {
                if (j === idx) continue;
                const oo = outcomes[j];
                const sibPick = pickFor(decoded.base, oo.name, oo.point);
                removeLeg(`${gameLabel}|${mk}|${sibPick}`.toLowerCase());
              }
              const ok = addLeg({ game: gameLabel, market: mk, pick, odds: o.price, sport: game.sport });
              Haptics.impactAsync(
                ok ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
              );
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: added ? "rgba(59,130,246,0.14)" : colors.surface,
              borderWidth: 1,
              borderColor: added ? colors.primary : colors.border,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                {pick}
              </Text>
              {best ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11, marginTop: 2 }}>
                  Best: {best.book} {formatAmerican(best.price)}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: added ? colors.primary : colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
              {formatAmerican(o.price)}
            </Text>
            <Feather
              name={added ? "check" : "plus"}
              size={16}
              color={added ? colors.success : colors.mutedForeground}
              style={{ marginLeft: 10 }}
            />
          </Pressable>
        );
          })
        : null}
    </View>
  );
}

// Resolve which side of THIS game a team pick is on, so its breakdown page can
// fetch that team's real history. Returns null for props and totals (which name
// no single team). The spread number (if any) is parsed off the pick text.
function pickedTeam(
  pick: ParsedPick,
  game: OddsGame,
): { name: string; opp: string; isHome: boolean; line: number | null } | null {
  if (pick.isProp) return null;
  const text = pick.pick.toLowerCase();
  if (/\b(over|under)\b/.test(text)) return null; // total — no single team
  const homeNick = (game.homeTeam.split(/\s+/).pop() ?? game.homeTeam).toLowerCase();
  const awayNick = (game.awayTeam.split(/\s+/).pop() ?? game.awayTeam).toLowerCase();
  const matchHome =
    text.includes(game.homeTeam.toLowerCase()) || (homeNick.length > 2 && text.includes(homeNick));
  const matchAway =
    text.includes(game.awayTeam.toLowerCase()) || (awayNick.length > 2 && text.includes(awayNick));
  if (!matchHome && !matchAway) return null;
  // Spread line like "-4.5" / "+3.5"; absent for moneyline.
  const m = pick.pick.match(/([+-]\d+(?:\.\d+)?)/);
  const line = m ? Number(m[1]) : null;
  if (matchHome && !matchAway)
    return { name: game.homeTeam, opp: game.awayTeam, isHome: true, line };
  if (matchAway && !matchHome)
    return { name: game.awayTeam, opp: game.homeTeam, isHome: false, line };
  return null; // ambiguous (both names present) — skip rather than guess
}

// AI-recommended picks scoped to THIS game. On demand (not on every open — each
// run is a real streaming AI call), it builds the same real-data context the
// Coach uses, asks for this one game's best bets (which game-locks the model to
// this matchup), then resolves the reply back to REAL odds via parsePicks. Cards
// carry the AI's reasoning note. Nothing is fabricated: an empty resolve just
// shows an honest "no defensible edges" message.
function AiGamePicks({ game }: { game: OddsGame }) {
  const colors = useColors();
  const router = useRouter();
  const gameLabel = `${game.awayTeam} @ ${game.homeTeam}`;
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState(false);
  const [picks, setPicks] = useState<ParsedPick[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    setTried(true);
    try {
      const { context, propPool, gameMeta } = await buildChatContext(
        [game.sport],
        [],
        controller.signal,
      );
      // Naming exactly one game game-locks the model to this matchup only.
      const full = await streamChat({
        messages: [
          {
            role: "user",
            content: `What are your best bets for ${gameLabel}? Give me a short reason for each.`,
          },
        ],
        context,
        onToken: () => {},
        signal: controller.signal,
      });
      const parsed = parsePicks(full, context.realOdds, propPool, gameMeta).filter((p) =>
        sameGame(p.game, gameLabel),
      );
      // Only commit if this is still the latest in-flight request (a refresh or
      // unmount aborts the previous controller and swaps abortRef).
      if (abortRef.current === controller) setPicks(parsed);
    } catch {
      if (abortRef.current === controller && !controller.signal.aborted) setError(true);
    } finally {
      if (abortRef.current === controller && !controller.signal.aborted) setLoading(false);
    }
  }, [game.sport, gameLabel]);

  // Abort any in-flight AI request when leaving the screen so it can't update
  // state after unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.5 }}>
          ★ AI RECOMMENDED
        </Text>
        {tried && !loading ? (
          <Pressable onPress={load} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Feather name="refresh-cw" size={13} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
              Refresh
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Analyzing this matchup…
          </Text>
        </View>
      ) : !tried ? (
        <PrimaryButton label="Get AI picks for this game" icon="zap" onPress={load} />
      ) : error ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Couldn’t reach the AI Coach. Try again.
          </Text>
          <PrimaryButton label="Retry" icon="refresh-cw" onPress={load} />
        </View>
      ) : picks.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13, lineHeight: 18 }}>
          No defensible edges in this game’s posted lines right now. Try the full Coach for a broader slate.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        >
          {picks.map((p, i) => {
            const team = pickedTeam(p, game);
            return (
              <AiPickCard
                key={`${p.game}|${p.pick}|${i}`}
                pick={p}
                onPressBreakdown={
                  team
                    ? () =>
                        router.push({
                          pathname: "/team-pick/[id]",
                          params: {
                            id: team.name,
                            team: team.name,
                            opp: team.opp,
                            isHome: team.isHome ? "1" : "0",
                            sport: game.sport,
                            market: p.market,
                            line: team.line != null ? String(team.line) : "",
                            odds: String(p.odds),
                            game: gameLabel,
                            startsAt: game.commenceTime ?? "",
                            pick: p.pick,
                          },
                        })
                    : undefined
                }
              />
            );
          })}
        </ScrollView>
      )}

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/coach",
            params: { prefill: `Give me your best bet for ${gameLabel} tonight` },
          })
        }
        hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
      >
        <Feather name="message-circle" size={13} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12 }}>
          Ask the Coach about this game
        </Text>
      </Pressable>
    </View>
  );
}

// Real UFC "Tale of the Tape" — both fighters' real ESPN records + career
// striking/grappling rates, plus the deterministic stronger-fighter lean and an
// upset badge when that fighter is also the betting dog. Honest-null cells (—)
// when ESPN carries no value; never fabricated. Renders nothing for non-UFC
// games or bouts with no resolvable data.
function FightTaleOfTape({ game }: { game: OddsGame }) {
  const colors = useColors();
  const [data, setData] = useState<FightAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    getFightAnalysis(game.awayTeam, game.homeTeam, controller.signal)
      .then((d) => {
        if (controller.signal.aborted) return;
        // Enrich the lean with the real betting-dog price from this game's h2h
        // pool so an upset (data-favored fighter = plus-money side) can be flagged.
        if (d?.lean?.side) {
          const h2h = game.markets?.find((m) => m.key === "h2h");
          // Normalize accents/punctuation/spacing before joining ESPN's lean side
          // to the odds-feed outcome name, so real upsets aren't missed on === .
          const nf = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
          const out = (h2h?.outcomes || []).find((o) => nf(o.name) === nf(d.lean!.side));
          if (out && typeof out.price === "number" && out.price >= 100) {
            d.lean.upset = { dogOdds: out.price };
          }
        }
        setData(d);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [game.awayTeam, game.homeTeam, game.markets]);

  if (loading) {
    return (
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: colors.radius,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          Loading fighter data…
        </Text>
      </View>
    );
  }

  if (!data || (!data.away?.record && !data.home?.record)) return null;

  const fa = data.away;
  const fh = data.home;
  const lean = data.lean;
  const aName = fa.resolvedName || game.awayTeam || "Away";
  const hName = fh.resolvedName || game.homeTeam || "Home";
  const fmtPct = (v: number | null) => (typeof v === "number" ? `${v}%` : "—");
  const fmtNum = (v: number | null) => (typeof v === "number" ? `${v}` : "—");
  const recStr = (f: FightAnalysis["away"]) =>
    f?.record ? `${f.record.wins}-${f.record.losses}-${f.record.draws}` : "—";
  const rows: { label: string; a: string; h: string }[] = [
    { label: "Record", a: recStr(fa), h: recStr(fh) },
    { label: "Win %", a: fa.record ? `${fa.record.winPct}%` : "—", h: fh.record ? `${fh.record.winPct}%` : "—" },
    { label: "Strike Acc.", a: fmtPct(fa.stats.strikeAccuracy), h: fmtPct(fh.stats.strikeAccuracy) },
    { label: "Sig. Strikes/min", a: fmtNum(fa.stats.strikeLPM), h: fmtNum(fh.stats.strikeLPM) },
    { label: "Finish % (KO/TKO)", a: fmtPct(fa.stats.finishPct), h: fmtPct(fh.stats.finishPct) },
    { label: "Takedowns/15min", a: fmtNum(fa.stats.takedownAvg), h: fmtNum(fh.stats.takedownAvg) },
    { label: "Takedown Acc.", a: fmtPct(fa.stats.takedownAccuracy), h: fmtPct(fh.stats.takedownAccuracy) },
    { label: "Sub. Attempts/15min", a: fmtNum(fa.stats.submissionAvg), h: fmtNum(fh.stats.submissionAvg) },
  ];
  const weightClass = fa.weightClass || fh.weightClass;

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
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.5 }}>
          TALE OF THE TAPE
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.5 }}>
          REAL CAREER DATA · ESPN
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14, textAlign: "right" }} numberOfLines={1}>
          {aName}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, paddingHorizontal: 10 }}>VS</Text>
        <Text style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }} numberOfLines={1}>
          {hName}
        </Text>
      </View>
      {weightClass ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, textAlign: "center", marginTop: -6, letterSpacing: 0.5 }}>
          {weightClass.toUpperCase()}
        </Text>
      ) : null}

      <View style={{ gap: 0 }}>
        {rows.map((r, i) => (
          <View
            key={r.label}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 7,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            <Text style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13, textAlign: "right" }}>
              {r.a}
            </Text>
            <Text style={{ width: 132, color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9.5, textAlign: "center", letterSpacing: 0.3 }}>
              {r.label.toUpperCase()}
            </Text>
            <Text style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
              {r.h}
            </Text>
          </View>
        ))}
      </View>

      {lean?.side ? (
        <View
          style={{
            backgroundColor: lean.upset ? "rgba(245,158,11,0.08)" : "rgba(16,185,129,0.08)",
            borderColor: lean.upset ? "rgba(245,158,11,0.5)" : "rgba(16,185,129,0.45)",
            borderWidth: 1,
            borderRadius: colors.radius,
            padding: 11,
            gap: 7,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.5 }}>
              DATA EDGE
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 14 }}>
              {lean.side}
            </Text>
            {lean.upset ? (
              <View style={{ backgroundColor: "rgba(245,158,11,0.18)", borderColor: "rgba(245,158,11,0.5)", borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ color: "#f59e0b", fontFamily: FONT.semibold, fontSize: 10, letterSpacing: 0.3 }}>
                  🚨 UPSET VALUE {formatAmerican(lean.upset.dogOdds)}
                </Text>
              </View>
            ) : null}
          </View>
          {lean.reasons?.length ? (
            <View style={{ gap: 4 }}>
              {lean.reasons.map((rsn, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 6 }}>
                  <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 12 }}>›</Text>
                  <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, lineHeight: 17 }}>
                    {rsn}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, textAlign: "center" }}>
          Too close to call on the available data.
        </Text>
      )}
    </View>
  );
}

// Real tennis matchup — both players' ESPN ATP/WTA ranking + country + season
// recent form (set scores) + any recent head-to-head. Every value comes from
// ESPN; missing values are honest-nulled (—), never fabricated. Renders nothing
// when neither player resolves to real data.
function TennisMatchupCard({ game }: { game: OddsGame }) {
  const colors = useColors();
  const [data, setData] = useState<TennisMatchup | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<{ name: string; fallback: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getTennisMatchup(game.awayTeam, game.homeTeam, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [game.awayTeam, game.homeTeam]);

  if (loading) {
    return (
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: colors.radius,
          padding: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          Loading player data…
        </Text>
      </View>
    );
  }

  const hasData = (p?: TennisPlayer | null) =>
    !!p && (p.rank != null || p.country != null || p.recentForm.length > 0);
  if (!data || (!hasData(data.away) && !hasData(data.home))) return null;

  const aw = data.away;
  const hm = data.home;
  const aName = aw.resolvedName || game.awayTeam || "Away";
  const hName = hm.resolvedName || game.homeTeam || "Home";
  const tour = aw.tour || hm.tour;
  const rankStr = (p: TennisPlayer) =>
    p.rank != null ? `${p.tour || tour || ""} #${p.rank}`.trim() : "Unranked";
  const formStr = (p: TennisPlayer) =>
    p.formSummary ? `${p.formSummary.wins}-${p.formSummary.losses}` : "—";

  const Side = ({ p, name, align }: { p: TennisPlayer; name: string; align: "left" | "right" }) => (
    <Pressable
      onPress={() => setSheet({ name: p.resolvedName || name, fallback: name })}
      style={({ pressed }) => ({
        flex: 1,
        gap: 2,
        alignItems: align === "right" ? "flex-end" : "flex-start",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text
          style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
      </View>
      {p.country ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
          {p.country}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: "rgba(56,189,248,0.12)",
          borderColor: "rgba(56,189,248,0.4)",
          borderWidth: 1,
          borderRadius: 6,
          paddingHorizontal: 7,
          paddingVertical: 2,
          marginTop: 2,
        }}
      >
        <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 11 }}>
          {rankStr(p)}
        </Text>
      </View>
    </Pressable>
  );

  const FormList = ({ p }: { p: TennisPlayer }) => (
    <View style={{ flex: 1, gap: 4 }}>
      {p.recentForm.length ? (
        p.recentForm.map((r, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor:
                  r.win === true
                    ? "rgba(16,185,129,0.18)"
                    : r.win === false
                      ? "rgba(239,68,68,0.16)"
                      : "rgba(148,163,184,0.16)",
              }}
            >
              <Text
                style={{
                  color: r.win === true ? "#10b981" : r.win === false ? "#ef4444" : colors.mutedForeground,
                  fontFamily: FONT.semibold,
                  fontSize: 9,
                }}
              >
                {r.win === true ? "W" : r.win === false ? "L" : "·"}
              </Text>
            </View>
            <Text
              style={{ flex: 1, color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}
              numberOfLines={1}
            >
              {r.opponent ? `vs ${nickname(r.opponent)}` : "—"}
              {r.score ? ` ${r.score}` : ""}
            </Text>
          </View>
        ))
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
          No recent results
        </Text>
      )}
    </View>
  );

  return (
    <>
    <TennisPlayerSheet
      name={sheet?.name ?? null}
      fallbackName={sheet?.fallback}
      visible={!!sheet}
      onClose={() => setSheet(null)}
    />
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
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.primary, fontFamily: FONT.display, fontSize: 13, letterSpacing: 0.5 }}>
          MATCHUP
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.5 }}>
          REAL DATA · ESPN {tour ? tour : "ATP/WTA"}
          {data.tournament ? ` · ${data.tournament}` : ""}
          {data.round ? ` · ${data.round}` : ""}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Side p={aw} name={aName} align="right" />
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, paddingTop: 4 }}>VS</Text>
        <Side p={hm} name={hName} align="left" />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 7,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13, textAlign: "right" }}>
          {formStr(aw)}
        </Text>
        <Text style={{ width: 132, color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 9.5, textAlign: "center", letterSpacing: 0.3 }}>
          RECENT FORM (W-L)
        </Text>
        <Text style={{ flex: 1, color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
          {formStr(hm)}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 14 }}>
        <FormList p={aw} />
        <FormList p={hm} />
      </View>

      {data.h2h && data.h2h.meetings.length ? (
        <View
          style={{
            backgroundColor: "rgba(56,189,248,0.06)",
            borderColor: "rgba(56,189,248,0.3)",
            borderWidth: 1,
            borderRadius: colors.radius,
            padding: 11,
            gap: 6,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 10, letterSpacing: 0.5 }}>
            RECENT HEAD-TO-HEAD (THIS SEASON)
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
            {hName} {data.h2h.homeWins}–{data.h2h.awayWins} {aName}
          </Text>
          {data.h2h.meetings.map((r, i) => (
            <Text key={i} style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 11 }}>
              {r.round ? `${r.round}: ` : ""}
              {r.win === true ? `${hName} won` : r.win === false ? `${aName} won` : "result n/a"}
              {r.score ? ` ${r.score}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
    </>
  );
}

export default function GameDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slipClearance = useSlipClearance();
  const router = useRouter();
  const { id, sport } = useLocalSearchParams<{ id: string; sport: string }>();
  const [tennisSheet, setTennisSheet] = useState<string | null>(null);

  const oddsQ = useQuery({
    queryKey: ["odds", sport],
    queryFn: ({ signal }) => getOdds(String(sport), signal),
    staleTime: 60_000,
    enabled: !!sport,
  });

  const game = (oddsQ.data ?? []).find((g) => g.id === id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Custom header */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 16, flex: 1 }} numberOfLines={1}>
          {game ? `${nickname(game.awayTeam)} @ ${nickname(game.homeTeam)}` : "Game"}
        </Text>
      </View>

      {oddsQ.isLoading ? (
        <Loading label="Loading markets…" />
      ) : oddsQ.isError ? (
        <ErrorState onRetry={() => oddsQ.refetch()} />
      ) : !game ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 14 }}>
            This game is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 + slipClearance, gap: 14 }}>
          <View style={{ gap: 6 }}>
            {game.sport === "tennis" ? (
              <>
                <Pressable
                  onPress={() => setTennisSheet(game.awayTeam)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
                    {game.awayTeam}
                  </Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>at</Text>
                <Pressable
                  onPress={() => setTennisSheet(game.homeTeam)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
                    {game.homeTeam}
                  </Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
                  {game.awayTeam}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>at</Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 22 }}>
                  {game.homeTeam}
                </Text>
              </>
            )}
            <Badge label={new Date(game.commenceTime).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} tone="muted" />
          </View>

          <AiGamePicks game={game} />

          {(game.sport === "ufc" || game.sport === "mma") ? <FightTaleOfTape game={game} /> : null}

          {game.sport === "tennis" ? <TennisMatchupCard game={game} /> : null}


          {(() => {
            // Decode + drop unrenderable keys, then order: full-game mains first,
            // full-game alt ladders next, period markets last.
            const blocks = game.markets
              .map((m) => ({ m, d: decodeMarket(m.key) }))
              .filter((x): x is { m: OddsMarket; d: Decoded } => x.d != null);
            const rank = (d: Decoded) => (d.period === "" && !d.alt ? 0 : d.period === "" ? 1 : 2);
            blocks.sort((a, b) => rank(a.d) - rank(b.d));
            return blocks.map(({ m, d }) => (
              <MarketBlock key={m.key} game={game} market={m} decoded={d} />
            ));
          })()}

          <GamePropsSection game={game} />
        </ScrollView>
      )}
      {/* Tap a tennis player name (header) to open their stats sheet. */}
      <TennisPlayerSheet
        name={tennisSheet}
        visible={!!tennisSheet}
        onClose={() => setTennisSheet(null)}
      />
      {/* Floating slip popup — this is a root-stack screen (outside the tab
          layout), so render its own instance to overlay this screen. */}
      <SlipBar />
    </View>
  );
}
