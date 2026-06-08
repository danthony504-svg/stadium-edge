// Advisory "things to weigh before betting" cards for the prop detail page.
//
// HONESTY NOTE: this module contains NO data and makes NO claims about a
// specific player's numbers. Every card is generic, evergreen guidance that
// tells the bettor what to research (starting pitcher, lineup, weather, the
// opponent's scheme, …). It never asserts a stat value, so there is nothing
// here that could be fabricated — the real numbers on the page come from the
// live game-log feed elsewhere.
//
// Cards may be personalized with names that are ALREADY known and REAL: the
// player's name (passed in) and the two team names parsed from the matchup.
// When a name can't be resolved the card falls back to a neutral noun, so the
// copy is always honest and never invents a team or player.

export type FactorTier = "critical" | "important" | "useful";

export type PropFactor = {
  tier: FactorTier;
  emoji: string;
  title: string;
  body: string;
};

export type FactorContext = {
  sport: string;
  marketKey: string;
  marketLabel: string;
  // Optional, REAL personalization. All nullable — copy degrades gracefully.
  playerName?: string | null;
  teamName?: string | null; // the player's own team (full name)
  oppName?: string | null; // the opponent team (full name)
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

// --- shared evergreen cards -------------------------------------------------

const HOME_AWAY: PropFactor = {
  tier: "useful",
  emoji: "🏟",
  title: "Home / Away Splits",
  body: "Some players perform noticeably better at home. Factor in which venue this game is at.",
};

const REGRESSION: PropFactor = {
  tier: "useful",
  emoji: "📊",
  title: "Recent vs Season",
  body: "Is this recent stretch above or below the player's season average? Regression to the mean matters when the line sits near his real level.",
};

// --- baseball ---------------------------------------------------------------

const MLB_BATTER: PropFactor[] = [
  {
    tier: "critical",
    emoji: "⚾",
    title: "Tonight's Starting Pitcher",
    body: "High-K starters suppress hits regardless of form. Check the K/9 rate and this hitter's career line vs this pitcher specifically.",
  },
  {
    tier: "critical",
    emoji: "✋",
    title: "L/R Splits vs Starter",
    body: "A hitter's platoon split (vs lefties vs righties) can be dramatic. Check his split and match it against tonight's starter's throwing hand.",
  },
  {
    tier: "important",
    emoji: "💨",
    title: "Ballpark & Wind",
    body: "Wind blowing in kills offense; blowing out is run-friendly. Park factors matter — check the weather before betting.",
  },
  {
    tier: "important",
    emoji: "📋",
    title: "Confirmed Lineup",
    body: "Is the player confirmed starting, and where in the order? A rest day or scratch voids the prop. Check before first pitch.",
  },
  HOME_AWAY,
  REGRESSION,
];

const MLB_PITCHER: PropFactor[] = [
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
  {
    tier: "important",
    emoji: "💨",
    title: "Ballpark & Weather",
    body: "Hitter-friendly parks and wind blowing out inflate contact and runs allowed. Check conditions before betting.",
  },
  {
    tier: "important",
    emoji: "📋",
    title: "Confirmed to Start",
    body: "Late scratches and rain delays happen. Confirm he's on the mound before first pitch.",
  },
  HOME_AWAY,
  REGRESSION,
];

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

function bballAssists(ctx: BCtx): PropFactor[] {
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
    {
      tier: "useful",
      emoji: "📊",
      title: "Season-Long Avg",
      body: `Is the recent average ${ctx.name}'s true level or a hot/cold stretch? Regression matters when the line sits near his real mean.`,
    },
    {
      tier: "useful",
      emoji: "💊",
      title: "Injury Report",
      body: "Any hand or wrist issue can quietly limit passing. Check the official injury report before tip-off.",
    },
  ];
}

function bballPoints(ctx: BCtx): PropFactor[] {
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
    HOME_AWAY,
    REGRESSION,
  ];
}

function bballRebounds(ctx: BCtx): PropFactor[] {
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
    HOME_AWAY,
    REGRESSION,
  ];
}

function bballThrees(ctx: BCtx): PropFactor[] {
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
    HOME_AWAY,
    REGRESSION,
  ];
}

function bballGeneric(ctx: BCtx): PropFactor[] {
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
    HOME_AWAY,
    REGRESSION,
  ];
}

function basketballFactors(ctx: BCtx, key: string): PropFactor[] {
  const hasAssist = /assist|\bast\b/.test(key);
  const hasReb = /rebound|\breb\b/.test(key);
  const hasPts = /point|\bpts\b/.test(key);
  const hasThree = /three|3-?pt|3 ?pointer|threes|made threes/.test(key);
  // Combo markets (PRA, P+R, etc.) get the generic set; single-stat markets get
  // their tailored set.
  const distinct = [hasAssist, hasReb, hasPts].filter(Boolean).length;
  if (distinct <= 1) {
    if (hasThree) return bballThrees(ctx);
    if (hasAssist) return bballAssists(ctx);
    if (hasReb) return bballRebounds(ctx);
    if (hasPts) return bballPoints(ctx);
  }
  return bballGeneric(ctx);
}

// --- football / hockey / soccer / generic -----------------------------------

const FOOTBALL: PropFactor[] = [
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
  HOME_AWAY,
  REGRESSION,
];

const HOCKEY: PropFactor[] = [
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
  HOME_AWAY,
  REGRESSION,
];

const SOCCER: PropFactor[] = [
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
  HOME_AWAY,
  REGRESSION,
];

const GENERIC: PropFactor[] = [
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
  HOME_AWAY,
  REGRESSION,
];

// Pick the right advisory set for a prop. Baseball splits into batter vs pitcher
// and basketball into per-market sets (assists / points / rebounds / threes)
// because the levers are completely different; everything else is keyed by sport
// family, with a generic fallback so the section is never empty or wrong.
export function factorsForProp(opts: FactorContext): PropFactor[] {
  const sport = (opts.sport || "").toLowerCase();
  const key = `${opts.marketKey} ${opts.marketLabel}`.toLowerCase();

  if (sport === "mlb") {
    const isPitcher = /pitcher|strikeout|\bouts\b|earned run|hits allowed|walks allowed/.test(key);
    return isPitcher ? MLB_PITCHER : MLB_BATTER;
  }
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    const ctx: BCtx = {
      name: firstNameOf(opts.playerName),
      oppShort: shortTeam(opts.oppName),
      teamShort: shortTeam(opts.teamName),
    };
    return basketballFactors(ctx, key);
  }
  if (sport === "nfl" || sport === "ncaaf") return FOOTBALL;
  if (sport === "nhl") return HOCKEY;
  if (sport === "soccer") return SOCCER;
  return GENERIC;
}

export const TIER_META: Record<FactorTier, { label: string; prefix: string }> = {
  critical: { label: "CRITICAL", prefix: "⚠" },
  important: { label: "IMPORTANT", prefix: "↑" },
  useful: { label: "USEFUL", prefix: "→" },
};
