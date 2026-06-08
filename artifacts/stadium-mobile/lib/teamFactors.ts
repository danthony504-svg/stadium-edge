// Advisory "what you're still missing" cards for the TEAM props sheet — the
// team-bet analog of propFactors.ts.
//
// HONESTY NOTE: this module contains NO data and makes NO claims about a
// specific game's numbers (no posted total, no series score, no spread value).
// Every card is procedural guidance that tells the bettor what to research.
// Cards are lightly personalized with REAL, already-known names (the team and
// its opponent, passed in) and the real home/away flag; when a name is absent
// the copy falls back to a neutral noun, so nothing is ever invented.

import type { PropFactor } from "./propFactors";

function nick(full?: string | null): string | null {
  const n = (full ?? "").trim();
  if (!n) return null;
  return n.split(/\s+/).pop() || null;
}

export function factorsForTeam(opts: {
  sport: string;
  teamName?: string | null;
  oppName?: string | null;
  isHome?: boolean | null;
}): PropFactor[] {
  const team = nick(opts.teamName);
  const opp = nick(opts.oppName);
  const teamSubj = team ?? "this team";
  const oppSubj = opp ?? "the opponent";
  const venue =
    opts.isHome === true ? "at home" : opts.isHome === false ? "on the road" : "in this game";

  return [
    {
      tier: "critical",
      emoji: "💊",
      title: "Injury Report",
      body: `Is any ${teamSubj} key player limited or out? In big games load management is rare, but banged-up starters still matter. Check the official report before betting.`,
    },
    {
      tier: "critical",
      emoji: "📐",
      title: "Game Total (O/U)",
      body: "What's the posted total? A lower total signals books expect a grind and a close game — not a blowout — which shifts spread and team-total value.",
    },
    {
      tier: "important",
      emoji: "🎯",
      title: "Spread / Line",
      body: `How big is the spread? A wider number means the market expects a dominant ${teamSubj} win; a tight one signals a close game. Line it up against the bet you're eyeing.`,
    },
    {
      tier: "important",
      emoji: "🔄",
      title: opp ? `${opp} Adjustments` : "Opponent Adjustments",
      body: `If this is a playoff series, ${oppSubj} often change their scheme between games. New wrinkles can disrupt ${teamSubj}'s rhythm temporarily.`,
    },
    {
      tier: "useful",
      emoji: "🛌",
      title: "Rest & Schedule",
      body: `Back-to-backs and heavy travel sap legs. Check whether either side is on short rest, and note that ${teamSubj} is playing ${venue}.`,
    },
    {
      tier: "useful",
      emoji: "📊",
      title: "Recent vs Season",
      body: `Is this recent form ${teamSubj}'s true level or a hot/cold stretch? Regression to the mean matters when the line is close.`,
    },
  ];
}
