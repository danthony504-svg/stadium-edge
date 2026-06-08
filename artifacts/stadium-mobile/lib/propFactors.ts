// "Things to weigh before betting" cards for the prop detail page.
//
// HONESTY NOTE: cards come in two flavours and BOTH are honest.
//   1. REAL cards — built only when the page passes in `real` signals that were
//      computed from live feeds (the player's own game log, the opposing
//      probable starter, his platoon split, the ballpark + weather). Every
//      number printed here is a real recorded value or a deterministic
//      derivation of one — never an estimate or a guess. Any field the feed
//      didn't carry is simply omitted.
//   2. GENERIC cards — evergreen guidance ("check the starting pitcher",
//      "confirm the lineup") used as the fallback when a real signal isn't
//      available (data missing, off-season, a sport we don't enrich yet). These
//      assert NO stat value, so there is nothing here that could be fabricated.
//
// Cards may be personalized with names that are ALREADY known and REAL: the
// player's name and the two team names parsed from the matchup. When a name
// can't be resolved the card falls back to a neutral noun.

export type FactorTier = "critical" | "important" | "useful";

export type PropFactor = {
  tier: FactorTier;
  emoji: string;
  title: string;
  body: string;
};

// REAL, already-computed signals for this exact prop. Everything is nullable so
// the cards degrade gracefully to the generic guidance below. The page is
// responsible for ensuring every number here is a real feed value (it is) — this
// module only formats them.
export type RealPropSignals = {
  // Per-game home vs away average of THIS market's value, straight from the
  // player's real game log. Both sides must have at least one game.
  homeAway?: {
    homeAvg: number;
    awayAvg: number;
    homeN: number;
    awayN: number;
  } | null;
  // The player's recent per-game average for THIS market (the page's headline
  // projection) vs his real season-long per-game average for the same stat.
  recentVsSeason?: {
    recentAvg: number;
    seasonAvg: number;
    recentN: number;
  } | null;
  // MLB batter-only real signals.
  mlb?: {
    // The OPPOSING probable starting pitcher this batter faces tonight.
    pitcher?: {
      name: string;
      throws: "L" | "R" | null;
      kPer9: number | null;
      era: number | null;
    } | null;
    // The batter's real platoon line vs that starter's throwing hand.
    platoon?: {
      bats: "L" | "R" | "S" | null;
      hand: "L" | "R"; // the starter's throwing hand (the side shown)
      avg: number | null;
      ops: number | null;
    } | null;
    // The home ballpark + a live weather snapshot (null fields = honest gaps;
    // domes report weather-neutral).
    ballpark?: {
      venue: string | null;
      hrIndex: number | null;
      dome: boolean;
      tempF: number | null;
      windMph: number | null;
      condition: string | null;
    } | null;
  } | null;
};

export type FactorContext = {
  sport: string;
  marketKey: string;
  marketLabel: string;
  // Optional, REAL personalization. All nullable — copy degrades gracefully.
  playerName?: string | null;
  teamName?: string | null; // the player's own team (full name)
  oppName?: string | null; // the opponent team (full name)
  // Optional, REAL computed signals. When present, the matching cards show real
  // numbers instead of generic guidance.
  real?: RealPropSignals | null;
};

// --- name helpers -----------------------------------------------------------

function firstNameOf(full?: string | null): string {
  const n = (full ?? "").trim();
  if (!n) return "the player";
  return n.split(/\s+/)[0];
}

// Short, broadcast-style team name ("San Antonio Spurs" -> "Spurs").
function shortTeam(full?: string | null): string | null {
  const n = (full ?? "").trim();
  if (!n) return null;
  const parts = n.split(/\s+/);
  return parts[parts.length - 1] || null;
}

// A short noun for the market value ("Hits" -> "hits", "Total Bases" -> "total
// bases"), used in the real home/away + recent-vs-season copy.
function statNoun(label?: string | null): string {
  const l = (label ?? "").trim().toLowerCase();
  return l || "this stat";
}

