// Advisory "things to weigh before betting" cards for the prop detail page.
//
// HONESTY NOTE: this module contains NO data and makes NO claims about a
// specific player's numbers. Every card is generic, evergreen guidance that
// tells the bettor what to research (starting pitcher, lineup, weather, …). It
// never asserts a value, so there is nothing here that could be fabricated —
// the real numbers on the page come from the live game-log feed elsewhere.

export type FactorTier = "critical" | "important" | "useful";

export type PropFactor = {
  tier: FactorTier;
  emoji: string;
  title: string;
  body: string;
};

const HOME_AWAY: PropFactor = {
  tier: "useful",
  emoji: "🏟",
  title: "Home / Away Splits",
  body: "Some players perform significantly better at home. Factor in which venue this game is at.",
};

const REGRESSION: PropFactor = {
  tier: "useful",
  emoji: "📊",
  title: "Recent vs Season",
  body: "Is this recent stretch above or below the player's season average? Regression to the mean matters for prop value.",
};

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
    body: "Is the player confirmed starting, and where in the order? A rest day or scratch voids the prop. Check ~1hr before first pitch.",
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
    body: "Late scratches and rain delays happen. Confirm he's on the mound ~1hr before first pitch.",
  },
  HOME_AWAY,
  REGRESSION,
];

const BASKETBALL: PropFactor[] = [
  {
    tier: "critical",
    emoji: "⏱",
    title: "Confirmed Role & Minutes",
    body: "Minutes drive every counting stat. A blowout, rest day, or rotation change can sink the prop. Check the status report and projected minutes.",
  },
  {
    tier: "critical",
    emoji: "🛡",
    title: "Matchup & Defense",
    body: "The opponent's pace and positional defense set the ceiling. A slow, switch-heavy defense suppresses volume.",
  },
  {
    tier: "important",
    emoji: "🩹",
    title: "Injuries Around Him",
    body: "Teammates in or out shift usage. A star resting can spike this player's touches — or a returning star can steal them.",
  },
  {
    tier: "important",
    emoji: "🏃",
    title: "Pace & Total",
    body: "Game pace and the posted total hint at possessions. High-total games create more scoring chances.",
  },
  HOME_AWAY,
  REGRESSION,
];

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
    body: "Rotation is heavy in soccer. A bench start or early sub kills shot and goal props. Check the confirmed XI ~1hr before kickoff.",
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
// because the levers are completely different; everything else is keyed by sport
// family, with a generic fallback so the section is never empty or wrong.
export function factorsForProp(opts: {
  sport: string;
  marketKey: string;
  marketLabel: string;
}): PropFactor[] {
  const sport = (opts.sport || "").toLowerCase();
  const key = `${opts.marketKey} ${opts.marketLabel}`.toLowerCase();

  if (sport === "mlb") {
    const isPitcher = /pitcher|strikeout|\bouts\b|earned run|hits allowed|walks allowed/.test(key);
    return isPitcher ? MLB_PITCHER : MLB_BATTER;
  }
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") return BASKETBALL;
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