// Baseball-style rate: 0.265 -> ".265", 1.024 -> "1.024".
function rate3(n: number): string {
  const s = n.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}

// --- shared cards (REAL when signals present, else generic) -----------------

const HOME_AWAY_GENERIC: PropFactor = {
  tier: "useful",
  emoji: "🏟",
  title: "Home / Away Splits",
  body: "Some players perform noticeably better at home. Factor in which venue this game is at.",
};

const REGRESSION_GENERIC: PropFactor = {
  tier: "useful",
  emoji: "📊",
  title: "Recent vs Season",
  body: "Is this recent stretch above or below the player's season average? Regression to the mean matters when the line sits near his real level.",
};

function homeAwayCard(real: RealPropSignals | null | undefined, noun: string): PropFactor {
  const ha = real?.homeAway;
  if (ha && ha.homeN > 0 && ha.awayN > 0) {
    const lean =
      ha.homeAvg > ha.awayAvg
        ? "He's been better at home"
        : ha.awayAvg > ha.homeAvg
          ? "He's been better on the road"
          : "Even home and away";
    return {
      tier: "useful",
      emoji: "🏟",
      title: "Home / Away Splits",
      body: `Real game-log split: ${ha.homeAvg.toFixed(1)} ${noun}/game at home (${ha.homeN}) vs ${ha.awayAvg.toFixed(1)} away (${ha.awayN}). ${lean} — weigh tonight's venue.`,
    };
  }
  return HOME_AWAY_GENERIC;
}

function recentVsSeasonCard(real: RealPropSignals | null | undefined, noun: string): PropFactor {
  const r = real?.recentVsSeason;
  if (r) {
    const diff = r.recentAvg - r.seasonAvg;
    const adir = Math.abs(diff) < 0.1 ? "even" : diff > 0 ? "above" : "below";
    const tail =
      adir === "above"
        ? "Hot stretch — weigh regression if the line chases it."
        : adir === "below"
          ? "Cold stretch — weigh a bounce-back if the line overreacts."
          : "Steady — the line sits near his real level.";
    const cmp =
      adir === "even"
        ? `right at his season average (${r.seasonAvg.toFixed(1)})`
        : `${adir} his season average of ${r.seasonAvg.toFixed(1)}`;
    return {
      tier: "useful",
      emoji: "📊",
      title: "Recent vs Season",
      body: `Last ${r.recentN}: ${r.recentAvg.toFixed(1)} ${noun}/game — ${cmp}. ${tail}`,
    };
  }
  return REGRESSION_GENERIC;
}

// --- baseball ---------------------------------------------------------------

const MLB_PITCHER_STARTER_GENERIC: PropFactor = {
  tier: "critical",
  emoji: "⚾",
  title: "Tonight's Starting Pitcher",
  body: "High-K starters suppress hits regardless of form. Check the K/9 rate and this hitter's career line vs this pitcher specifically.",
};

const MLB_PLATOON_GENERIC: PropFactor = {
  tier: "critical",
  emoji: "✋",
  title: "L/R Splits vs Starter",
  body: "A hitter's platoon split (vs lefties vs righties) can be dramatic. Check his split and match it against tonight's starter's throwing hand.",
};

const MLB_BALLPARK_GENERIC: PropFactor = {
  tier: "important",
  emoji: "💨",
  title: "Ballpark & Wind",
  body: "Wind blowing in kills offense; blowing out is run-friendly. Park factors matter — check the weather before betting.",
};

const MLB_LINEUP_GENERIC: PropFactor = {
  tier: "important",
  emoji: "📋",
  title: "Confirmed Lineup",
  body: "Is the player confirmed starting, and where in the order? A rest day or scratch voids the prop. Check before first pitch.",
};

function mlbStarterCard(real: RealPropSignals | null | undefined): PropFactor {
  const p = real?.mlb?.pitcher;
  if (p?.name) {
    const hand = p.throws === "L" ? "LHP" : p.throws === "R" ? "RHP" : null;
    const bits: string[] = [];
    if (p.kPer9 != null) bits.push(`${p.kPer9.toFixed(1)} K/9`);
    if (p.era != null) bits.push(`${p.era.toFixed(2)} ERA`);
    const line = bits.length ? ` This season: ${bits.join(", ")}.` : "";
    const lean =
      p.kPer9 != null
        ? p.kPer9 >= 9
          ? " A high-strikeout arm caps hits and total bases."
          : p.kPer9 <= 7
            ? " A lower-strikeout arm puts more balls in play."
            : ""
        : "";
    return {
      tier: "critical",
      emoji: "⚾",
      title: "Tonight's Starting Pitcher",
      body: `Faces ${p.name}${hand ? ` (${hand})` : ""}.${line}${lean}`,
    };
  }
  return MLB_PITCHER_STARTER_GENERIC;
}

function mlbPlatoonCard(real: RealPropSignals | null | undefined, name: string): PropFactor {
  const pl = real?.mlb?.platoon;
  if (pl && (pl.avg != null || pl.ops != null)) {
    const handLabel = pl.hand === "L" ? "LHP" : "RHP";
    const batsLabel =
      pl.bats === "S" ? "switch-hits" : pl.bats === "L" ? "bats lefty" : pl.bats === "R" ? "bats righty" : "hits";
    // Same-handed (R vs RHP / L vs LHP) is the tougher look for the hitter;
    // opposite hand and switch-hitters get the platoon edge.
    const edge =
      pl.bats === "S"
        ? " — a switch-hitter keeps the platoon edge"
        : pl.bats && pl.bats === pl.hand
          ? " — the tougher same-handed look"
          : pl.bats
            ? " — the favorable opposite-handed look"
            : "";
    const stat: string[] = [];
    if (pl.avg != null) stat.push(`${rate3(pl.avg)} AVG`);
    if (pl.ops != null) stat.push(`${rate3(pl.ops)} OPS`);
    return {
      tier: "critical",
      emoji: "✋",
      title: "L/R Platoon vs Starter",
      body: `${name} ${batsLabel} and faces a ${handLabel}${edge}. His real line vs ${handLabel}: ${stat.join(", ")}.`,
    };
  }
  return MLB_PLATOON_GENERIC;
}

function mlbBallparkCard(real: RealPropSignals | null | undefined): PropFactor {
  const b = real?.mlb?.ballpark;
  if (b && (b.venue || b.hrIndex != null)) {
    const idx =
      b.hrIndex != null
        ? `HR park factor ${b.hrIndex} (${b.hrIndex >= 105 ? "hitter-friendly" : b.hrIndex <= 95 ? "pitcher-friendly" : "roughly neutral"})`
        : null;
    let wx: string | null = null;
    if (b.dome) {
      wx = "Roof park — weather neutral.";
    } else {
      const w: string[] = [];
      if (b.tempF != null) w.push(`${b.tempF}°F`);
      if (b.windMph != null) w.push(`wind ${b.windMph} mph`);
      if (b.condition) w.push(b.condition);
      if (w.length) wx = `Now: ${w.join(", ")}.`;
    }
    const head = [b.venue, idx].filter(Boolean).join(" — ");
    return {
      tier: "important",
      emoji: "💨",
      title: "Ballpark & Weather",
      body: `${head}.${wx ? ` ${wx}` : ""}`,
    };
  }
  return MLB_BALLPARK_GENERIC;
}

function mlbBatter(
  real: RealPropSignals | null | undefined,
  playerName: string | null | undefined,
  homeAway: PropFactor,
  recent: PropFactor,
): PropFactor[] {
  return [
    mlbStarterCard(real),
    mlbPlatoonCard(real, firstNameOf(playerName)),
    mlbBallparkCard(real),
    MLB_LINEUP_GENERIC,
    homeAway,
    recent,
  ];
}

function mlbPitcher(real: RealPropSignals | null | undefined, homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "⚾",
      title: "Opposing Lineup K-Rate",
      body: "Strikeout props live and die on the opponent's whiff rate. A high-contact lineup caps the ceiling regardless of his stuff.",
    },
    {
      tier: "critical",
      emoji: "🔢",
      title: "Pitch Count & Leash",
      body: "Manager tendencies and recent pitch counts decide how deep he goes. An early hook caps strikeouts and outs.",
    },
    // The pitcher works in his home park too — the ballpark/weather card is real
    // and side-independent, so reuse it here.
    mlbBallparkCard(real),
    {
      tier: "important",
      emoji: "📋",
      title: "Confirmed to Start",
      body: "Late scratches and rain delays happen. Confirm he's on the mound before first pitch.",
    },
    homeAway,
    recent,
  ];
}

// --- basketball (market-aware) ----------------------------------------------

type BCtx = { name: string; oppShort: string | null; teamShort: string | null };

function oppTitle(ctx: BCtx, suffix: string): string {
  return ctx.oppShort ? `${ctx.oppShort} ${suffix}` : `Opponent ${suffix}`;
}
function oppSubject(ctx: BCtx): string {
  return ctx.oppShort ?? "The opponent";
}
function teamTitle(ctx: BCtx, suffix: string): string {
  return ctx.teamShort ? `${ctx.teamShort} ${suffix}` : `Teammate ${suffix}`;
}
function teamSubject(ctx: BCtx): string {
  return ctx.teamShort ? `${ctx.teamShort}'s` : "his team's";
}

function bballAssists(ctx: BCtx, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "🏆",
      title: "Game Context",
      body: `Playoff or must-win games can push ${ctx.name} into facilitator mode and spike assists; a low-stakes game can flip it. Check what's at stake.`,
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: oppTitle(ctx, "Defensive Scheme"),
      body: `${oppSubject(ctx)} may funnel ${ctx.name} into iso scoring rather than facilitating, which naturally suppresses assists.`,
    },
    {
      tier: "important",
      emoji: "🏃",
      title: teamTitle(ctx, "PG Health"),
      body: `If ${teamSubject(ctx)} primary point guard is out or limited, ${ctx.name} may run the offense more — boosting assists. Check the injury report.`,
    },
    {
      tier: "important",
      emoji: "⏱",
      title: "Game Pace & Total",
      body: "Slower pace means fewer possessions and fewer assist chances. Check the posted game total as a pace hint.",
    },
    recent,
    {
      tier: "useful",
      emoji: "💊",
      title: "Injury Report",
      body: "Any hand or wrist issue can quietly limit passing. Check the official injury report before tip-off.",
    },
  ];
}

function bballPoints(ctx: BCtx, homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "⏱",
      title: "Confirmed Role & Minutes",
      body: `Minutes drive scoring. A blowout, rest day, or rotation change can sink the prop. Check ${ctx.name}'s projected minutes and the status report.`,
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: oppTitle(ctx, "Defense"),
      body: `${oppSubject(ctx)}'s defense at his position and how they defend the rim/perimeter set the scoring ceiling. A switch-heavy, slow defense suppresses volume.`,
    },
    {
      tier: "important",
      emoji: "🩹",
      title: "Usage If Teammates Sit",
      body: `A star resting concentrates shots on ${ctx.name}; a returning teammate steals them. Check who's in and out.`,
    },
    {
      tier: "important",
      emoji: "🏃",
      title: "Pace & Total",
      body: "A high total and fast pace mean more possessions and scoring chances. Check the game total.",
    },
    homeAway,
    recent,
  ];
}

function bballRebounds(ctx: BCtx, homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "⏱",
      title: "Confirmed Role & Minutes",
      body: `Boards follow minutes. Foul trouble or a blowout cuts them short. Check ${ctx.name}'s projected minutes.`,
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: oppTitle(ctx, "Pace & Glass"),
      body: `${oppSubject(ctx)}'s pace and how they crash the glass shape rebound chances. A fast, high-miss game leaves more boards available.`,
    },
    {
      tier: "important",
      emoji: "🩹",
      title: "Bigs In or Out",
      body: `If a teammate big sits, more rebounds are there for ${ctx.name}; a returning big competes for them. Check the injury report.`,
    },
    {
      tier: "important",
      emoji: "🏀",
      title: "Misses Create Boards",
      body: "More missed shots mean more rebounds. A low-shooting, lower-total matchup can mean more boards to grab.",
    },
    homeAway,
    recent,
  ];
}

function bballThrees(ctx: BCtx, homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "🎯",
      title: "Role as a Shooter",
      body: `Three-point props hinge on volume and green light. Confirm ${ctx.name}'s recent attempt rate, not just makes.`,
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: oppTitle(ctx, "Perimeter Defense"),
      body: `${oppSubject(ctx)}'s three-point defense and how hard they run shooters off the line set the ceiling.`,
    },
    {
      tier: "important",
      emoji: "🎲",
      title: "High Variance",
      body: "Threes are streaky — even a great shooter can go cold. Weigh the variance against the line and the price.",
    },
    {
      tier: "important",
      emoji: "🏃",
      title: "Pace & Total",
      body: "A fast, high-total game means more possessions and more shot attempts.",
    },
    homeAway,
    recent,
  ];
}

function bballGeneric(ctx: BCtx, homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "⏱",
      title: "Confirmed Role & Minutes",
      body: `Minutes drive every counting stat. A blowout, rest day, or rotation change can sink the prop. Check ${ctx.name}'s status and projected minutes.`,
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: oppTitle(ctx, "Matchup & Defense"),
      body: `${oppSubject(ctx)}'s pace and positional defense set the ceiling. A slow, switch-heavy defense suppresses volume.`,
    },
    {
      tier: "important",
      emoji: "🩹",
      title: "Injuries Around Him",
      body: `Teammates in or out shift usage. A star resting can spike ${ctx.name}'s touches — a returning star can steal them.`,
    },
    {
      tier: "important",
      emoji: "🏃",
      title: "Pace & Total",
      body: "Game pace and the posted total hint at possessions. High-total games create more chances.",
    },
    homeAway,
    recent,
  ];
}

function basketballFactors(ctx: BCtx, key: string, homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  const hasAssist = /assist|\bast\b/.test(key);
  const hasReb = /rebound|\breb\b/.test(key);
  const hasPts = /point|\bpts\b/.test(key);
  const hasThree = /three|3-?pt|3 ?pointer|threes|made threes/.test(key);
  // Combo markets (PRA, P+R, etc.) get the generic set; single-stat markets get
  // their tailored set.
  const distinct = [hasAssist, hasReb, hasPts].filter(Boolean).length;
  if (distinct <= 1) {
    if (hasThree) return bballThrees(ctx, homeAway, recent);
    if (hasAssist) return bballAssists(ctx, recent);
    if (hasReb) return bballRebounds(ctx, homeAway, recent);
    if (hasPts) return bballPoints(ctx, homeAway, recent);
  }
  return bballGeneric(ctx, homeAway, recent);
}

// --- football / hockey / soccer / generic -----------------------------------

function football(homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "📈",
      title: "Game Script",
      body: "A trailing team throws more; a leading team runs more. The spread and total hint at the likely script.",
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: "Matchup & Coverage",
      body: "The opponent's defense against this position sets the ceiling. Check who's shadowing and any run-funnel tendencies.",
    },
    {
      tier: "important",
      emoji: "🩹",
      title: "Injuries & Inactives",
      body: "Inactives shift targets and carries. A missing teammate can concentrate volume on this player.",
    },
    {
      tier: "important",
      emoji: "💨",
      title: "Weather",
      body: "Wind and rain depress passing and kicking. Check the forecast for outdoor games.",
    },
    homeAway,
    recent,
  ];
}

function hockey(homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "🏒",
      title: "Confirmed Line & TOI",
      body: "Line and power-play deployment drive shots and points. A line demotion or scratch sinks the prop — check the morning skate.",
    },
    {
      tier: "critical",
      emoji: "🥅",
      title: "Opposing Goalie & Defense",
      body: "The opponent's goalie and shot-suppression set the ceiling. A hot goalie caps points.",
    },
    {
      tier: "important",
      emoji: "⚡",
      title: "Power-Play Role",
      body: "Top power-play time inflates shots and points. Confirm he's on the top unit.",
    },
    {
      tier: "important",
      emoji: "🩹",
      title: "Injuries Around Him",
      body: "Linemates in or out shift his role and scoring chances.",
    },
    homeAway,
    recent,
  ];
}

function soccer(homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "📋",
      title: "Confirmed to Start & Minutes",
      body: "Rotation is heavy in soccer. A bench start or early sub kills shot and goal props. Check the confirmed XI before kickoff.",
    },
    {
      tier: "critical",
      emoji: "🎯",
      title: "Role & Set Pieces",
      body: "Penalty and set-piece duty drives goal odds. Confirm he's the designated taker.",
    },
    {
      tier: "important",
      emoji: "🛡",
      title: "Opponent & Game State",
      body: "A defensive opponent, or a team chasing the game, changes how many shots he gets.",
    },
    {
      tier: "important",
      emoji: "✈️",
      title: "Fixture Congestion",
      body: "Midweek games and travel can mean rotation or reduced minutes.",
    },
    homeAway,
    recent,
  ];
}

function genericFactors(homeAway: PropFactor, recent: PropFactor): PropFactor[] {
  return [
    {
      tier: "critical",
      emoji: "✅",
      title: "Confirmed to Play",
      body: "Availability and role drive every prop. Confirm the player is active and starting before betting.",
    },
    {
      tier: "critical",
      emoji: "🛡",
      title: "Matchup",
      body: "The opponent's strength against this stat sets the ceiling for the night.",
    },
    {
      tier: "important",
      emoji: "🩹",
      title: "Injuries Around Him",
      body: "Teammates in or out can shift this player's volume and opportunity.",
    },
    homeAway,
    recent,
  ];
}

// Pick the right set for a prop. Baseball splits into batter vs pitcher and
// basketball into per-market sets (assists / points / rebounds / threes) because
// the levers are completely different; everything else is keyed by sport family,
// with a generic fallback so the section is never empty or wrong. Every set ends
// with the home/away + recent-vs-season cards, which render REAL numbers when
// the page supplies them and fall back to generic guidance otherwise.
export function factorsForProp(opts: FactorContext): PropFactor[] {
  const sport = (opts.sport || "").toLowerCase();
  const key = `${opts.marketKey} ${opts.marketLabel}`.toLowerCase();
  const real = opts.real ?? null;
  const noun = statNoun(opts.marketLabel);
  const homeAway = homeAwayCard(real, noun);
  const recent = recentVsSeasonCard(real, noun);

  if (sport === "mlb") {
    const isPitcher = /pitcher|strikeout|\bouts\b|earned run|hits allowed|walks allowed/.test(key);
    return isPitcher ? mlbPitcher(real, homeAway, recent) : mlbBatter(real, opts.playerName, homeAway, recent);
  }
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    const ctx: BCtx = {
      name: firstNameOf(opts.playerName),
      oppShort: shortTeam(opts.oppName),
      teamShort: shortTeam(opts.teamName),
    };
    return basketballFactors(ctx, key, homeAway, recent);
  }
  if (sport === "nfl" || sport === "ncaaf") return football(homeAway, recent);
  if (sport === "nhl") return hockey(homeAway, recent);
  if (sport === "soccer") return soccer(homeAway, recent);
  return genericFactors(homeAway, recent);
}

export const TIER_META: Record<FactorTier, { label: string; prefix: string }> = {
  critical: { label: "CRITICAL", prefix: "⚠" },
  important: { label: "IMPORTANT", prefix: "↑" },
  useful: { label: "USEFUL", prefix: "→" },
};
