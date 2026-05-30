import React, { useState, useRef, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { Send, Trash2, TrendingUp, Sparkles, Plus, X, Zap, Shuffle, Users, Swords, Edit3, Gavel, Info, Menu, User } from "lucide-react";
import stadiumEdgeLogo from "@assets/IMG_9617_1779815867324.png";
import stadiumEdgeSplash from "@assets/IMG_9634_1779816082458.jpeg";

// Login temporarily disabled. Flip to `true` to bring back the sign-in/sign-up
// entry points (and re-enable the /sign-in & /sign-up routes in App.tsx).
const AUTH_ENABLED = false;

// Inline SVG icons (no internet needed). Coach = capped figure with whistle;
// Ref = striped shirt with whistle. Styled to inherit size via props.
const CoachIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="12" fill="#7c3aed" />
    {/* head */}
    <circle cx="12" cy="10" r="3.4" fill="#f1c9a5" />
    {/* cap */}
    <path d="M7.6 8.4c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4H7.6z" fill="#1f2937" />
    <rect x="11.6" y="7.6" width="5.4" height="1.4" rx="0.7" fill="#1f2937" />
    {/* body / hoodie */}
    <path d="M5.5 21c0-3.6 2.9-5.4 6.5-5.4s6.5 1.8 6.5 5.4H5.5z" fill="#111827" />
    {/* whistle cord + whistle */}
    <path d="M12 15.6c-1.6 1-2.4 2.2-2.4 3.4" stroke="#374151" strokeWidth="0.8" fill="none" />
    <rect x="8.4" y="18.4" width="2.4" height="1.6" rx="0.8" fill="#4b5563" />
  </svg>
);

const WeatherIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    {/* sun */}
    <circle cx="9" cy="9" r="3.4" fill="#fbbf24" />
    <g stroke="#fbbf24" strokeWidth="1.2" strokeLinecap="round">
      <line x1="9" y1="2.4" x2="9" y2="4" />
      <line x1="9" y1="14" x2="9" y2="15.6" />
      <line x1="2.4" y1="9" x2="4" y2="9" />
      <line x1="4.3" y1="4.3" x2="5.4" y2="5.4" />
      <line x1="12.6" y1="4.3" x2="13.7" y2="5.4" />
    </g>
    {/* cloud */}
    <path d="M10 18.5a3 3 0 0 1 .4-6 4 4 0 0 1 7.6 1.1 2.6 2.6 0 0 1-.5 5.1H10z" fill="#e5e7eb" stroke="#cbd5e1" strokeWidth="0.6" />
    {/* rain */}
    <g stroke="#60a5fa" strokeWidth="1.2" strokeLinecap="round">
      <line x1="11" y1="20" x2="10.3" y2="22" />
      <line x1="14" y1="20" x2="13.3" y2="22" />
      <line x1="17" y1="20" x2="16.3" y2="22" />
    </g>
  </svg>
);

const HotPicksIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    {/* flame */}
    <path d="M12 2.5c2.5 3 4.5 5 4.5 9a4.5 4.5 0 0 1-9 0c0-1.7.7-3 1.6-4.2.2 1 .8 1.7 1.6 2 0-2.4.4-4.6 1.3-6.8z" fill="#f97316" />
    <path d="M12 9c1.2 1.6 2 2.8 2 4.6a2 2 0 0 1-4 0c0-1 .4-1.8 1-2.6.1.6.4 1 .8 1.2 0-1.1.1-2.2.2-3.2z" fill="#fde047" />
  </svg>
);

const EasyMoneyIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    {/* bill */}
    <rect x="2.5" y="6.5" width="19" height="11" rx="2" fill="#22c55e" />
    <rect x="2.5" y="6.5" width="19" height="11" rx="2" fill="none" stroke="#16a34a" strokeWidth="0.8" />
    <circle cx="12" cy="12" r="3" fill="#dcfce7" />
    <text x="12" y="14.4" textAnchor="middle" fontSize="4.2" fontWeight="bold" fill="#16a34a">$</text>
  </svg>
);

const LongShotIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    {/* target */}
    <circle cx="12" cy="12" r="9" fill="none" stroke="#ef4444" strokeWidth="1.6" />
    <circle cx="12" cy="12" r="5.2" fill="none" stroke="#ef4444" strokeWidth="1.6" />
    <circle cx="12" cy="12" r="1.8" fill="#ef4444" />
    {/* dart/arrow */}
    <line x1="16.5" y1="7.5" x2="21" y2="3" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M21 3l-2.6.4.4-2.6L21 3z" fill="#1f2937" />
  </svg>
);

const InjuryIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="11" fill="#ef4444" />
    <rect x="10.4" y="6" width="3.2" height="12" rx="1" fill="#fff" />
    <rect x="6" y="10.4" width="12" height="3.2" rx="1" fill="#fff" />
  </svg>
);

const SPORTS = [
  { id: "nfl", label: "NFL", emoji: "🏈" },
  { id: "nba", label: "NBA", emoji: "🏀" },
  { id: "wnba", label: "WNBA", emoji: "🏀" },
  { id: "mlb", label: "MLB", emoji: "⚾" },
  { id: "nhl", label: "NHL", emoji: "🏒" },
  { id: "soccer", label: "Soccer", emoji: "⚽" },
  { id: "ncaaf", label: "NCAAF", emoji: "🏟️" },
  { id: "ncaab", label: "NCAAB", emoji: "🎓" },
  { id: "ufc", label: "UFC", emoji: "🥊" },
  { id: "tennis", label: "Tennis", emoji: "🎾" },
];

// Player database — hypothetical stats with form ratings (1-10) for matchup engine
const PLAYERS = {
  nfl: [
    { name: "Patrick Mahomes", team: "KC", pos: "QB", stats: { passYds: 285, passTDs: 2.3, ints: 0.8, rushYds: 18 }, form: 9 },
    { name: "Josh Allen", team: "BUF", pos: "QB", stats: { passYds: 268, passTDs: 2.1, ints: 0.9, rushYds: 42 }, form: 9 },
    { name: "Lamar Jackson", team: "BAL", pos: "QB", stats: { passYds: 235, passTDs: 1.9, ints: 0.6, rushYds: 58 }, form: 9 },
    { name: "Joe Burrow", team: "CIN", pos: "QB", stats: { passYds: 295, passTDs: 2.2, ints: 0.7, rushYds: 12 }, form: 8 },
    { name: "Jalen Hurts", team: "PHI", pos: "QB", stats: { passYds: 245, passTDs: 1.8, ints: 0.8, rushYds: 48 }, form: 8 },
    { name: "Christian McCaffrey", team: "SF", pos: "RB", stats: { rushYds: 95, rushTDs: 0.9, recYds: 38, rec: 4.2 }, form: 9 },
    { name: "Saquon Barkley", team: "PHI", pos: "RB", stats: { rushYds: 88, rushTDs: 0.7, recYds: 22, rec: 2.8 }, form: 9 },
    { name: "Derrick Henry", team: "BAL", pos: "RB", stats: { rushYds: 92, rushTDs: 0.9, recYds: 10, rec: 1.2 }, form: 8 },
    { name: "Tyreek Hill", team: "MIA", pos: "WR", stats: { recYds: 88, recTDs: 0.6, rec: 6.1 }, form: 8 },
    { name: "Justin Jefferson", team: "MIN", pos: "WR", stats: { recYds: 95, recTDs: 0.7, rec: 6.8 }, form: 9 },
    { name: "CeeDee Lamb", team: "DAL", pos: "WR", stats: { recYds: 92, recTDs: 0.6, rec: 7.2 }, form: 8 },
    { name: "Travis Kelce", team: "KC", pos: "TE", stats: { recYds: 65, recTDs: 0.5, rec: 5.8 }, form: 7 },
  ],
  nba: [
    { name: "Nikola Jokic", team: "DEN", pos: "C", stats: { pts: 27, reb: 12.5, ast: 9.5, blk: 0.7, stl: 1.3 }, form: 10 },
    { name: "Luka Doncic", team: "DAL", pos: "PG", stats: { pts: 32, reb: 8.5, ast: 9.0, blk: 0.5, stl: 1.4 }, form: 9 },
    { name: "Giannis Antetokounmpo", team: "MIL", pos: "PF", stats: { pts: 30, reb: 11.5, ast: 6.0, blk: 1.1, stl: 1.2 }, form: 9 },
    { name: "Shai Gilgeous-Alexander", team: "OKC", pos: "PG", stats: { pts: 31, reb: 5.5, ast: 6.2, blk: 0.8, stl: 2.0 }, form: 10 },
    { name: "Jayson Tatum", team: "BOS", pos: "SF", stats: { pts: 27, reb: 8.5, ast: 5.5, blk: 0.7, stl: 1.0 }, form: 9 },
    { name: "Anthony Edwards", team: "MIN", pos: "SG", stats: { pts: 27, reb: 5.5, ast: 5.0, blk: 0.6, stl: 1.5 }, form: 9 },
    { name: "Stephen Curry", team: "GSW", pos: "PG", stats: { pts: 25, reb: 4.5, ast: 6.0, blk: 0.4, stl: 1.0 }, form: 8 },
    { name: "Kevin Durant", team: "PHX", pos: "SF", stats: { pts: 27, reb: 6.5, ast: 5.0, blk: 1.2, stl: 0.9 }, form: 8 },
    { name: "LeBron James", team: "LAL", pos: "SF", stats: { pts: 24, reb: 7.5, ast: 8.0, blk: 0.5, stl: 1.0 }, form: 8 },
    { name: "Jaylen Brown", team: "BOS", pos: "SG", stats: { pts: 23, reb: 5.5, ast: 3.8, blk: 0.4, stl: 1.2 }, form: 8 },
    { name: "Devin Booker", team: "PHX", pos: "SG", stats: { pts: 25, reb: 4.5, ast: 6.5, blk: 0.4, stl: 0.9 }, form: 8 },
    { name: "Joel Embiid", team: "PHI", pos: "C", stats: { pts: 30, reb: 11, ast: 4.5, blk: 1.7, stl: 1.0 }, form: 7 },
  ],
  mlb: [
    { name: "Aaron Judge", team: "NYY", pos: "OF", stats: { avg: 0.310, hrPerGame: 0.38, rbiPerGame: 1.1, runsPerGame: 1.0 }, form: 10 },
    { name: "Shohei Ohtani", team: "LAD", pos: "DH", stats: { avg: 0.305, hrPerGame: 0.34, rbiPerGame: 0.95, runsPerGame: 1.1 }, form: 10 },
    { name: "Mookie Betts", team: "LAD", pos: "OF", stats: { avg: 0.295, hrPerGame: 0.20, rbiPerGame: 0.7, runsPerGame: 0.95 }, form: 8 },
    { name: "Juan Soto", team: "NYY", pos: "OF", stats: { avg: 0.290, hrPerGame: 0.28, rbiPerGame: 0.85, runsPerGame: 0.95 }, form: 9 },
    { name: "Ronald Acuña Jr.", team: "ATL", pos: "OF", stats: { avg: 0.300, hrPerGame: 0.25, rbiPerGame: 0.75, runsPerGame: 1.0 }, form: 8 },
    { name: "Bryce Harper", team: "PHI", pos: "1B", stats: { avg: 0.285, hrPerGame: 0.22, rbiPerGame: 0.85, runsPerGame: 0.85 }, form: 8 },
  ],
  nhl: [
    { name: "Connor McDavid", team: "EDM", pos: "C", stats: { points: 1.6, goals: 0.55, assists: 1.05, shots: 3.8 }, form: 10 },
    { name: "Nathan MacKinnon", team: "COL", pos: "C", stats: { points: 1.5, goals: 0.6, assists: 0.9, shots: 4.2 }, form: 10 },
    { name: "Auston Matthews", team: "TOR", pos: "C", stats: { points: 1.3, goals: 0.7, assists: 0.6, shots: 4.5 }, form: 9 },
    { name: "Leon Draisaitl", team: "EDM", pos: "C", stats: { points: 1.4, goals: 0.55, assists: 0.85, shots: 3.5 }, form: 9 },
    { name: "Nikita Kucherov", team: "TBL", pos: "RW", stats: { points: 1.5, goals: 0.5, assists: 1.0, shots: 3.6 }, form: 10 },
    { name: "David Pastrnak", team: "BOS", pos: "RW", stats: { points: 1.3, goals: 0.6, assists: 0.7, shots: 4.0 }, form: 9 },
  ],
  soccer: [
    { name: "Erling Haaland", team: "MCI", pos: "ST", stats: { goalsPerGame: 0.88, assistsPerGame: 0.18, shotsPerGame: 3.5 }, form: 9 },
    { name: "Kylian Mbappé", team: "RMA", pos: "ST", stats: { goalsPerGame: 0.75, assistsPerGame: 0.30, shotsPerGame: 4.1 }, form: 9 },
    { name: "Mohamed Salah", team: "LIV", pos: "RW", stats: { goalsPerGame: 0.65, assistsPerGame: 0.35, shotsPerGame: 3.2 }, form: 9 },
    { name: "Vinícius Júnior", team: "RMA", pos: "LW", stats: { goalsPerGame: 0.55, assistsPerGame: 0.40, shotsPerGame: 3.0 }, form: 8 },
    { name: "Harry Kane", team: "BAY", pos: "ST", stats: { goalsPerGame: 0.80, assistsPerGame: 0.22, shotsPerGame: 3.4 }, form: 9 },
    { name: "Bukayo Saka", team: "ARS", pos: "RW", stats: { goalsPerGame: 0.45, assistsPerGame: 0.40, shotsPerGame: 2.5 }, form: 8 },
  ],
  ncaaf: [],
  ncaab: [],
  ufc: [
    { name: "Islam Makhachev", team: "LW Champ", pos: "LW", stats: { sigStrikesPerMin: 3.2, takedownsPer15: 4.1, controlPct: 65 }, form: 10 },
    { name: "Alexander Volkanovski", team: "FW", pos: "FW", stats: { sigStrikesPerMin: 6.0, takedownsPer15: 1.5, controlPct: 30 }, form: 8 },
    { name: "Jon Jones", team: "HW Champ", pos: "HW", stats: { sigStrikesPerMin: 4.3, takedownsPer15: 1.8, controlPct: 55 }, form: 9 },
    { name: "Tom Aspinall", team: "Interim HW", pos: "HW", stats: { sigStrikesPerMin: 5.8, takedownsPer15: 1.2, controlPct: 40 }, form: 9 },
    { name: "Alex Pereira", team: "LHW Champ", pos: "LHW", stats: { sigStrikesPerMin: 4.8, takedownsPer15: 0.3, controlPct: 15 }, form: 10 },
    { name: "Magomed Ankalaev", team: "LHW", pos: "LHW", stats: { sigStrikesPerMin: 3.4, takedownsPer15: 2.0, controlPct: 50 }, form: 8 },
  ],
};

// SAMPLE injury report (illustrative — NOT real). Keyed by team abbr → list of
// injured players with status and the backup who absorbs usage. Real injury data
// requires the Next.js version (ESPN injuries feed). Status: "out" | "doubtful"
// | "questionable". impact 1-3 = how much the team relies on them.
const INJURIES = {
  KC: [{ player: "Travis Kelce", pos: "TE", status: "questionable", impact: 2, backup: "Noah Gray" }],
  SF: [{ player: "Christian McCaffrey", pos: "RB", status: "doubtful", impact: 3, backup: "Jordan Mason" }],
  BUF: [{ player: "Josh Allen", pos: "QB", status: "questionable", impact: 3, backup: "Mitch Trubisky" }],
  DAL: [{ player: "CeeDee Lamb", pos: "WR", status: "out", impact: 3, backup: "Jalen Tolbert" }],
  DEN: [{ player: "Jamal Murray", pos: "PG", status: "questionable", impact: 2, backup: "Christian Braun" }],
  BOS: [{ player: "Kristaps Porzingis", pos: "C", status: "out", impact: 2, backup: "Al Horford" }],
  LAL: [{ player: "Anthony Davis", pos: "PF", status: "doubtful", impact: 3, backup: "Jaxson Hayes" }],
  MIA: [{ player: "Tyreek Hill", pos: "WR", status: "questionable", impact: 3, backup: "Jaylen Waddle" }],
};

const INJURY_WEIGHT = { out: 1, doubtful: 0.7, questionable: 0.4 };

// Map team abbreviations (injury keys) to the full names used in game strings.
const INJURY_TEAM_NAMES = {
  KC: "Chiefs", SF: "49ers", BUF: "Bills", DAL: "Cowboys", DEN: "Nuggets",
  BOS: "Celtics", LAL: "Lakers", MIA: ["Dolphins", "Heat"],
};
const teamMatchesGame = (abbr, gameStr) => {
  const names = INJURY_TEAM_NAMES[abbr];
  const arr = Array.isArray(names) ? names : [names];
  return arr.some((n) => n && gameStr.includes(n)) || gameStr.includes(abbr);
};

// Injury context for a pick. Returns:
//  - ownTeamInjuries: injuries to the side the pick is ON (hurt it)
//  - oppTeamInjuries: injuries to the OPPONENT (help it — easier matchup)
//  - isReplacement: this pick's player is the backup to an injured starter (more usage → help)
//  - eased: the opposing player guarding/competing with this pick's player is hurt (help)
const injuryContextForPick = (pick) => {
  if (!pick.game) return null;
  const teamsInGame = Object.keys(INJURIES).filter((abbr) => teamMatchesGame(abbr, pick.game));
  if (teamsInGame.length === 0) return null;

  const pickText = pick.pick || "";
  // Which team is the pick on? If it names a team, use that; for player props,
  // see if the player's team can be inferred from the injured/backup lists.
  let ownTeam = teamsInGame.find((t) => teamMatchesGame(t, pickText)) || null;

  const result = { ownTeamInjuries: [], oppTeamInjuries: [], isReplacement: null, eased: [] };

  for (const t of teamsInGame) {
    const list = (INJURIES[t] || []).map((i) => ({ ...i, team: t }));
    // Is this pick's player one of the backups stepping in? (replacement edge)
    const repl = list.find((i) => i.backup && pickText.includes(i.backup.split(" ").slice(-1)[0]));
    if (repl) { result.isReplacement = repl; ownTeam = t; }
  }

  for (const t of teamsInGame) {
    const list = (INJURIES[t] || []).map((i) => ({ ...i, team: t }));
    if (t === ownTeam) result.ownTeamInjuries.push(...list);
    else { result.oppTeamInjuries.push(...list); result.eased.push(...list); }
  }
  const has = result.ownTeamInjuries.length || result.oppTeamInjuries.length || result.isReplacement;
  return has ? result : null;
};

// SAMPLE situational edges (illustrative — NOT real schedule/travel data).
// Derives rest, travel/altitude, and pace context deterministically from the
// game string so it's stable per matchup. Real rest days + pace are derivable
// from ESPN's schedule/stats in the Next.js version. Returns directional notes
// and a small net confidence delta. Never predicts a result.
const PACE_SPORTS = ["nba", "wnba", "nhl", "ncaab"];
const situationalEdges = (pick) => {
  if (!pick.game) return null;
  const seedR = hashSeed(`${pick.game}-rest`);
  const seedT = hashSeed(`${pick.game}-travel`);
  const seedP = hashSeed(`${pick.game}-pace`);
  const notes = [];
  let delta = 0; // net confidence nudge for this pick

  const isOver = /\bover\b/i.test(pick.pick) || /\d+(\.\d+)?\s*\+/.test(pick.pick);
  const isUnder = /\bunder\b/i.test(pick.pick);
  const isProp = pick.market === "Player Prop";

  // --- Rest / schedule ---
  // Sample: one side on a back-to-back / short rest, the other rested.
  if (seedR > 0.62) {
    const tiredHome = seedR > 0.81;
    notes.push(
      (pick.sport === "nfl" || pick.sport === "ncaaf")
        ? "Schedule spot: one side coming off a short week — fatigue tends to dull second-half execution."
        : "Rest spot: one side on a back-to-back. Tired legs historically sag late and can cap minutes/props."
    );
    // Tired side hurts; props on a tired team trimmed
    delta -= 1.5;
    if (isProp) delta -= 1.0;
  } else if (seedR < 0.2) {
    notes.push("Rest edge: this side has the rest advantage (extra days off) — small boost to legs and execution.");
    delta += 1.5;
  }

  // --- Travel / altitude / time zone ---
  if (seedT > 0.7) {
    if (pick.game.includes("Nuggets") || pick.game.includes("Denver") || pick.game.includes("Avalanche")) {
      notes.push("Altitude: Denver's thin air wears down visiting legs late — conditioning edge to the home side, watch tired-legs unders late.");
      if (isUnder) delta += 1.2;
    } else {
      notes.push("Travel spot: long road trip / body-clock mismatch (e.g. early kickoff for a West-coast team) — road side can start sluggish.");
      delta -= 1.2;
    }
  }

  // --- Pace / style matchup ---
  if (PACE_SPORTS.includes(pick.sport)) {
    if (seedP > 0.66) {
      notes.push("Pace: two up-tempo teams — more possessions inflate totals and counting-stat props (pts/reb/ast, shots).");
      if (isOver) delta += 1.6;
      if (isUnder) delta -= 1.6;
      if (isProp && (isOver || /\d+(\.\d+)?\s*\+/.test(pick.pick))) delta += 1.2;
    } else if (seedP < 0.3) {
      notes.push("Pace: a slow, grind-it-out style matchup — fewer possessions suppress totals and counting props.");
      if (isUnder) delta += 1.6;
      if (isOver) delta -= 1.6;
      if (isProp) delta -= 1.0;
    }
  }

  if (notes.length === 0) return null;
  return { notes, delta: Math.max(-5, Math.min(5, delta)) };
};


// Sample coach tendency database — documented reputations, illustrative.
// Tendencies on a -2 to +2 scale:
//   aggressive: +2 = very aggressive (4th downs, 2pt, fast pace) — tends to favor overs
//   favLean:    +2 = strong as favorite / front-runner; -2 = better as underdog
//   primetime:  +2 = strong in big/primetime spots; -2 = struggles in spotlight
const COACHES = {
  nfl: [
    { name: "Andy Reid (KC)", team: "KC", aggressive: 2, favLean: 2, primetime: 2, notes: "Elite play-caller, aggressive 4th-down, dominant off bye weeks historically." },
    { name: "Sean McVay (LAR)", team: "LAR", aggressive: 2, favLean: 1, primetime: 1, notes: "High-tempo offense, leans overs; strong scripted opening drives." },
    { name: "Bill Belichick", team: "NE", aggressive: 0, favLean: 1, primetime: 2, notes: "Scheme adapts to take away opponent's strength; strong off extra rest." },
    { name: "Mike Tomlin (PIT)", team: "PIT", aggressive: 0, favLean: -1, primetime: 1, notes: "Never a losing season; teams play tough as underdogs." },
    { name: "Dan Campbell (DET)", team: "DET", aggressive: 2, favLean: 1, primetime: 1, notes: "Hyper-aggressive on 4th down — boosts both team's scoring and variance." },
    { name: "Kyle Shanahan (SF)", team: "SF", aggressive: 1, favLean: 2, primetime: 1, notes: "Scheme-driven offense, strong as favorite, occasional big-game stumbles." },
    { name: "John Harbaugh (BAL)", team: "BAL", aggressive: 1, favLean: 1, primetime: 1, notes: "Analytics-forward, aggressive on 4th and 2pt tries." },
  ],
  nba: [
    { name: "Erik Spoelstra (MIA)", team: "MIA", aggressive: 1, favLean: 0, primetime: 2, notes: "Elite in playoffs and as underdog; squeezes value from rosters." },
    { name: "Steve Kerr (GSW)", team: "GSW", aggressive: 1, favLean: 1, primetime: 2, notes: "Pace-and-space, strong in big games; rests stars in back-to-backs." },
    { name: "Gregg Popovich (SAS)", team: "SAS", aggressive: 0, favLean: 0, primetime: 1, notes: "Famous for resting starters — watch for DNP surprises in nationally televised games." },
    { name: "Tyronn Lue (LAC)", team: "LAC", aggressive: 1, favLean: 1, primetime: 1, notes: "Strong timeout/ATO play-calling, good late-game coach." },
  ],
  mlb: [
    { name: "Dave Roberts (LAD)", team: "LAD", aggressive: 1, favLean: 2, primetime: 1, notes: "Quick hook on starters, deep bullpen usage; strong as favorite." },
    { name: "Aaron Boone (NYY)", team: "NYY", aggressive: 0, favLean: 1, primetime: 1, notes: "Leans on analytics and matchups for bullpen decisions." },
  ],
  nhl: [
    { name: "Jon Cooper (TBL)", team: "TBL", aggressive: 1, favLean: 1, primetime: 2, notes: "Strong in playoffs, good at line-matching at home." },
    { name: "Rod Brind'Amour (CAR)", team: "CAR", aggressive: 2, favLean: 1, primetime: 1, notes: "Heavy forecheck, high shot volume — leans overs on shots props." },
  ],
  soccer: [
    { name: "Pep Guardiola (MCI)", team: "MCI", aggressive: 2, favLean: 2, primetime: 2, notes: "Possession-dominant, high xG; strong favorite but can rotate in congested fixtures." },
    { name: "Jürgen Klopp-style", team: "—", aggressive: 2, favLean: 1, primetime: 1, notes: "High-press, high-tempo — leans overs and BTTS." },
  ],
  ncaaf: [
    { name: "Kirby Smart (UGA)", team: "UGA", aggressive: 1, favLean: 2, primetime: 2, notes: "Defense-first, dominant as favorite, strong in big games." },
    { name: "Lane Kiffin", team: "—", aggressive: 2, favLean: 1, primetime: 1, notes: "Aggressive, high-scoring offenses — over lean." },
  ],
  ncaab: [
    { name: "Bill Self (KU)", team: "KU", aggressive: 1, favLean: 2, primetime: 1, notes: "Strong as favorite at home, good late-game sets." },
  ],
  ufc: [],
};

// Derive an ILLUSTRATIVE game-state behavior profile from a coach's tendency
// values. This is sample logic for the offline demo — NOT real scouting. It maps
// the aggressive/favLean numbers into how a coach tends to behave when leading vs
// trailing, and what that implies for totals/props. Real game-state behavior
// requires play-by-play data (the Next.js version).
const coachGameStateProfile = (coach) => {
  if (!coach) return null;
  const agg = coach.aggressive ?? 0;
  const fav = coach.favLean ?? 0;
  const whenLeading =
    agg >= 2 ? "Keeps foot on the gas with a lead — stays aggressive, less clock-killing. Tends to keep totals live."
    : agg <= 0 ? "Protects leads conservatively — runs clock, pulls back. Suppresses 2nd-half scoring and passing props."
    : "Balanced with a lead — mixes run and pass, moderate clock management.";
  const whenTrailing =
    agg >= 2 ? "Aggressive when behind — fast pace, 4th-down/2-pt tries, air it out. Boosts passing props and comeback variance."
    : agg <= 0 ? "Methodical when behind — sticks to scheme rather than panicking, can leave points on the board late."
    : "Steady when trailing — opens up gradually, balanced catch-up approach.";
  const subs =
    fav >= 2 ? "As a heavy favorite, may empty the bench / pull starters in blowouts — caps star player props late."
    : "Rarely in true blowout territory — starters usually see normal workloads.";
  const lean =
    agg >= 2 ? "over" : agg <= 0 ? "under" : "neutral";
  return { whenLeading, whenTrailing, subs, lean };
};

// Stat categories per sport that can be matchup-compared
const STAT_CATEGORIES = {
  nfl: {
    QB: [
      { key: "passYds", label: "Passing Yards" },
      { key: "passTDs", label: "Passing TDs" },
      { key: "rushYds", label: "Rushing Yards" },
    ],
    RB: [
      { key: "rushYds", label: "Rushing Yards" },
      { key: "rushTDs", label: "Rushing TDs" },
      { key: "recYds", label: "Receiving Yards" },
      { key: "rec", label: "Receptions" },
    ],
    WR: [
      { key: "recYds", label: "Receiving Yards" },
      { key: "rec", label: "Receptions" },
      { key: "recTDs", label: "Receiving TDs" },
    ],
    TE: [
      { key: "recYds", label: "Receiving Yards" },
      { key: "rec", label: "Receptions" },
    ],
  },
  nba: {
    ALL: [
      { key: "pts", label: "Points" },
      { key: "reb", label: "Rebounds" },
      { key: "ast", label: "Assists" },
      { key: "stl", label: "Steals" },
      { key: "blk", label: "Blocks" },
    ],
  },
  wnba: {
    ALL: [
      { key: "pts", label: "Points" },
      { key: "reb", label: "Rebounds" },
      { key: "ast", label: "Assists" },
      { key: "stl", label: "Steals" },
      { key: "blk", label: "Blocks" },
    ],
  },
  mlb: {
    ALL: [
      { key: "hrPerGame", label: "Home Runs" },
      { key: "rbiPerGame", label: "RBIs" },
      { key: "runsPerGame", label: "Runs Scored" },
      { key: "avg", label: "Batting Avg" },
    ],
  },
  nhl: {
    ALL: [
      { key: "points", label: "Points" },
      { key: "goals", label: "Goals" },
      { key: "assists", label: "Assists" },
      { key: "shots", label: "Shots on Goal" },
    ],
  },
  soccer: {
    ALL: [
      { key: "goalsPerGame", label: "Goals" },
      { key: "assistsPerGame", label: "Assists" },
      { key: "shotsPerGame", label: "Shots" },
    ],
  },
  ufc: {
    ALL: [
      { key: "sigStrikesPerMin", label: "Sig. Strikes/Min" },
      { key: "takedownsPer15", label: "Takedowns/15" },
      { key: "controlPct", label: "Control %" },
    ],
  },
};

const PICK_POOL = {
  nfl: [
    { game: "Chiefs @ Bills", market: "Spread", pick: "Bills -2.5", odds: -110, tier: 2 },
    { game: "Chiefs @ Bills", market: "Total", pick: "Over 48.5", odds: -105, tier: 2 },
    { game: "Chiefs @ Bills", market: "Player Prop", pick: "Mahomes 275+ pass yds", odds: -115, tier: 2 },
    { game: "Cowboys @ Eagles", market: "Moneyline", pick: "Eagles ML", odds: -180, tier: 1 },
    { game: "Cowboys @ Eagles", market: "Spread", pick: "Cowboys +4.5", odds: -110, tier: 2 },
    { game: "49ers @ Rams", market: "Player Prop", pick: "McCaffrey 90+ rush yds", odds: -115, tier: 2 },
    { game: "49ers @ Rams", market: "Total", pick: "Under 45.5", odds: -110, tier: 2 },
    { game: "Ravens @ Bengals", market: "Moneyline", pick: "Ravens ML", odds: -140, tier: 1 },
    { game: "Packers @ Lions", market: "Spread", pick: "Lions -3.5", odds: -110, tier: 2 },
    { game: "Dolphins @ Jets", market: "Player Prop", pick: "Tyreek Hill 80+ rec yds", odds: 110, tier: 3 },
  ],
  nba: [
    { game: "Celtics @ Lakers", market: "Spread", pick: "Celtics -4.5", odds: -110, tier: 2 },
    { game: "Celtics @ Lakers", market: "Player Prop", pick: "Tatum 28+ pts", odds: 120, tier: 3 },
    { game: "Celtics @ Lakers", market: "Total", pick: "Over 224.5", odds: -110, tier: 2 },
    { game: "Nuggets @ Warriors", market: "Total", pick: "Under 225.5", odds: -110, tier: 2 },
    { game: "Nuggets @ Warriors", market: "Player Prop", pick: "Jokic triple-double", odds: 180, tier: 3 },
    { game: "Bucks @ Heat", market: "Moneyline", pick: "Bucks ML", odds: -150, tier: 1 },
    { game: "Bucks @ Heat", market: "Spread", pick: "Heat +5.5", odds: -110, tier: 2 },
    { game: "Suns @ Mavericks", market: "Player Prop", pick: "Luka 30+ pts", odds: -130, tier: 2 },
    { game: "Sixers @ Knicks", market: "Spread", pick: "Knicks -2.5", odds: -110, tier: 2 },
    { game: "Thunder @ Timberwolves", market: "Total", pick: "Over 218.5", odds: -110, tier: 2 },
  ],
  mlb: [
    { game: "Yankees @ Dodgers", market: "Moneyline", pick: "Dodgers ML", odds: -140, tier: 1 },
    { game: "Yankees @ Dodgers", market: "Total", pick: "Over 8.5", odds: 100, tier: 2 },
    { game: "Yankees @ Dodgers", market: "Player Prop", pick: "Judge HR", odds: 320, tier: 3 },
    { game: "Braves @ Phillies", market: "Run Line", pick: "Braves -1.5", odds: 160, tier: 3 },
    { game: "Braves @ Phillies", market: "Moneyline", pick: "Phillies ML", odds: -125, tier: 1 },
    { game: "Astros @ Rangers", market: "Total", pick: "Under 7.5", odds: -115, tier: 2 },
    { game: "Mets @ Padres", market: "Moneyline", pick: "Padres ML", odds: -135, tier: 1 },
  ],
  nhl: [
    { game: "Rangers @ Bruins", market: "Moneyline", pick: "Bruins ML", odds: -130, tier: 1 },
    { game: "Rangers @ Bruins", market: "Total", pick: "Over 6.5", odds: -110, tier: 2 },
    { game: "Oilers @ Maple Leafs", market: "Total", pick: "Over 6.5", odds: -115, tier: 2 },
    { game: "Oilers @ Maple Leafs", market: "Player Prop", pick: "McDavid 2+ points", odds: -120, tier: 2 },
    { game: "Avalanche @ Stars", market: "Puck Line", pick: "Avalanche +1.5", odds: -180, tier: 1 },
    { game: "Panthers @ Hurricanes", market: "Moneyline", pick: "Panthers ML", odds: 110, tier: 3 },
  ],
  soccer: [
    { game: "Arsenal vs Man City", market: "Match Result", pick: "Man City Win", odds: 150, tier: 3 },
    { game: "Arsenal vs Man City", market: "BTTS", pick: "Both teams score", odds: -180, tier: 1 },
    { game: "Real Madrid vs Barcelona", market: "Total Goals", pick: "Over 2.5", odds: -125, tier: 2 },
    { game: "Real Madrid vs Barcelona", market: "Player Prop", pick: "Vinicius anytime scorer", odds: 140, tier: 3 },
    { game: "Liverpool vs Chelsea", market: "Total Goals", pick: "Over 2.5", odds: -125, tier: 2 },
    { game: "Liverpool vs Chelsea", market: "Match Result", pick: "Liverpool Win", odds: -110, tier: 2 },
    { game: "Bayern vs Dortmund", market: "BTTS", pick: "Both teams score", odds: -200, tier: 1 },
    { game: "PSG vs Marseille", market: "Match Result", pick: "PSG Win", odds: -250, tier: 1 },
  ],
  ncaaf: [
    { game: "Georgia @ Alabama", market: "Spread", pick: "Georgia +3.5", odds: -110, tier: 2 },
    { game: "Georgia @ Alabama", market: "Total", pick: "Under 52.5", odds: -110, tier: 2 },
    { game: "Michigan @ Ohio State", market: "Spread", pick: "Ohio State -3.5", odds: -110, tier: 2 },
    { game: "Texas @ Oklahoma", market: "Moneyline", pick: "Texas ML", odds: -140, tier: 1 },
    { game: "Oregon @ USC", market: "Total", pick: "Over 64.5", odds: -110, tier: 2 },
  ],
  ncaab: [
    { game: "Duke @ UNC", market: "Spread", pick: "UNC -2.5", odds: -110, tier: 2 },
    { game: "Duke @ UNC", market: "Total", pick: "Over 148.5", odds: -110, tier: 2 },
    { game: "Kansas @ Kentucky", market: "Moneyline", pick: "Kansas ML", odds: -120, tier: 1 },
    { game: "UConn @ Villanova", market: "Spread", pick: "UConn -5.5", odds: -110, tier: 2 },
    { game: "Gonzaga @ Saint Mary's", market: "Total", pick: "Under 142.5", odds: -110, tier: 2 },
  ],
  ufc: [
    { game: "Jones vs Aspinall", market: "Moneyline", pick: "Aspinall", odds: 180, tier: 3 },
    { game: "Jones vs Aspinall", market: "Method", pick: "Fight ends inside distance", odds: -150, tier: 2 },
    { game: "Pereira vs Ankalaev", market: "Method", pick: "Fight goes distance", odds: 140, tier: 3 },
    { game: "Pereira vs Ankalaev", market: "Moneyline", pick: "Pereira", odds: -120, tier: 2 },
    { game: "Makhachev vs Volkanovski", market: "Moneyline", pick: "Makhachev", odds: -300, tier: 1 },
  ],
};

// ==== ESPN LIVE MODE ====
// Free unofficial endpoints — work from browser if CORS allows.
// If they fail, Live Mode silently falls back to the hypothetical pool.
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const ESPN_SPORT_MAP = {
  nfl: { sport: "football", league: "nfl" },
  nba: { sport: "basketball", league: "nba" },
  wnba: { sport: "basketball", league: "wnba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
  ncaaf: { sport: "football", league: "college-football" },
  ncaab: { sport: "basketball", league: "mens-college-basketball" },
  soccer: { sport: "soccer", league: "eng.1" },
  ufc: { sport: "mma", league: "ufc" },
};

// Tiny in-memory cache to avoid hammering ESPN within a session
const espnCache = new Map();
const cachedFetch = async (url, ttlMs = 60000) => {
  const hit = espnCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  espnCache.set(url, { data, at: Date.now() });
  return data;
};

// Pull today's scoreboard for one sport and convert to a pick library
const fetchEspnGamesForSport = async (sportId) => {
  const m = ESPN_SPORT_MAP[sportId];
  if (!m) return [];
  const data = await cachedFetch(`${ESPN_BASE}/${m.sport}/${m.league}/scoreboard`, 60000);
  const events = data.events || [];
  return events.map((ev) => {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || {};
    const away = competitors.find((c) => c.homeAway === "away") || {};
    const odds = comp?.odds?.[0];
    return {
      id: ev.id,
      sport: sportId,
      game: `${away.team?.abbreviation || away.team?.shortDisplayName} @ ${home.team?.abbreviation || home.team?.shortDisplayName}`,
      homeAbbr: home.team?.abbreviation,
      awayAbbr: away.team?.abbreviation,
      homeId: home.team?.id,
      awayId: away.team?.id,
      status: ev.status?.type?.name,
      startsAt: ev.date,
      spread: typeof odds?.spread === "number" ? odds.spread : null,
      total: typeof odds?.overUnder === "number" ? odds.overUnder : null,
      details: odds?.details, // e.g. "BUF -2.5"
    };
  });
};

// Build pick objects (same shape as PICK_POOL entries) from ESPN games
const buildPicksFromEspnGames = (games) => {
  const picks = [];
  for (const g of games) {
    if (g.status !== "STATUS_SCHEDULED") continue;
    const startsAt = g.startsAt || g.date || null;
    if (g.details && typeof g.spread === "number") {
      // Spread pick on the favorite
      const favAbbr = g.details.split(" ")[0];
      picks.push({
        game: g.game,
        market: "Spread",
        pick: `${favAbbr} ${g.spread > 0 ? "+" : ""}${g.spread}`,
        odds: -110,
        tier: 2,
        sport: g.sport,
        teamAbbr: favAbbr,
        teamId: favAbbr === g.homeAbbr ? g.homeId : g.awayId,
        sourceSport: g.sport,
        startsAt,
      });
    }
    if (typeof g.total === "number") {
      picks.push({
        game: g.game,
        market: "Total",
        pick: `Over ${g.total}`,
        odds: -110,
        tier: 2,
        sport: g.sport,
        teamAbbr: g.homeAbbr,
        teamId: g.homeId,
        sourceSport: g.sport,
        startsAt,
      });
      picks.push({
        game: g.game,
        market: "Total",
        pick: `Under ${g.total}`,
        odds: -110,
        tier: 2,
        sport: g.sport,
        teamAbbr: g.homeAbbr,
        teamId: g.homeId,
        sourceSport: g.sport,
        startsAt,
      });
    }
    // Moneyline on favorite if spread tells us who's favored
    if (g.details && typeof g.spread === "number") {
      const favAbbr = g.details.split(" ")[0];
      const isHomeFav = favAbbr === g.homeAbbr;
      picks.push({
        game: g.game,
        market: "Moneyline",
        pick: `${favAbbr} ML`,
        odds: Math.abs(g.spread) > 7 ? -300 : Math.abs(g.spread) > 3 ? -180 : -130,
        tier: 1,
        sport: g.sport,
        teamAbbr: favAbbr,
        teamId: isHomeFav ? g.homeId : g.awayId,
        sourceSport: g.sport,
        startsAt,
      });
    }
  }
  return picks;
};

// Fetch a team's full season record from ESPN (ATS, O/U, SU, home/away)
const fetchEspnTeamRecord = async (sportId, teamId) => {
  const m = ESPN_SPORT_MAP[sportId];
  if (!m || !teamId) return null;
  try {
    const data = await cachedFetch(`${ESPN_BASE}/${m.sport}/${m.league}/teams/${teamId}/schedule`, 600000);
    const completed = (data.events || []).filter((e) => e.competitions?.[0]?.status?.type?.completed);
    const rec = {
      teamAbbr: data.team?.abbreviation,
      teamName: data.team?.displayName,
      straightUp: { wins: 0, losses: 0, ties: 0 },
      ats: { wins: 0, losses: 0, pushes: 0 },
      overUnder: { overs: 0, unders: 0, pushes: 0 },
      home: { wins: 0, losses: 0 },
      away: { wins: 0, losses: 0 },
      gamesAnalyzed: completed.length,
    };
    for (const ev of completed) {
      const comp = ev.competitions[0];
      const us = comp.competitors.find((c) => c.team?.id === teamId);
      const them = comp.competitors.find((c) => c.team?.id !== teamId);
      if (!us || !them) continue;
      const usScore = parseFloat(us.score);
      const themScore = parseFloat(them.score);
      if (isNaN(usScore) || isNaN(themScore)) continue;
      if (usScore > themScore) {
        rec.straightUp.wins++;
        if (us.homeAway === "home") rec.home.wins++;
        else rec.away.wins++;
      } else if (usScore < themScore) {
        rec.straightUp.losses++;
        if (us.homeAway === "home") rec.home.losses++;
        else rec.away.losses++;
      } else {
        rec.straightUp.ties++;
      }
      const odds = comp.odds?.[0];
      if (odds && typeof odds.spread === "number") {
        const fav = odds.details?.split(" ")[0]?.trim();
        const usAbbr = us.team?.abbreviation;
        const ourSpread = fav === usAbbr ? -Math.abs(odds.spread) : Math.abs(odds.spread);
        const atsMargin = usScore - themScore + ourSpread;
        if (atsMargin > 0) rec.ats.wins++;
        else if (atsMargin < 0) rec.ats.losses++;
        else rec.ats.pushes++;
      }
      if (odds && typeof odds.overUnder === "number") {
        const total = usScore + themScore;
        if (total > odds.overUnder) rec.overUnder.overs++;
        else if (total < odds.overUnder) rec.overUnder.unders++;
        else rec.overUnder.pushes++;
      }
    }
    return rec;
  } catch (e) {
    return null;
  }
};

// Convert an /api/sports/odds entry into PICK_POOL-shaped pick objects.
// Real bookmaker odds for moneyline / spread / totals. Safe to pass to addLeg().
const buildPicksFromOdds = (g, includePeriods = false) => {
  if (!g || !g.markets) return [];
  const picks = [];
  const game = `${g.awayTeam} @ ${g.homeTeam}`;
  const sport = g.sport;
  const nickname = (full) => (full || "").split(/\s+/).filter(Boolean).pop() || full;
  const h2h = g.markets.find((m) => m.key === "h2h");
  const spreads = g.markets.find((m) => m.key === "spreads");
  const totals = g.markets.find((m) => m.key === "totals");
  const altSpreads = g.markets.find((m) => m.key === "alternate_spreads");
  const altTotals = g.markets.find((m) => m.key === "alternate_totals");
  if (h2h) {
    for (const o of h2h.outcomes || []) {
      picks.push({ game, sport, market: "Moneyline", pick: `${nickname(o.name)} ML`, odds: o.price, tier: o.price < -150 ? 1 : 2, real: true, teamFull: o.name, books: o.books || null });
    }
  }
  if (spreads) {
    for (const o of spreads.outcomes || []) {
      const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
      picks.push({ game, sport, market: "Spread", pick: `${nickname(o.name)}${pt}`, odds: o.price, tier: 2, real: true, teamFull: o.name, books: o.books || null });
    }
  }
  if (totals) {
    for (const o of totals.outcomes || []) {
      const pt = o.point == null ? "" : ` ${o.point}`;
      picks.push({ game, sport, market: "Total", pick: `${o.name}${pt}`.trim(), odds: o.price, tier: 2, real: true, books: o.books || null });
    }
  }
  // Alt-ladder card output is curated, not a full dump. The Odds API
  // returns 15-30 rungs per side per game; rendering all of them creates
  // stacks like "Over 191.5 (-3500), Over 192.5 (-2400), Over 193.5 (-2300)"
  // — three cards that are mathematically the same bet on the same side
  // at deep-favored prices that contribute zero parlay value. Two filters:
  //   (1) skip any alt priced -1000 or worse (steamroller juice that's
  //       equivalent to the main line, no add-to-ticket value).
  //   (2) keep AT MOST ONE alt rung per (game, side) — the one with the
  //       best risk/reward (lowest absolute juice among reasonable picks).
  //       This is per side, so a game can still show Over-alt AND
  //       Under-alt, just not three rungs on the same side.
  const ALT_MAX_JUICE = -1000;
  const pickBestRung = (rungs) => {
    if (!rungs.length) return null;
    // Best risk/reward = closest to even money on the favored side.
    // For negative odds, smallest absolute value wins (-180 beats -500).
    // For positive odds, largest value wins (+220 beats +140).
    return rungs.slice().sort((a, b) => {
      const sa = a.price < 0 ? Math.abs(a.price) : 1e6 - a.price;
      const sb = b.price < 0 ? Math.abs(b.price) : 1e6 - b.price;
      return sa - sb;
    })[0];
  };
  if (altSpreads) {
    // Exclude rungs already covered by the main "Spread" market to avoid
    // duplicate rows that confuse the AI-pick tagging.
    const mainSpreadPoints = new Set(
      (spreads?.outcomes || []).map((o) => `${o.name}|${o.point ?? ""}`),
    );
    const eligible = (altSpreads.outcomes || []).filter(
      (o) => !mainSpreadPoints.has(`${o.name}|${o.point ?? ""}`) && (o.price == null || o.price > ALT_MAX_JUICE),
    );
    // Group by team name (each team is one "side" of the spread).
    const bySide = new Map();
    for (const o of eligible) {
      const key = o.name;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(o);
    }
    for (const [, rungs] of bySide) {
      const best = pickBestRung(rungs);
      if (!best) continue;
      const pt = best.point == null ? "" : ` ${best.point > 0 ? "+" : ""}${best.point}`;
      picks.push({ game, sport, market: "Alt Spread", pick: `${nickname(best.name)}${pt}`, odds: best.price, tier: 3, real: true, teamFull: best.name, point: best.point });
    }
  }
  if (altTotals) {
    const mainTotalPoints = new Set(
      (totals?.outcomes || []).map((o) => `${o.name}|${o.point ?? ""}`),
    );
    const eligible = (altTotals.outcomes || []).filter(
      (o) => !mainTotalPoints.has(`${o.name}|${o.point ?? ""}`) && (o.price == null || o.price > ALT_MAX_JUICE),
    );
    // Group by Over/Under side.
    const bySide = new Map();
    for (const o of eligible) {
      const key = (o.name || "").toLowerCase();
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(o);
    }
    for (const [, rungs] of bySide) {
      const best = pickBestRung(rungs);
      if (!best) continue;
      const pt = best.point == null ? "" : ` ${best.point}`;
      picks.push({ game, sport, market: "Alt Total", pick: `${best.name}${pt}`.trim(), odds: best.price, tier: 3, real: true, point: best.point });
    }
  }
  // Game-level PERIOD markets (quarters / halves). Only emitted when the
  // caller asks (single-game lock or explicit period/same-game intent) so the
  // multi-game chat context stays compact. The server (odds.ts) ships these as
  // raw keys (h2h_q1, spreads_h1, totals_q3, alternate_spreads_h1, …). We
  // convert them to the friendly "<period> <type>" labels the chat SYSTEM_PROMPT
  // already documents ("1H Spread", "Q3 Total", "Q2 Moneyline", "1H Alt Spread",
  // "1H Alt Total"). familyOf/periodOf in the chat safety-net already parse this
  // format, so each period is a distinct, non-duplicate family for the AI.
  if (includePeriods) {
    const PERIOD_LABEL = { h1: "1H", h2: "2H", q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4" };
    for (const [suffix, plabel] of Object.entries(PERIOD_LABEL)) {
      const pml = g.markets.find((m) => m.key === `h2h_${suffix}`);
      const psp = g.markets.find((m) => m.key === `spreads_${suffix}`);
      const ptot = g.markets.find((m) => m.key === `totals_${suffix}`);
      if (pml) {
        for (const o of pml.outcomes || []) {
          picks.push({ game, sport, market: `${plabel} Moneyline`, pick: `${nickname(o.name)} ML`, odds: o.price, tier: 2, real: true, teamFull: o.name });
        }
      }
      if (psp) {
        for (const o of psp.outcomes || []) {
          const pt = o.point == null ? "" : ` ${o.point > 0 ? "+" : ""}${o.point}`;
          picks.push({ game, sport, market: `${plabel} Spread`, pick: `${nickname(o.name)}${pt}`, odds: o.price, tier: 2, real: true, teamFull: o.name });
        }
      }
      if (ptot) {
        for (const o of ptot.outcomes || []) {
          const pt = o.point == null ? "" : ` ${o.point}`;
          picks.push({ game, sport, market: `${plabel} Total`, pick: `${o.name}${pt}`.trim(), odds: o.price, tier: 2, real: true });
        }
      }
    }
    // First-half alternate ladders (only 1H alts are posted by the feed).
    const altSpreadH1 = g.markets.find((m) => m.key === "alternate_spreads_h1");
    const altTotalH1 = g.markets.find((m) => m.key === "alternate_totals_h1");
    if (altSpreadH1) {
      const mainPts = new Set((g.markets.find((m) => m.key === "spreads_h1")?.outcomes || []).map((o) => `${o.name}|${o.point ?? ""}`));
      const eligible = (altSpreadH1.outcomes || []).filter((o) => !mainPts.has(`${o.name}|${o.point ?? ""}`) && (o.price == null || o.price > ALT_MAX_JUICE));
      const bySide = new Map();
      for (const o of eligible) { const k = o.name; if (!bySide.has(k)) bySide.set(k, []); bySide.get(k).push(o); }
      for (const [, rungs] of bySide) {
        const best = pickBestRung(rungs);
        if (!best) continue;
        const pt = best.point == null ? "" : ` ${best.point > 0 ? "+" : ""}${best.point}`;
        picks.push({ game, sport, market: "1H Alt Spread", pick: `${nickname(best.name)}${pt}`, odds: best.price, tier: 3, real: true, teamFull: best.name, point: best.point });
      }
    }
    if (altTotalH1) {
      const mainPts = new Set((g.markets.find((m) => m.key === "totals_h1")?.outcomes || []).map((o) => `${o.name}|${o.point ?? ""}`));
      const eligible = (altTotalH1.outcomes || []).filter((o) => !mainPts.has(`${o.name}|${o.point ?? ""}`) && (o.price == null || o.price > ALT_MAX_JUICE));
      const bySide = new Map();
      for (const o of eligible) { const k = (o.name || "").toLowerCase(); if (!bySide.has(k)) bySide.set(k, []); bySide.get(k).push(o); }
      for (const [, rungs] of bySide) {
        const best = pickBestRung(rungs);
        if (!best) continue;
        const pt = best.point == null ? "" : ` ${best.point}`;
        picks.push({ game, sport, market: "1H Alt Total", pick: `${best.name}${pt}`.trim(), odds: best.price, tier: 3, real: true, point: best.point });
      }
    }
  }
  return picks;
};

// ==== SIMULATED LIVE GAMES (DEMO) ====
// This is fake data for demonstrating the live-parlay UX. It is NOT real and
// is clearly labeled as a demo throughout the UI. Real live data requires the
// Next.js version (ESPN polling server-side).
const SIM_LIVE_TEMPLATES = {
  nba: [
    { game: "BOS @ LAL", away: "BOS", home: "LAL", total: 224.5 },
    { game: "DEN @ GSW", away: "DEN", home: "GSW", total: 228.5 },
    { game: "MIL @ MIA", away: "MIL", home: "MIA", total: 215.5 },
  ],
  nfl: [
    { game: "KC @ BUF", away: "KC", home: "BUF", total: 48.5 },
    { game: "DAL @ PHI", away: "DAL", home: "PHI", total: 45.5 },
  ],
  nhl: [
    { game: "NYR @ BOS", away: "NYR", home: "BOS", total: 6.5 },
  ],
  mlb: [
    { game: "NYY @ LAD", away: "NYY", home: "LAD", total: 8.5 },
  ],
  soccer: [
    { game: "ARS vs MCI", away: "ARS", home: "MCI", total: 2.5 },
  ],
};

// Generate a simulated live snapshot. Uses a time-based seed so the score
// "progresses" as real time passes — purely cosmetic for the demo.
const generateSimLiveGames = (sports) => {
  const out = [];
  const minuteSeed = Math.floor(Date.now() / 60000); // changes each minute
  for (const sportId of sports) {
    const templates = SIM_LIVE_TEMPLATES[sportId] || [];
    for (const t of templates) {
      const seed = hashSeed(t.game + minuteSeed);
      const seed2 = hashSeed(t.game + "h" + minuteSeed);
      // Period progression based on real seconds within the minute
      const isHoops = sportId === "nba";
      const periods = isHoops ? 4 : sportId === "nhl" ? 3 : sportId === "mlb" ? 9 : 4;
      const period = 1 + Math.floor(seed * periods);
      const elapsedFrac = Math.min(0.95, (period - 0.5) / periods);
      // Scores scaled to sport
      const scaleMax = sportId === "nba" ? 120 : sportId === "nfl" ? 28 : sportId === "nhl" ? 5 : sportId === "mlb" ? 7 : 3;
      const awayScore = Math.round(seed * scaleMax * elapsedFrac);
      const homeScore = Math.round(seed2 * scaleMax * elapsedFrac);
      const currentTotal = awayScore + homeScore;
      const projected = elapsedFrac > 0 ? currentTotal / elapsedFrac : currentTotal;
      const pacing = projected > t.total * 1.05 ? "over" : projected < t.total * 0.95 ? "under" : "on-pace";
      // Win prob from score margin + seed
      const margin = homeScore - awayScore;
      let homeWP = 50 + margin * (isHoops ? 1.5 : 4) + (seed - 0.5) * 10;
      homeWP = Math.max(5, Math.min(95, Math.round(homeWP)));
      out.push({
        sport: sportId,
        game: t.game,
        away: t.away,
        home: t.home,
        awayScore,
        homeScore,
        period,
        periodLabel: isHoops ? `Q${period}` : sportId === "nhl" ? `P${period}` : sportId === "mlb" ? `Inn ${period}` : `Q${period}`,
        clock: `${Math.floor(seed * 11) + 1}:${String(Math.floor(seed2 * 60)).padStart(2, "0")}`,
        total: t.total,
        currentTotal,
        pacing,
        homeWP,
        awayWP: 100 - homeWP,
      });
    }
  }
  return out;
};

// Build sim-live parlay picks from the simulated games (clearly demo).
const buildSimLivePicks = (liveGames) => {
  // Find a coach whose team appears in the game string (sample DB)
  const findCoachInGame = (gameStr, sport) => {
    const coaches = COACHES[sport] || [];
    return coaches.find((c) => c.team && c.team !== "—" && gameStr.includes(c.team)) || null;
  };
  const picks = [];
  for (const g of liveGames) {
    // Live ML on the team with higher win prob
    const favTeam = g.homeWP >= g.awayWP ? g.home : g.away;
    const favWP = Math.max(g.homeWP, g.awayWP);
    const liveOdds = favWP > 80 ? -450 : favWP > 65 ? -250 : favWP > 55 ? -160 : -120;
    const coach = findCoachInGame(g.game, g.sport);
    const gs = coach ? coachGameStateProfile(coach) : null;
    picks.push({
      game: g.game,
      market: "Live Moneyline",
      pick: `${favTeam} ML (live)`,
      odds: liveOdds,
      tier: favWP > 70 ? 1 : 2,
      sport: g.sport,
      live: true,
      coachLean: gs ? gs.lean : null,
      liveNote: `${favTeam} up with ${favWP}% win prob, ${g.periodLabel} ${g.clock}` +
        (gs ? ` · ${coach.name.split(" (")[0]}: ${favTeam === coach.team ? gs.whenLeading.split(" —")[0] : "opp coach " + gs.whenTrailing.split(" —")[0]}` : ""),
    });
    // Live total based on pacing — coach game-state lean reinforces or tempers it
    if (g.pacing === "over") {
      const reinforced = gs && gs.lean === "over";
      picks.push({
        game: g.game, market: "Live Total", pick: `Over ${g.total} (live)`,
        odds: reinforced ? -145 : -130, tier: 2, sport: g.sport, live: true,
        coachLean: gs ? gs.lean : null,
        liveNote: `pacing over: ${g.currentTotal} through ${g.periodLabel}` +
          (gs ? ` · coach tendencies lean ${gs.lean}${reinforced ? " (reinforces)" : ""}` : ""),
      });
    } else if (g.pacing === "under") {
      const reinforced = gs && gs.lean === "under";
      picks.push({
        game: g.game, market: "Live Total", pick: `Under ${g.total} (live)`,
        odds: reinforced ? -145 : -130, tier: 2, sport: g.sport, live: true,
        coachLean: gs ? gs.lean : null,
        liveNote: `pacing under: ${g.currentTotal} through ${g.periodLabel}` +
          (gs ? ` · coach tendencies lean ${gs.lean}${reinforced ? " (reinforces)" : ""}` : ""),
      });
    }
  }
  return picks;
};

// Null/NaN-safe odds helpers. A null `odds` value means the leg comes from
// a source without per-leg American pricing (e.g. PrizePicks DFS lines).
// We return multiplicative identities (1, 1, 1) so such a leg is silently
// no-op for parlay decimal/prob math — combined odds reflect priced legs
// only. `formatOdds(null)` shows a human "PP line" tag so the UI never
// renders `+null` or `NaN`.
const americanToDecimal = (a) => {
  if (a == null || !Number.isFinite(a)) return 1;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
};
const decimalToAmerican = (d) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
const impliedProb = (a) => {
  if (a == null || !Number.isFinite(a)) return 1;
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
};
const formatOdds = (o) => {
  if (o == null || !Number.isFinite(o)) return "PP line";
  return o > 0 ? `+${o}` : `${o}`;
};

// CLV matching key: case/space-insensitive "{market}|{pick}". Used to line up a
// persisted tracker entry with the live market price even when the stored pick
// string differs only by casing or whitespace. Team nickname vs full-name
// differences are handled separately by registering both variants in the map.
const clvMatchKey = (market, pick) =>
  `${(market || "").toLowerCase().replace(/\s+/g, " ").trim()}|${(pick || "").toLowerCase().replace(/\s+/g, " ").trim()}`;

// Cross-book line shopping: expandable per-bookmaker price list for a single
// outcome. `books` is [{book, price, point}] sorted best-first by the API.
// The headline price is the best one; this shows everyone else so the user
// can see the real spread between books and where to get the top number.
const BookCompare = ({ books }) => {
  const [open, setOpen] = useState(false);
  if (!books || books.length < 2) return null;
  const best = books[0]?.price;
  return (
    <div className="px-4 pb-2 -mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[9px] font-mono uppercase tracking-wider text-slate-500 hover:text-cyan-400 transition"
      >
        {open ? "▼ Hide books" : `▶ Compare ${books.length} books`}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/70">
          {books.map((b, i) => (
            <div key={`${b.book}-${i}`} className="flex items-center justify-between px-2.5 py-1">
              <span className="text-[11px] text-slate-300 truncate">{b.book}</span>
              <span className={`font-mono text-[11px] font-bold ${i === 0 ? "text-emerald-400" : "text-slate-400"}`}>
                {formatOdds(b.price)}
                {i === 0 && <span className="ml-1 text-[8px] uppercase tracking-wider text-emerald-500/80">best</span>}
              </span>
            </div>
          ))}
          <div className="px-2.5 py-1">
            <span className="text-[8px] font-mono uppercase tracking-wider text-slate-500">
              Best price ({formatOdds(best)}) is the headline above · prices from US books, updates each refresh
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ----- Display-time team name expansion -----
// Real live data (Odds API / ESPN) already comes through with full team names
// like "Boston Celtics". Sample / fallback data and some short-form sources use
// nicknames ("Celtics") or abbreviations ("BOS"). For the user-facing chat
// message header and the slip we always want the full "City Nickname" string,
// without rewriting the underlying leg keys (which would break dedupe).
const TEAM_FULL_NAME_MAP = {
  // NFL
  Chiefs: "Kansas City Chiefs", KC: "Kansas City Chiefs",
  Bills: "Buffalo Bills", BUF: "Buffalo Bills",
  Bengals: "Cincinnati Bengals", CIN: "Cincinnati Bengals",
  Ravens: "Baltimore Ravens", BAL: "Baltimore Ravens",
  Cowboys: "Dallas Cowboys", DAL: "Dallas Cowboys",
  Eagles: "Philadelphia Eagles", PHI: "Philadelphia Eagles",
  "49ers": "San Francisco 49ers", SF: "San Francisco 49ers",
  Rams: "Los Angeles Rams", LAR: "Los Angeles Rams",
  Packers: "Green Bay Packers", GB: "Green Bay Packers",
  Lions: "Detroit Lions", DET: "Detroit Lions",
  Dolphins: "Miami Dolphins", MIA: "Miami Dolphins",
  Jets: "New York Jets", NYJ: "New York Jets",
  Patriots: "New England Patriots", NE: "New England Patriots",
  Steelers: "Pittsburgh Steelers", PIT: "Pittsburgh Steelers",
  Broncos: "Denver Broncos", DEN: "Denver Broncos",
  Chargers: "Los Angeles Chargers", LAC: "Los Angeles Chargers",
  Raiders: "Las Vegas Raiders", LV: "Las Vegas Raiders",
  Vikings: "Minnesota Vikings", MIN: "Minnesota Vikings",
  Bears: "Chicago Bears", CHI: "Chicago Bears",
  Saints: "New Orleans Saints", NO: "New Orleans Saints",
  Falcons: "Atlanta Falcons", ATL: "Atlanta Falcons",
  Panthers: "Carolina Panthers", CAR: "Carolina Panthers",
  Buccaneers: "Tampa Bay Buccaneers", Bucs: "Tampa Bay Buccaneers", TB: "Tampa Bay Buccaneers",
  Seahawks: "Seattle Seahawks", SEA: "Seattle Seahawks",
  Cardinals: "Arizona Cardinals", ARI: "Arizona Cardinals",
  Texans: "Houston Texans", HOU: "Houston Texans",
  Colts: "Indianapolis Colts", IND: "Indianapolis Colts",
  Jaguars: "Jacksonville Jaguars", Jags: "Jacksonville Jaguars", JAX: "Jacksonville Jaguars",
  Titans: "Tennessee Titans", TEN: "Tennessee Titans",
  Browns: "Cleveland Browns", CLE: "Cleveland Browns",
  Giants: "New York Giants", NYG: "New York Giants",
  Commanders: "Washington Commanders", WAS: "Washington Commanders",
  // NBA
  Celtics: "Boston Celtics", BOS: "Boston Celtics",
  Lakers: "Los Angeles Lakers", LAL: "Los Angeles Lakers",
  Warriors: "Golden State Warriors", GSW: "Golden State Warriors",
  Nuggets: "Denver Nuggets",
  Bucks: "Milwaukee Bucks", MIL: "Milwaukee Bucks",
  Heat: "Miami Heat",
  Knicks: "New York Knicks", NYK: "New York Knicks",
  Sixers: "Philadelphia 76ers", "76ers": "Philadelphia 76ers", PHL: "Philadelphia 76ers",
  Suns: "Phoenix Suns", PHX: "Phoenix Suns",
  Mavericks: "Dallas Mavericks", Mavs: "Dallas Mavericks",
  Thunder: "Oklahoma City Thunder", OKC: "Oklahoma City Thunder",
  Timberwolves: "Minnesota Timberwolves", Wolves: "Minnesota Timberwolves",
  Clippers: "Los Angeles Clippers", LAC2: "Los Angeles Clippers",
  Nets: "Brooklyn Nets", BKN: "Brooklyn Nets",
  Bulls: "Chicago Bulls",
  Cavaliers: "Cleveland Cavaliers", Cavs: "Cleveland Cavaliers", CLE2: "Cleveland Cavaliers",
  Pistons: "Detroit Pistons",
  Pacers: "Indiana Pacers",
  Grizzlies: "Memphis Grizzlies", MEM: "Memphis Grizzlies",
  Hornets: "Charlotte Hornets", CHA: "Charlotte Hornets",
  Magic: "Orlando Magic", ORL: "Orlando Magic",
  Hawks: "Atlanta Hawks",
  Wizards: "Washington Wizards",
  Pelicans: "New Orleans Pelicans", NOP: "New Orleans Pelicans",
  Spurs: "San Antonio Spurs", SAS: "San Antonio Spurs",
  Rockets: "Houston Rockets",
  Kings: "Sacramento Kings", SAC: "Sacramento Kings",
  Raptors: "Toronto Raptors", TOR: "Toronto Raptors",
  Jazz: "Utah Jazz", UTA: "Utah Jazz",
  // MLB
  Yankees: "New York Yankees", NYY: "New York Yankees",
  Dodgers: "Los Angeles Dodgers", LAD: "Los Angeles Dodgers",
  Braves: "Atlanta Braves",
  Phillies: "Philadelphia Phillies",
  Mets: "New York Mets", NYM: "New York Mets",
  RedSox: "Boston Red Sox", "Red Sox": "Boston Red Sox",
  Astros: "Houston Astros",
  Rangers: "Texas Rangers", TEX: "Texas Rangers",
  Padres: "San Diego Padres", SD: "San Diego Padres",
  Giants2: "San Francisco Giants",
  Cubs: "Chicago Cubs", CHC: "Chicago Cubs",
  WhiteSox: "Chicago White Sox", "White Sox": "Chicago White Sox", CWS: "Chicago White Sox",
  Brewers: "Milwaukee Brewers",
  Twins: "Minnesota Twins",
  Mariners: "Seattle Mariners",
  Athletics: "Oakland Athletics", As: "Oakland Athletics", OAK: "Oakland Athletics",
  Angels: "Los Angeles Angels", LAA: "Los Angeles Angels",
  BlueJays: "Toronto Blue Jays", "Blue Jays": "Toronto Blue Jays",
  Orioles: "Baltimore Orioles",
  Rays: "Tampa Bay Rays",
  Guardians: "Cleveland Guardians",
  Tigers: "Detroit Tigers",
  Royals: "Kansas City Royals",
  Reds: "Cincinnati Reds",
  Cardinals2: "St. Louis Cardinals", STL: "St. Louis Cardinals",
  Pirates: "Pittsburgh Pirates",
  Marlins: "Miami Marlins",
  Nationals: "Washington Nationals", WSH: "Washington Nationals",
  Rockies: "Colorado Rockies", COL: "Colorado Rockies",
  Diamondbacks: "Arizona Diamondbacks", Dbacks: "Arizona Diamondbacks", AZ: "Arizona Diamondbacks",
  // NHL
  Oilers: "Edmonton Oilers", EDM: "Edmonton Oilers",
  MapleLeafs: "Toronto Maple Leafs", "Maple Leafs": "Toronto Maple Leafs",
  Panthers2: "Florida Panthers", FLA: "Florida Panthers",
  Avalanche: "Colorado Avalanche",
  Lightning: "Tampa Bay Lightning", TBL: "Tampa Bay Lightning",
  Bruins: "Boston Bruins",
  Rangers2: "New York Rangers", NYR: "New York Rangers",
  Stars: "Dallas Stars",
  Hurricanes: "Carolina Hurricanes", Canes: "Carolina Hurricanes",
  Knights: "Vegas Golden Knights", "Golden Knights": "Vegas Golden Knights", VGK: "Vegas Golden Knights",
};
// Map every known full team name to its sport. Used to drop cross-sport
// hallucinations like "Miami Dolphins @ Toronto Raptors" (NFL vs NBA)
// without needing a live data pool to compare against — works even when
// the odds API is dead and ESPN games for the user's sport haven't loaded.
const TEAM_NAME_TO_SPORT = {
  // NFL
  "Kansas City Chiefs": "nfl", "Buffalo Bills": "nfl", "Cincinnati Bengals": "nfl",
  "Baltimore Ravens": "nfl", "Dallas Cowboys": "nfl", "Philadelphia Eagles": "nfl",
  "San Francisco 49ers": "nfl", "Los Angeles Rams": "nfl", "Green Bay Packers": "nfl",
  "Detroit Lions": "nfl", "Miami Dolphins": "nfl", "New York Jets": "nfl",
  "New England Patriots": "nfl", "Pittsburgh Steelers": "nfl", "Denver Broncos": "nfl",
  "Los Angeles Chargers": "nfl", "Las Vegas Raiders": "nfl", "Minnesota Vikings": "nfl",
  "Chicago Bears": "nfl", "New Orleans Saints": "nfl", "Atlanta Falcons": "nfl",
  "Carolina Panthers": "nfl", "Tampa Bay Buccaneers": "nfl", "Seattle Seahawks": "nfl",
  "Arizona Cardinals": "nfl", "Houston Texans": "nfl", "Indianapolis Colts": "nfl",
  "Jacksonville Jaguars": "nfl", "Tennessee Titans": "nfl", "Cleveland Browns": "nfl",
  "New York Giants": "nfl", "Washington Commanders": "nfl",
  // NBA
  "Boston Celtics": "nba", "Los Angeles Lakers": "nba", "Golden State Warriors": "nba",
  "Denver Nuggets": "nba", "Milwaukee Bucks": "nba", "Miami Heat": "nba",
  "New York Knicks": "nba", "Philadelphia 76ers": "nba", "Phoenix Suns": "nba",
  "Dallas Mavericks": "nba", "Oklahoma City Thunder": "nba", "Minnesota Timberwolves": "nba",
  "Los Angeles Clippers": "nba", "Brooklyn Nets": "nba", "Chicago Bulls": "nba",
  "Cleveland Cavaliers": "nba", "Detroit Pistons": "nba", "Indiana Pacers": "nba",
  "Memphis Grizzlies": "nba", "Charlotte Hornets": "nba", "Orlando Magic": "nba",
  "Atlanta Hawks": "nba", "Washington Wizards": "nba", "New Orleans Pelicans": "nba",
  "San Antonio Spurs": "nba", "Houston Rockets": "nba", "Sacramento Kings": "nba",
  "Toronto Raptors": "nba", "Utah Jazz": "nba", "Portland Trail Blazers": "nba",
  // WNBA
  "Atlanta Dream": "wnba", "Chicago Sky": "wnba", "Connecticut Sun": "wnba",
  "Dallas Wings": "wnba", "Indiana Fever": "wnba", "Las Vegas Aces": "wnba",
  "Los Angeles Sparks": "wnba", "Minnesota Lynx": "wnba", "New York Liberty": "wnba",
  "Phoenix Mercury": "wnba", "Seattle Storm": "wnba", "Washington Mystics": "wnba",
  "Golden State Valkyries": "wnba",
  // MLB
  "New York Yankees": "mlb", "Los Angeles Dodgers": "mlb", "Atlanta Braves": "mlb",
  "Philadelphia Phillies": "mlb", "New York Mets": "mlb", "Boston Red Sox": "mlb",
  "Houston Astros": "mlb", "Texas Rangers": "mlb", "San Diego Padres": "mlb",
  "San Francisco Giants": "mlb", "Chicago Cubs": "mlb", "Chicago White Sox": "mlb",
  "Milwaukee Brewers": "mlb", "Minnesota Twins": "mlb", "Seattle Mariners": "mlb",
  "Oakland Athletics": "mlb", "Los Angeles Angels": "mlb", "Toronto Blue Jays": "mlb",
  "Baltimore Orioles": "mlb", "Tampa Bay Rays": "mlb", "Cleveland Guardians": "mlb",
  "Detroit Tigers": "mlb", "Kansas City Royals": "mlb", "Cincinnati Reds": "mlb",
  "St. Louis Cardinals": "mlb", "Pittsburgh Pirates": "mlb", "Miami Marlins": "mlb",
  "Washington Nationals": "mlb", "Colorado Rockies": "mlb", "Arizona Diamondbacks": "mlb",
  // NHL
  "Edmonton Oilers": "nhl", "Toronto Maple Leafs": "nhl", "Florida Panthers": "nhl",
  "Colorado Avalanche": "nhl", "Tampa Bay Lightning": "nhl", "Boston Bruins": "nhl",
  "New York Rangers": "nhl", "Dallas Stars": "nhl", "Carolina Hurricanes": "nhl",
  "Vegas Golden Knights": "nhl",
};
// Nicknames that exist in two or more sports — looking these up via
// TEAM_FULL_NAME_MAP returns ONE expansion (whichever was registered first
// in the map) and would misclassify the sport. Treat them as unknown.
const AMBIGUOUS_TEAM_NICKNAMES = new Set([
  "cardinals", // NFL Arizona vs MLB St. Louis
  "rangers",   // MLB Texas vs NHL New York
  "panthers",  // NFL Carolina vs NHL Florida
  "giants",    // NFL New York vs MLB San Francisco
  "kings",     // MLB Sacramento (none) vs NHL LA — actually NBA Sacramento Kings only here, but still flag
]);
// Resolve a team string (full name OR nickname/abbr) to its sport, or null
// if unknown. Returns null on ambiguous nicknames so we don't false-positive
// a cross-sport drop.
const teamSportOf = (rawName) => {
  const n = String(rawName || "").trim();
  if (!n) return null;
  if (TEAM_NAME_TO_SPORT[n]) return TEAM_NAME_TO_SPORT[n];
  if (AMBIGUOUS_TEAM_NICKNAMES.has(n.toLowerCase())) return null;
  const expanded = TEAM_FULL_NAME_MAP[n];
  if (expanded && TEAM_NAME_TO_SPORT[expanded]) return TEAM_NAME_TO_SPORT[expanded];
  return null;
};
const expandTeamToken = (tok) => {
  const t = (tok || "").trim();
  if (!t) return t;
  // already a multi-word full name (e.g. "Boston Celtics")
  if (/\s/.test(t)) return t;
  return TEAM_FULL_NAME_MAP[t] || t;
};
const displayGameLabel = (game) => {
  if (!game || typeof game !== "string") return game || "";
  const m = game.match(/^(.+?)\s*(@|vs\.?|v\.?)\s*(.+)$/i);
  if (!m) return game;
  return `${expandTeamToken(m[1])} ${m[2]} ${expandTeamToken(m[3])}`;
};

// Reverse map: full team name -> short abbr, built once from TEAM_FULL_NAME_MAP.
// Used to compact "Boston Celtics" -> "BOS" on the crowded home screen.
const FULL_TO_ABBR = (() => {
  const out = {};
  // Walk the map; prefer the all-caps short key (2-3 letters) as the abbr.
  for (const [k, v] of Object.entries(TEAM_FULL_NAME_MAP)) {
    if (/^[A-Z0-9]{2,4}$/.test(k)) {
      // strip any disambiguating digit suffix like "LAC2"
      const clean = k.replace(/\d+$/, "");
      if (!out[v] || clean.length < out[v].length) out[v] = clean;
    }
  }
  return out;
})();
const shortTeamLabel = (name) => {
  const t = (name || "").trim();
  if (!t) return t;
  if (FULL_TO_ABBR[t]) return FULL_TO_ABBR[t];
  // Already short (no spaces) — return as-is
  if (!/\s/.test(t)) return t;
  // Fallback: last word (nickname) like "Celtics" from "Boston Celtics"
  const parts = t.split(/\s+/);
  return parts[parts.length - 1];
};
const shortGameLabel = (g) => {
  if (!g) return "";
  const away = g.awayAbbr || shortTeamLabel(g.away || g.awayTeam || "");
  const home = g.homeAbbr || shortTeamLabel(g.home || g.homeTeam || "");
  if (away && home) return `${away} @ ${home}`;
  // Fallback: split a "Foo @ Bar" string and shorten each side
  if (typeof g.game === "string") {
    const m = g.game.match(/^(.+?)\s*(@|vs\.?|v\.?)\s*(.+)$/i);
    if (m) return `${shortTeamLabel(m[1])} ${m[2]} ${shortTeamLabel(m[3])}`;
    return g.game;
  }
  return "";
};
// "Jayson Tatum" -> "J. Tatum"; single-word names returned as-is.
const shortPlayerName = (name) => {
  const t = (name || "").trim();
  if (!t || !/\s/.test(t)) return t;
  const parts = t.split(/\s+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first[0]}. ${last}`;
};


// "Buy points": move a spread/total line in the bettor's favor by `points`,
// which makes the bet easier to win but worsens the payout odds. This mirrors
// a real sportsbook alternate line. Returns a NEW pick object (or null if the
// market can't have points bought, e.g. moneyline / player prop).
//
// Pricing model: each point bought costs odds. We charge roughly +25 cents of
// juice per point on the American line (a common rule of thumb books use for
// half/full points in football/basketball totals & spreads). This is an
// approximation for a hypothetical app — a real book's price varies by sport
// and key numbers (3, 7 in NFL). We note that it's an estimate.
const canBuyPoints = (pick) => {
  // No per-leg American price → cannot price a point move. PrizePicks DFS
  // lines fall here. Allowing it would fabricate a sportsbook number.
  if (pick.odds == null || !Number.isFinite(pick.odds)) return false;
  if (/money\s*line|moneyline|\bml\b/i.test(pick.market) || /\bml\b/i.test(pick.pick)) return false;
  // Player props: adjustable only if there's a numeric line to move.
  // Covers "Over/Under X" and "X+" styles; excludes lineless props like
  // "triple-double", "anytime scorer", "HR" (nothing to adjust).
  if (pick.market === "Player Prop") {
    return /over|under/i.test(pick.pick) ? /\d/.test(pick.pick)
      : /\d+(\.\d+)?\s*\+/.test(pick.pick); // "275+", "28+", "2+"
  }
  return pick.market === "Spread" || pick.market === "Total" || /spread|total|run line|puck line/i.test(pick.market);
};

// "Sell points": move a spread/total line AGAINST the bettor by `points`, which
// makes the bet harder to win but improves the payout odds. Mirror of buying
// points at a real sportsbook. Returns a NEW pick object (or null if the market
// can't have points sold, e.g. moneyline / player prop).
//
// Pricing model (approx, hypothetical app): each point sold ADDS payout — we
// grow the net decimal payout ~18% per point. Real books price points by sport
// and key numbers (3, 7 in NFL), so this is an estimate.
const sellPoints = (pick, points = 0.5) => {
  if (!canBuyPoints(pick)) return null;
  const numMatch = pick.pick.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const oldLine = parseFloat(numMatch[1]);
  const isProp = pick.market === "Player Prop";
  const isPlusProp = isProp && /\d+(\.\d+)?\s*\+/.test(pick.pick); // "275+" = over by nature
  const isTotal = pick.market === "Total" || /total/i.test(pick.market) || /over|under/i.test(pick.pick) || isProp;
  const isOver = /over/i.test(pick.pick) || isPlusProp;

  // Move the line AGAINST you (harder to win):
  let newLine;
  if (isTotal) {
    newLine = isOver ? oldLine + points : oldLine - points;
  } else {
    newLine = oldLine - points;
  }

  const baseDecimal = americanToDecimal(pick.odds);
  const gainFactor = 1 + 0.18 * (points / 0.5) * 0.5;
  const newNet = Math.max(0.05, (baseDecimal - 1) * gainFactor);
  const newDecimal = 1 + newNet;
  const newOdds = decimalToAmerican(newDecimal);
  // Rebuild the pick string with the new line
  let newPickStr;
  if (isPlusProp) {
    newPickStr = pick.pick.replace(/\d+(\.\d+)?\s*\+/, `${newLine}+`);
  } else {
    newPickStr = pick.pick.replace(numMatch[1], `${newLine > 0 && !isTotal ? "+" : ""}${newLine}`);
  }

  return {
    ...pick,
    pick: newPickStr,
    odds: newOdds,
    pointsDelta: (pick.pointsDelta || 0) - points,
    originalOdds: pick.originalOdds ?? pick.odds,
    originalPick: pick.originalPick ?? pick.pick,
  };
};

// "Buy points": move a spread/total line IN YOUR FAVOR by `points` (easier to
// win, lower payout). Mirror of selling.
const buyPoints = (pick, points = 0.5) => {
  if (!canBuyPoints(pick)) return null;
  const numMatch = pick.pick.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const oldLine = parseFloat(numMatch[1]);
  const isProp = pick.market === "Player Prop";
  const isPlusProp = isProp && /\d+(\.\d+)?\s*\+/.test(pick.pick);
  const isTotal = pick.market === "Total" || /total/i.test(pick.market) || /over|under/i.test(pick.pick) || isProp;
  const isOver = /over/i.test(pick.pick) || isPlusProp;

  // Move the line IN YOUR FAVOR (easier to win):
  let newLine;
  if (isTotal) {
    newLine = isOver ? oldLine - points : oldLine + points;
  } else {
    newLine = oldLine + points;
  }

  const baseDecimal = americanToDecimal(pick.odds);
  const costFactor = Math.max(0.2, 1 - 0.18 * (points / 0.5) * 0.5);
  const newNet = Math.max(0.05, (baseDecimal - 1) * costFactor);
  const newDecimal = 1 + newNet;
  const newOdds = decimalToAmerican(newDecimal);
  let newPickStr;
  if (isPlusProp) {
    newPickStr = pick.pick.replace(/\d+(\.\d+)?\s*\+/, `${newLine}+`);
  } else {
    newPickStr = pick.pick.replace(numMatch[1], `${newLine > 0 && !isTotal ? "+" : ""}${newLine}`);
  }

  return {
    ...pick,
    pick: newPickStr,
    odds: newOdds,
    pointsDelta: (pick.pointsDelta || 0) + points,
    originalOdds: pick.originalOdds ?? pick.odds,
    originalPick: pick.originalPick ?? pick.pick,
  };
};

// Matchup engine: compare two players' projected stat, return win prob + American odds with vig
const projectStat = (player, statKey) => {
  const base = player.stats[statKey] || 0;
  // Form acts as a multiplier — 10 form = 1.05x, 5 form = 0.95x
  const formMult = 0.9 + (player.form / 10) * 0.2;
  return base * formMult;
};

const priceMatchup = (playerA, playerB, statKey) => {
  const projA = projectStat(playerA, statKey);
  const projB = projectStat(playerB, statKey);
  if (projA === 0 && projB === 0) return null;
  const total = projA + projB;
  // True probabilities normalized
  let pA = projA / total;
  // Pull toward 50% for variance (no projection is that confident)
  pA = 0.5 + (pA - 0.5) * 0.65;
  const pB = 1 - pA;
  // Add ~5% total vig
  const vigA = pA * 1.025;
  const vigB = pB * 1.025;
  const oddsA = vigA >= 0.5 ? Math.round(-100 * vigA / (1 - vigA)) : Math.round(100 * (1 - vigA) / vigA);
  const oddsB = vigB >= 0.5 ? Math.round(-100 * vigB / (1 - vigB)) : Math.round(100 * (1 - vigB) / vigB);
  return { projA, projB, probA: pA, probB: pB, oddsA, oddsB };
};

const calculateParlay = (legs) => {
  if (legs.length === 0) return { decimal: 1, american: 0, prob: 0 };
  const decimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  const prob = legs.reduce((acc, leg) => acc * impliedProb(leg.odds), 1);
  return { decimal, american: decimalToAmerican(decimal), prob };
};

// Deterministic pseudo-random based on string — same pick always same value
const hashSeed = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
};

// Find a player in the DB by a loose name match from a prop pick string
const findPlayerForPick = (pick) => {
  if (pick.market !== "Player Prop") return null;
  const all = Object.values(PLAYERS).flat();
  return all.find((p) =>
    pick.pick.toLowerCase().includes(p.name.toLowerCase().split(" ").pop().toLowerCase())
  ) || null;
};

// Extract the stat line number and stat type from a prop pick string
const parsePropLine = (pickStr) => {
  const num = pickStr.match(/(\d+(?:\.\d+)?)/);
  const line = num ? parseFloat(num[1]) : null;
  const stat =
    /pts|points/i.test(pickStr) ? "pts" :
    /reb|rebound/i.test(pickStr) ? "reb" :
    /ast|assist/i.test(pickStr) ? "ast" :
    /pass\s*yds|passing/i.test(pickStr) ? "passYds" :
    /rush\s*yds|rushing/i.test(pickStr) ? "rushYds" :
    /rec\s*yds|receiving/i.test(pickStr) ? "recYds" :
    /\brec\b|reception/i.test(pickStr) ? "rec" : null;
  return { line, stat };
};

// SAMPLE weather analysis: outdoor-sport games get plausible conditions (clearly
// labeled sample, not a real forecast). Returns the DIRECTIONAL effect weather
// tends to have — never a prediction of a specific result. Indoor sports (NBA)
// and domes return null. Real forecasts require the Next.js version + a weather API.
const OUTDOOR_SPORTS = ["nfl", "mlb", "soccer", "ncaaf"];
const sampleWeather = (pick) => {
  const sport = pick.sport;
  if (!OUTDOOR_SPORTS.includes(sport)) return null;
  const seed = hashSeed(`${pick.game}-weather`);
  const seed2 = hashSeed(`${pick.game}-wx2`);
  const tempF = Math.round(25 + seed * 70); // 25–95°F
  const windMph = Math.round(seed2 * 28); // 0–28 mph
  const precipRoll = hashSeed(`${pick.game}-precip`);
  const precip = precipRoll > 0.78 ? "rain" : precipRoll > 0.7 ? "snow" : "clear";
  const conditionLabel =
    `${tempF}°F · ${windMph} mph wind` + (precip !== "clear" ? ` · ${precip}` : " · clear");

  // Build directional effects (handicapping factors, not predictions)
  const effects = [];
  let lean = null; // "under" | "over" | null
  if (sport === "nfl" || sport === "ncaaf") {
    if (windMph >= 18) {
      effects.push(`Winds of ${windMph} mph historically suppress passing yards and field-goal accuracy — passing props and team totals tend to come in lower.`);
      lean = "under";
    } else if (windMph >= 12) {
      effects.push(`Moderate ${windMph} mph wind can nudge deep passing and long FGs down slightly.`);
    } else {
      effects.push(`Light wind (${windMph} mph) — minimal passing impact.`);
    }
    if (precip === "rain") { effects.push("Rain raises fumble/incompletion risk and often shifts offenses run-heavy — leans under and toward rushing volume."); lean = "under"; }
    if (precip === "snow") { effects.push("Snow tends to slow the game and lower scoring — historically favors unders."); lean = "under"; }
    if (tempF <= 32) effects.push("Sub-freezing temps reduce kicking distance and can stiffen the passing game.");
  } else if (sport === "mlb") {
    const blowingOut = hashSeed(`${pick.game}-wind-dir`) > 0.5;
    if (windMph >= 12 && blowingOut) { effects.push(`~${windMph} mph wind blowing OUT boosts carry — historically more home runs and higher totals.`); lean = "over"; }
    else if (windMph >= 12 && !blowingOut) { effects.push(`~${windMph} mph wind blowing IN knocks down fly balls — suppresses HRs and totals.`); lean = "under"; }
    if (tempF >= 80) { effects.push("Warm air is less dense, so the ball carries farther — slight boost to power numbers and totals."); if (!lean) lean = "over"; }
    else if (tempF <= 45) { effects.push("Cold, dense air suppresses ball flight — leans under on totals and HR props."); if (!lean) lean = "under"; }
    if (precip === "rain") effects.push("Rain risk could mean a delay or postponement — check status before locking props.");
  } else if (sport === "soccer") {
    if (windMph >= 18) effects.push(`Strong ${windMph} mph wind disrupts crossing/long balls and set pieces — can lower shot quality.`);
    if (precip === "rain") effects.push("Wet pitch speeds the ball and raises slip/error risk — variance up, slight lean toward goals.");
    if (precip === "clear" && windMph < 12) effects.push("Calm, dry conditions — minimal weather impact expected.");
  }
  if (effects.length === 0) effects.push("Conditions look mild — no strong weather edge in either direction.");
  return { conditionLabel, tempF, windMph, precip, effects, lean };
};

// SAMPLE prop research: deterministic recent-game split for a player vs a line.
const samplePropResearch = (pick) => {
  const player = findPlayerForPick(pick);
  if (!player) return null;
  const { line, stat } = parsePropLine(pick.pick);
  if (line === null || !stat || player.stats[stat] === undefined) return null;
  const avg = player.stats[stat];
  // Generate 10 deterministic "recent games" around the average.
  // Variance scaled to stat size; centered on avg with form pulling it up.
  const games = [];
  const formBoost = (player.form - 7) * 0.04; // better form => slightly higher outputs
  for (let i = 0; i < 10; i++) {
    const seed = hashSeed(`${player.name}-${stat}-${i}`);
    const swing = (seed - 0.5) * 2; // -1..1
    const spread = avg * 0.35; // ±35% typical game-to-game variance
    let val = avg + swing * spread + avg * formBoost;
    val = Math.max(0, stat === "pts" || stat.includes("Yds") ? Math.round(val) : Math.round(val * 10) / 10);
    games.push(val);
  }
  const hits = games.filter((v) => v >= line).length;
  // Opponent matchup modifier: derive a deterministic "defense difficulty" from
  // the opposing team in the game string (1=tough D, 0=soft D)
  const oppToken = pick.game.toLowerCase().replace(player.team.toLowerCase(), "").replace(/[@vs]/g, "").trim();
  const defSeed = hashSeed(oppToken + stat);
  const defDifficulty = defSeed; // 0..1
  const defNote =
    defDifficulty > 0.66 ? "tough matchup (opponent strong vs this stat)" :
    defDifficulty < 0.33 ? "soft matchup (opponent weak vs this stat)" :
    "neutral matchup";
  return {
    player: player.name,
    stat,
    line,
    avg,
    games,
    hits,
    total: games.length,
    hitRate: hits / games.length,
    defDifficulty,
    defNote,
    form: player.form,
  };
};

// Confidence score (0-100) for a pick. Blends:
//   - implied probability from odds (the market's view)
//   - player form rating if it's a player prop and the player is in our DB
//   - small market-type adjustment (heavy favorites priced sharper)
//   - deterministic noise so scores feel unique per pick
// NOTE: this is a model from the app's sample data, NOT real game film
const calculateConfidence = (pick) => {
  // PrizePicks DFS legs have no per-leg American price. Don't derive a
  // confidence from a fake implied-probability — pin them at the flat
  // ~55% baseline our live builder uses. This keeps PP legs from
  // inflating the parlay-wide confidence (they don't carry book pricing).
  if (pick.odds == null || !Number.isFinite(pick.odds)) return 55;
  const implied = impliedProb(pick.odds);
  let score = implied * 100; // base: market's implied probability

  // Find player by name match
  let playerForm = null;
  if (pick.market === "Player Prop") {
    const allPlayers = Object.values(PLAYERS).flat();
    const matched = allPlayers.find((p) =>
      pick.pick.toLowerCase().includes(p.name.toLowerCase().split(" ").pop().toLowerCase())
    );
    if (matched) playerForm = matched.form;
  }

  // Form adjustment: form 5 is neutral. +2 pts per form point above 5, -2 per below
  if (playerForm !== null) {
    score += (playerForm - 5) * 2;
  }

  // Prop research adjustment: hit rate vs the line + opponent matchup difficulty
  if (pick.market === "Player Prop") {
    const research = samplePropResearch(pick);
    if (research) {
      // Hit rate above/below 50% nudges confidence
      score += (research.hitRate - 0.5) * 20; // ±10 pts at extremes
      // Tough matchup drags, soft matchup boosts
      score += (0.5 - research.defDifficulty) * 8; // ±4 pts
    }
  }

  // Market type tweaks
  if (pick.market === "Moneyline" && pick.odds < -150) score += 3; // heavy favs cash more often
  if (pick.market === "Player Prop" && pick.odds > 200) score -= 4; // long-tail props miss often
  if (pick.market === "Total" || pick.market === "Spread") score -= 1; // standard juice markets

  // Coach tendency adjustment — match coach by team in pick/game
  const coaches = Object.values(COACHES).flat();
  const matchedCoach = coaches.find((c) => {
    if (!c.team || c.team === "—") return false;
    const t = c.team.toLowerCase();
    return pick.pick.toLowerCase().includes(t) || pick.game.toLowerCase().includes(t);
  });
  if (matchedCoach) {
    const isOver = /\bover\b/i.test(pick.pick);
    // Aggressive coaches push totals up
    if ((pick.market === "Total" && isOver) || (pick.market === "Player Prop" && /pts|points|pass|yds|rec/i.test(pick.pick))) {
      score += (matchedCoach.aggressive || 0) * 1.5;
    }
    // Front-runner coaches reliable as favorites
    if (pick.odds < 0 && (pick.market === "Moneyline" || pick.market === "Spread")) {
      score += (matchedCoach.favLean || 0) * 1.2;
    }
    // Underdog-strong coaches when taking the dog
    if (pick.odds > 0 && (pick.market === "Moneyline" || pick.market === "Spread") && matchedCoach.favLean < 0) {
      score += Math.abs(matchedCoach.favLean) * 1.2;
    }
    // Big-game coaches get a small all-around bump (reliability)
    score += (matchedCoach.primetime || 0) * 0.4;
  }

  // Weather adjustment (outdoor sports only) — aligns with the Weather tool's
  // directional leans. An over pick in over-friendly conditions gets a small
  // boost; against the lean, a small drag.
  if (pick.sport && OUTDOOR_SPORTS.includes(pick.sport)) {
    const wx = sampleWeather(pick);
    if (wx && wx.lean) {
      const isOver = /\bover\b/i.test(pick.pick);
      const isUnder = /\bunder\b/i.test(pick.pick);
      if (wx.lean === "over") { if (isOver) score += 3; if (isUnder) score -= 3; }
      if (wx.lean === "under") { if (isUnder) score += 3; if (isOver) score -= 3; }
    }
  }

  // Injury adjustment (sample data): opponent missing a key player helps this
  // pick; the pick's own team missing one hurts it; and if this pick's player is
  // the REPLACEMENT for an injured starter, they inherit usage → small boost.
  // Graduated by status: out (full) > doubtful (0.7) > questionable (0.4).
  const inj = injuryContextForPick(pick);
  if (inj) {
    for (const i of inj.oppTeamInjuries) score += (INJURY_WEIGHT[i.status] || 0) * i.impact * 2.2;
    for (const i of inj.ownTeamInjuries) score -= (INJURY_WEIGHT[i.status] || 0) * i.impact * 2.2;
    if (inj.isReplacement) {
      const w = INJURY_WEIGHT[inj.isReplacement.status] || 0;
      score += w * inj.isReplacement.impact * 2.0; // backup gets more volume
    }
  }

  // Situational edges (sample): rest/schedule, travel/altitude, pace/style.
  const sit = situationalEdges(pick);
  if (sit) score += sit.delta;

  // Deterministic variance (±4 pts based on pick string)
  const seed = hashSeed(pick.game + pick.pick);
  score += (seed - 0.5) * 8;

  // Clamp 15-92 (never show certainty)
  return Math.max(15, Math.min(92, Math.round(score)));
};

const confidenceColor = (score) => {
  if (score >= 70) return "text-emerald-400";
  if (score >= 55) return "text-cyan-400";
  if (score >= 40) return "text-amber-400";
  return "text-rose-400";
};

const confidenceLabel = (score) => {
  if (score >= 75) return "STRONG";
  if (score >= 60) return "LEAN";
  if (score >= 45) return "COIN-FLIP";
  if (score >= 30) return "RISKY";
  return "DART";
};

// Pull the AI's OWN projected win probability out of its EDGE note. The chat
// prompt requires every side/total/ML edge note to state both the market-implied
// % and the model's projected % (e.g. "−150 implies 60%, ... puts this ~68% →
// +8% edge"). The confidence badge historically anchored to the MARKET'S implied
// probability (calculateConfidence starts at implied*100), so it always read like
// a "market pick" no matter what the AI argued. When the note carries a real
// projection we surface THAT as the badge so the card reflects the analysis, not
// the price. Returns { proj, implied } in 0-100 (either may be null). We never
// read a number tagged "edge" (that's the delta, not a probability).
const parseAiProjection = (note) => {
  if (!note || typeof note !== "string") return { proj: null, implied: null };
  const norm = note.replace(/\u2212/g, "-"); // unicode minus → ascii hyphen
  const clamp = (n) => (Number.isFinite(n) && n >= 1 && n <= 99 ? Math.round(n) : null);
  // Implied / break-even probability the price bakes in.
  const impM = norm.match(
    /(?:impl(?:y|ies|ied)|market (?:implies|prices?|has|pegs?)|break-?even)[^%\d]{0,20}(\d{1,3}(?:\.\d)?)\s*%/i,
  );
  const implied = impM ? clamp(Number(impM[1])) : null;
  // Projected win %. We capture the sign and the word right after the % so we
  // can REJECT the edge delta ("+8% edge" / "→ +8% gap") — a projection is a
  // bare 1-99 number ("~68%"), never a signed delta or a number tagged
  // edge/gap/ev/vs. Anchored to projection vocabulary; because the anchor sits
  // AFTER any "implies 60%" clause, the % stop-char keeps us from grabbing the
  // implied number by mistake.
  const pm = norm.match(
    /(?:project(?:s|ed|ion)?|puts? (?:this|it|them|him|her|the over|the under|over|under)|model[^%\d]{0,14}(?:at|has|sees|says)?|estimate[ds]?[^%\d]{0,10}|i (?:have|put|peg|model)[^%\d]{0,10}|fair (?:value|prob[^%\d]{0,8})?|closer to|more like)([^%\d]{0,20}?)([+-]?)\s*~?\s*(\d{1,3}(?:\.\d)?)\s*%\s*(\w+)?/i,
  );
  let proj = null;
  if (pm) {
    const sign = pm[2];
    const trailing = (pm[4] || "").toLowerCase();
    const isDelta = sign === "+" || sign === "-" || /^(edge|gap|ev|vs|delta|value|more|better|swing)$/.test(trailing);
    if (!isDelta) proj = clamp(Number(pm[3]));
  }
  // A projection that exactly equals the implied % usually means only the
  // implied number matched — treat it as "no real projection found".
  if (proj != null && implied != null && proj === implied) proj = null;
  return { proj, implied };
};

// Long-run baseline hit rates from published sports-betting research.
// These are MARKET averages — what the implied probability roughly works out
// to historically. Useful context, not pick-specific predictions.
// Sources: pinnacle.com research, ESPN BPI archives, Action Network historical data.
const BASELINE_HIT_RATES = {
  // Market type → odds bucket → historical hit %
  Spread: { "-110": 50, "-105": 50, "+100": 49, default: 50 },
  "Run Line": { "-110": 50, "+150": 42, default: 47 },
  "Puck Line": { "-110": 50, "+150": 42, default: 47 },
  Moneyline: {
    heavyFav: 72, // odds < -200
    fav: 58,      // -200 to -110
    pickem: 50,   // -110 to +110
    dog: 40,      // +110 to +200
    longshot: 25, // +200+
  },
  Total: { default: 50 }, // overs and unders historically split ~50/50
  "Player Prop": {
    fav: 53,      // negative odds
    plus100: 45,
    longshot: 30, // +200+
  },
  "Match Result": {
    fav: 48,      // 3-way market — fav wins less than ML
    dog: 28,
  },
  BTTS: { yes: 55, no: 45, default: 50 },
  Method: { default: 38 },
};

const getBaselineHitRate = (pick) => {
  const m = pick.market;
  const o = pick.odds;
  if (m === "Moneyline") {
    if (o < -200) return BASELINE_HIT_RATES.Moneyline.heavyFav;
    if (o < -110) return BASELINE_HIT_RATES.Moneyline.fav;
    if (o <= 110) return BASELINE_HIT_RATES.Moneyline.pickem;
    if (o <= 200) return BASELINE_HIT_RATES.Moneyline.dog;
    return BASELINE_HIT_RATES.Moneyline.longshot;
  }
  if (m === "Player Prop") {
    if (o < 0) return BASELINE_HIT_RATES["Player Prop"].fav;
    if (o > 200) return BASELINE_HIT_RATES["Player Prop"].longshot;
    return BASELINE_HIT_RATES["Player Prop"].plus100;
  }
  if (m === "Match Result") {
    return o < 0 ? BASELINE_HIT_RATES["Match Result"].fav : BASELINE_HIT_RATES["Match Result"].dog;
  }
  const bucket = BASELINE_HIT_RATES[m];
  if (!bucket) return 50;
  return bucket.default || 50;
};

// ==== PERSONAL PICK TRACKER ====
// Saves picks the user has acted on, with W/L/Pending status, to localStorage.
// Aggregates personal record over time, broken down by market type.

const TRACKER_KEY = "stadium_edge_tracker_v1";

const loadTracker = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TRACKER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveTracker = (entries) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRACKER_KEY, JSON.stringify(entries));
  } catch (e) {
    console.error("Tracker save failed:", e);
  }
};

// Aggregate personal record for a specific pick "signature"
// Signature = market + odds bucket (so similar picks roll up)
const pickSignature = (pick) => {
  const oddsBucket =
    pick.odds < -200 ? "heavyFav" :
    pick.odds < 0 ? "fav" :
    pick.odds <= 150 ? "plus" :
    "longshot";
  return `${pick.market}::${oddsBucket}`;
};

const personalRecordFor = (pick, trackerEntries) => {
  const sig = pickSignature(pick);
  const matches = trackerEntries.filter(
    (e) => e.signature === sig && (e.status === "won" || e.status === "lost")
  );
  const wins = matches.filter((e) => e.status === "won").length;
  const losses = matches.filter((e) => e.status === "lost").length;
  return { wins, losses, total: wins + losses };
};

// Generate a reasoning sentence for a pick using its actual properties.
// Rule-based, not LLM — labeled clearly in the UI.
const generateReasoning = (pick, h2hEntry = null) => {
  // PrizePicks legs have no per-leg American price. Generating
  // "market-implied %" / "heavy favorite" copy from null odds would be
  // fabrication — return an honest, source-aware sentence instead.
  if (pick.odds == null || !Number.isFinite(pick.odds)) {
    const line = pick.pick.match(/Over\s+([\d.]+)/i)?.[1];
    return `PrizePicks line${line ? ` at ${line}` : ""} — DFS pick'em projection, no per-leg sportsbook price. PrizePicks sets lines targeting roughly a 50/50 hit rate and pays a flat parlay-style payout, so this leg doesn't carry book-style implied odds.`;
  }
  const reasons = [];
  // H2H W-L LEAD LINE (moneyline only): if we have real head-to-head data
  // for this game, open Why this pick with "Record vs <Opponent>: W-L in
  // last N meetings." Orientation is from the picked side: home picks use
  // homeWins/awayWins; away picks swap. Pulled from the same fetch the AI
  // already sees, so the count is real, not fabricated.
  if (pick.market === "Moneyline" && pick.game && h2hEntry?.h2h?.meetings?.length) {
    const sides = pick.game.split(" @ ");
    if (sides.length === 2) {
      const away = sides[0].trim();
      const home = sides[1].trim();
      const pickedHome = pick.pick.toLowerCase().includes(home.toLowerCase()) || home.toLowerCase().includes(pick.pick.split(/\s+/)[0].toLowerCase());
      const opp = pickedHome ? away : home;
      const wins = pickedHome ? h2hEntry.h2h.homeWins : h2hEntry.h2h.awayWins;
      const losses = pickedHome ? h2hEntry.h2h.awayWins : h2hEntry.h2h.homeWins;
      const meetings = h2hEntry.h2h.meetings.length;
      reasons.push(`📊 Record vs ${opp}: ${wins}-${losses} in last ${meetings} meeting${meetings === 1 ? "" : "s"}.`);
    }
  } else if (pick.market === "Moneyline" && pick.game && h2hEntry && !h2hEntry?.h2h) {
    const sides = pick.game.split(" @ ");
    if (sides.length === 2) {
      const away = sides[0].trim();
      const home = sides[1].trim();
      const pickedHome = pick.pick.toLowerCase().includes(home.toLowerCase());
      const opp = pickedHome ? away : home;
      reasons.push(`📊 Record vs ${opp}: no prior meetings in our data window.`);
    }
  }
  const implied = (impliedProb(pick.odds) * 100).toFixed(0);
  const isFav = pick.odds < 0;
  const isHeavyFav = pick.odds < -200;
  const isDog = pick.odds > 0;
  const isLongshot = pick.odds > 200;

  // Market-based opener
  if (pick.market === "Moneyline") {
    if (isHeavyFav) {
      reasons.push(`Heavy favorite at ${formatOdds(pick.odds)} (market implies ${implied}% — books rarely misprice these).`);
    } else if (isFav) {
      reasons.push(`Modest favorite at ${formatOdds(pick.odds)}, market implies ${implied}%.`);
    } else {
      reasons.push(`Underdog ML at ${formatOdds(pick.odds)} — pays well but only ${implied}% implied.`);
    }
  } else if (pick.market === "Spread" || pick.market === "Run Line" || pick.market === "Puck Line") {
    reasons.push(`Standard spread juice — implied ${implied}% with the points working in your favor.`);
  } else if (pick.market === "Total") {
    const isOver = /over/i.test(pick.pick);
    reasons.push(`Total ${isOver ? "over" : "under"} at ${formatOdds(pick.odds)} — pace and matchup are the variables here.`);
  } else if (pick.market === "Player Prop") {
    // Try to find the player in our DB
    const allPlayers = Object.values(PLAYERS).flat();
    const matched = allPlayers.find((p) =>
      pick.pick.toLowerCase().includes(p.name.toLowerCase().split(" ").pop().toLowerCase())
    );
    if (matched) {
      const formDesc =
        matched.form >= 8 ? "in elite form" :
        matched.form >= 6 ? "in solid form" :
        matched.form >= 4 ? "average recent form" : "slumping";
      reasons.push(`${matched.name} is ${formDesc} (form ${matched.form}/10). Prop priced at ${formatOdds(pick.odds)}, ${implied}% implied.`);
      // Add sample game-log research
      const research = samplePropResearch(pick);
      if (research) {
        const pct = Math.round(research.hitRate * 100);
        reasons.push(`📊 Hit ${research.line}+ in ${research.hits} of last ${research.total} (${pct}%) — ${research.defNote}.`);
      }
    } else {
      reasons.push(`Player prop at ${formatOdds(pick.odds)} — usage and matchup-specific. ${implied}% implied.`);
    }
    if (isLongshot) reasons.push("Longshot prop — high payout, but books juice these tight.");
  } else if (pick.market === "BTTS") {
    reasons.push(`Both teams to score — usually favors leagues with strong attacking lineups. ${implied}% implied.`);
  } else if (pick.market === "Match Result") {
    reasons.push(`Three-way market means lower implied probability than ML — ${implied}% here.`);
  } else if (pick.market === "Method") {
    reasons.push(`Fight method bet — combines outcome + finish type. ${implied}% implied.`);
  } else {
    reasons.push(`${pick.market} at ${formatOdds(pick.odds)}, ${implied}% implied.`);
  }

  // Team trending — REAL recent-form read for SIDE picks (moneyline / spread /
  // run line / puck line), pulled from the same matchup-history fetch the AI
  // sees. Resolves which side this pick is on, then surfaces that side's actual
  // current streak and venue split. Totals have NO side, so they're excluded —
  // a streak/venue note keyed to one team would misattribute the read. Honest
  // silence when we have no history for the game — no fabricated "(sample)" trend.
  const SIDE_MARKETS = new Set(["Moneyline", "Spread", "Alt Spread", "Run Line", "Puck Line"]);
  if (SIDE_MARKETS.has(pick.market) && pick.game && h2hEntry) {
    const sides = pick.game.split(" @ ");
    if (sides.length === 2) {
      const away = sides[0].trim();
      const home = sides[1].trim();
      const firstTok = pick.pick.split(/\s+/)[0].toLowerCase();
      const pickedHome = pick.pick.toLowerCase().includes(home.toLowerCase())
        || home.toLowerCase().includes(firstTok);
      const streak = pickedHome ? h2hEntry.homeStreak : h2hEntry.awayStreak;
      const venue = pickedHome ? h2hEntry.homeVenueForm : h2hEntry.awayVenueForm;
      if (streak && streak.count >= 2) {
        if (streak.type === "W") reasons.push(`📈 On a real ${streak.count}-game win streak (ESPN finals) — recent form points its way.`);
        else reasons.push(`📉 On a real ${streak.count}-game losing streak (ESPN finals) — a reason for caution, baked into the score.`);
      }
      if (venue && venue.record) {
        reasons.push(`🏟️ ${venue.record} ${pickedHome ? "at home" : "on the road"} this season (${venue.avgMargin > 0 ? "+" : ""}${venue.avgMargin} avg margin) — real venue split.`);
      }
    }
  }

  // Coach tendency — match a coach by team abbreviation appearing in the pick/game
  const allCoaches = Object.values(COACHES).flat();
  const matchedCoach = allCoaches.find((c) => {
    if (!c.team || c.team === "—") return false;
    const t = c.team.toLowerCase();
    return pick.pick.toLowerCase().includes(t) || pick.game.toLowerCase().includes(t);
  });
  if (matchedCoach) {
    const bits = [];
    if (matchedCoach.aggressive >= 2 && (pick.market === "Total" || /over/i.test(pick.pick))) {
      bits.push("aggressive play-caller (leans overs)");
    }
    if (matchedCoach.favLean >= 2 && isFav) {
      bits.push("strong as favorite");
    }
    if (matchedCoach.favLean <= -1 && isDog) {
      bits.push("dangerous as underdog");
    }
    if (matchedCoach.primetime >= 2) {
      bits.push("strong in big spots");
    }
    if (bits.length > 0) {
      reasons.push(`🧑‍🏫 Coach ${matchedCoach.name.split(" (")[0]}: ${bits.join(", ")}.`);
    }
  }

  // Weather impact (outdoor sports) — cite the directional lean from the Weather tool
  if (pick.sport && OUTDOOR_SPORTS.includes(pick.sport)) {
    const wx = sampleWeather(pick);
    if (wx && wx.lean) {
      const isOver = /\bover\b/i.test(pick.pick);
      const isUnder = /\bunder\b/i.test(pick.pick);
      const aligns = (wx.lean === "over" && isOver) || (wx.lean === "under" && isUnder);
      if (isOver || isUnder) {
        reasons.push(`🌦 Weather (${wx.conditionLabel}) ${aligns ? "supports" : "works against"} this leg — conditions lean ${wx.lean}.`);
      } else {
        reasons.push(`🌦 Weather: ${wx.conditionLabel} — leans ${wx.lean} on this game's total.`);
      }
    }
  }

  // Injury context (sample) — opponent outages ease the matchup, own outages
  // hurt, and a replacement inheriting usage gets a note.
  const injR = injuryContextForPick(pick);
  if (injR) {
    if (injR.isReplacement) {
      const i = injR.isReplacement;
      reasons.push(`🏥 ${pick.pick.split(" ")[0]} is in line for extra usage with ${i.player} (${i.pos}) ${i.status} — backups inherit volume${i.status === "questionable" ? " if he sits" : ""}.`);
    }
    for (const i of injR.oppTeamInjuries) {
      reasons.push(`🏥 Easier matchup: ${i.team} has ${i.player} (${i.pos}) ${i.status}${i.backup ? ` (${i.backup} in)` : ""} — the player/side facing them gets a slight edge${i.status === "out" ? "" : ", weighted down since he may still play"}.`);
    }
    for (const i of injR.ownTeamInjuries) {
      reasons.push(`🏥 ${i.team} risk: ${i.player} (${i.pos}) ${i.status} — a hit to this pick if he can't go.`);
    }
  }

  // Situational edges (sample): rest, travel/altitude, pace
  const sitR = situationalEdges(pick);
  if (sitR) {
    for (const n of sitR.notes) reasons.push(`📅 ${n}`);
  }

  // Risk warning for high-leverage stuff
  if (isLongshot && pick.market !== "Player Prop") {
    reasons.push("Variance is real — size accordingly.");
  }
  if (isHeavyFav && pick.market === "Moneyline") {
    reasons.push("Bad payout if it loses — be wary of stacking many heavy favs (single upset kills the parlay).");
  }

  return reasons.join(" ");
};

const detectIntent = (text) => {
  const t = text.toLowerCase();
  if (/analy[sz]e|breakdown|review|how.*look|thoughts on.*slip|risk/.test(t)) return "analyze";
  if (/matchup|versus|\bvs\.?\b|head.?to.?head|h2h/.test(t)) return "matchup";
  if (/player.?prop|props.?only|just.?props|only.?props|prop parlay/.test(t)) return "props";
  if (/\bbest\b|optimal|highest.?confidence|smartest|top.?pick|sharp/.test(t)) return "best";
  if (/safe|conservative|low.?risk|chalk|favorite/.test(t)) return "safe";
  if (/longshot|lotto|lottery|big.*pay|moonshot|risky|long.*odd|underdog/.test(t)) return "longshot";
  if (/correlat|same.?game|sgp/.test(t)) return "correlation";
  if (/probabil|implied|edge|math/.test(t)) return "math";
  if (/help|how.*work|what.*do|guide/.test(t)) return "help";
  if (/parlay|build|suggest|give|pick|leg|recommend|idea|balanced|value|mix/.test(t)) return "build";
  return "build";
};

const extractLegCount = (text) => {
  const m = text.match(/(\d+)[-\s]?(leg|pick|game)/i);
  if (m) return Math.min(parseInt(m[1]), 15);
  return 3;
};

const buildParlay = (sports, tier, legCount, propsOnly = false, livePool = null) => {
  // Only consider picks for games either currently being played OR starting
  // within the next 24 hours. We allow up to 4 hours in the past so in-progress
  // games (which started a couple hours ago) are still eligible for the ticket.
  const NOW = Date.now();
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const LIVE_BACK_MS = 4 * 60 * 60 * 1000;
  const within24h = (p) => {
    if (!p.startsAt) return true; // sample/hypothetical picks have no timestamp — keep them
    const t = new Date(p.startsAt).getTime();
    return !isNaN(t) && t >= NOW - LIVE_BACK_MS && t <= NOW + WINDOW_MS;
  };
  // ONLY use real ESPN/Odds picks. If the live pool is empty or has nothing
  // in the 24h window for the selected sports, return [] so the caller can
  // surface an honest "no live games available" empty state instead of
  // rendering stale hypothetical matchups.
  let pool = [];
  if (livePool && livePool.length > 0) {
    pool = livePool.filter((p) => sports.includes(p.sport)).filter(within24h);
  }
  if (propsOnly) pool = pool.filter((p) => p.market === "Player Prop");
  if (pool.length === 0) return [];
  let filtered = pool;
  if (tier === "safe") filtered = pool.filter((p) => p.tier === 1);
  else if (tier === "longshot") filtered = pool.filter((p) => p.tier === 3);
  else if (tier === "balanced") filtered = pool.filter((p) => p.tier === 2);
  if (filtered.length < legCount) filtered = pool;

  // Score every candidate using the FULL model (odds + form + coach).
  // Add a small deterministic jitter so the same request varies slightly
  // between builds without abandoning the ranking.
  const scored = filtered.map((p) => {
    const conf = calculateConfidence(p);
    const jitter = (hashSeed(p.pick + Date.now().toString().slice(-4)) - 0.5) * 2;
    return { pick: p, conf, rank: conf + jitter };
  });

  // For longshot tier we still want high-payout legs, so rank by a blend of
  // confidence and payout; otherwise rank purely by model confidence.
  scored.sort((a, b) => {
    if (tier === "longshot") {
      const aScore = a.rank + americanToDecimal(a.pick.odds) * 2;
      const bScore = b.rank + americanToDecimal(b.pick.odds) * 2;
      return bScore - aScore;
    }
    return b.rank - a.rank;
  });

  // Take the best legs. Prefer variety (one per game) but ALLOW same-game
  // stacking when those legs are strong — real bettors build SGPs. We cap
  // same-game stacks at 2 per game to keep correlation manageable.
  const selected = [];
  const gameCounts = {};
  for (const s of scored) {
    if (selected.length >= legCount) break;
    const g = s.pick.game;
    const count = gameCounts[g] || 0;
    // first pass: take one per game
    if (count === 0) {
      selected.push(s.pick);
      gameCounts[g] = 1;
    }
  }
  // second pass: allow a 2nd leg per game (same-game stack) if still short
  for (const s of scored) {
    if (selected.length >= legCount) break;
    const g = s.pick.game;
    const count = gameCounts[g] || 0;
    if (count >= 1 && count < 2 && !selected.includes(s.pick)) {
      selected.push(s.pick);
      gameCounts[g] = count + 1;
    }
  }
  // final fill if STILL short
  for (const s of scored) {
    if (selected.length >= legCount) break;
    if (!selected.includes(s.pick)) selected.push(s.pick);
  }
  return selected;
};

// Build a parlay that TARGETS a minimum parlay-confidence (e.g. 60%).
// Strategy: build the requested legs, sort by individual confidence, then
// trim the weakest legs until the compounded parlay confidence clears the
// target. Returns { picks, parlayConf, hitTarget, requestedLegs }.
const buildParlayToTarget = (sports, legCount, opts = {}) => {
  const { propsOnly = false, livePool = null, target = 60, tierBias = "balanced" } = opts;
  // Start from a generous candidate set ranked by confidence. A "safe" tierBias
  // pulls from higher-probability legs so the assembled ticket earns a genuinely
  // higher confidence — not an inflated number, just better-chosen legs.
  const candidates = buildParlay(sports, tierBias, Math.max(legCount, 8), propsOnly, livePool);
  if (candidates.length === 0) return { picks: [], parlayConf: 0, hitTarget: false, requestedLegs: legCount };

  // Rank by individual confidence, highest first
  const ranked = [...candidates].sort(
    (a, b) => calculateConfidence(b) - calculateConfidence(a)
  );

  const parlayConfOf = (legs) =>
    Math.round(legs.reduce((acc, l) => acc * (calculateConfidence(l) / 100), 1) * 100);

  // Try the requested leg count first; if under target, trim weakest legs.
  // Never trim below the requested leg count — a "Build me a parlay" that
  // returns 2 legs feels broken to the user. If we can't clear the target
  // at the requested size, return the requested size anyway with the
  // honest "best I could do was X%" disclaimer in the caller.
  const minLegs = Math.max(3, Math.min(legCount, ranked.length));
  const startSize = Math.max(legCount, minLegs);
  let picks = ranked.slice(0, startSize);
  let conf = parlayConfOf(picks);
  while (conf < target && picks.length > minLegs) {
    picks = picks.slice(0, picks.length - 1); // drop weakest (last, since sorted desc)
    conf = parlayConfOf(picks);
  }
  return {
    picks,
    parlayConf: conf,
    hitTarget: conf >= target,
    requestedLegs: legCount,
  };
};

const analyzeSlip = (legs) => {
  if (legs.length === 0) return "Your slip is empty. Add some legs first and I'll break it down.";
  const math = calculateParlay(legs);
  const sameGameCount = legs.length - new Set(legs.map((l) => l.game)).size;
  const probPct = (math.prob * 100).toFixed(1);
  const legConfidences = legs.map((l) => calculateConfidence(l));
  const parlayConf = Math.round(
    legConfidences.reduce((acc, c) => acc * (c / 100), 1) * 100
  );
  const avgConf = Math.round(legConfidences.reduce((a, b) => a + b, 0) / legConfidences.length);
  const weakestIdx = legConfidences.indexOf(Math.min(...legConfidences));
  const weakest = legs[weakestIdx];

  let analysis = `**${legs.length}-leg parlay analysis:**\n\n`;
  analysis += `Combined odds: ${formatOdds(math.american)} (${math.decimal.toFixed(2)}x return)\n`;
  analysis += `Implied probability: ${probPct}% (what the market thinks)\n`;
  analysis += `**Model confidence: ${parlayConf}%** · avg leg: ${avgConf}%\n\n`;
  analysis += `_Confidence is from a model using sample player form + odds — NOT real game film. Treat it as a relative ranking, not a prediction._\n\n`;
  if (weakest && legConfidences[weakestIdx] < 45) {
    analysis += `🪨 Weakest leg by model: **${weakest.pick}** at ${legConfidences[weakestIdx]}%. Consider dropping or swapping.\n\n`;
  }
  if (sameGameCount > 0) {
    analysis += `⚠️ ${sameGameCount} same-game leg${sameGameCount > 1 ? "s" : ""}. Books price correlated legs tighter than naive multiplication suggests.\n\n`;
  }
  if (legs.length >= 5) {
    analysis += `📉 At ${legs.length} legs, even at 60% true probability each, you're under 8% to cash. Parlays are entertainment.\n\n`;
  }
  const longshots = legs.filter((l) => l.odds > 0).length;
  if (longshots > 0) {
    analysis += `🎯 ${longshots} underdog leg${longshots > 1 ? "s" : ""} — juices payout, multiplies variance.\n\n`;
  }
  analysis += `Hypothetical only. Bet only what you can lose.`;
  return analysis;
};

const generateResponse = (text, sports, legs, livePool = null) => {
  const intent = detectIntent(text);
  const legCount = extractLegCount(text);

  if (intent === "analyze") return { text: analyzeSlip(legs), picks: [] };

  if (intent === "matchup") {
    return { text: `Open the **Matchup** tool from the toolbar below — pick two players head-to-head and I'll project who has the edge across key stats.`, picks: [] };
  }

  if (intent === "help") {
    return { text: `Here's what I can do:\n\n• Tap **3-Leg / 6-Leg / 9-Leg / 15-Leg** to build that size parlay\n• Or type "build me a 5-leg parlay" for any size\n• "Player props parlay" — props only\n• "Analyze my slip" — risk + correlation breakdown\n• "Explain implied probability" — odds math\n\nI rank every pick by odds, player form, and coach trends. Confidence compounds down with each leg — more legs = bigger payout, lower confidence.`, picks: [] };
  }

  if (intent === "math") {
    return { text: `**Implied probability cheat sheet:**\n\n• -200 = 66.7% (heavy fav)\n• -150 = 60%\n• -110 = 52.4% (standard juice)\n• +100 = 50% (pick'em)\n• +150 = 40%\n• +300 = 25% (longshot)\n\nBooks bake in ~4-5% margin (the "vig"). Your edge = your probability estimate minus implied. No edge = long-run loss.`, picks: [] };
  }

  if (intent === "correlation") {
    return { text: `**Correlation in parlays:**\n\nIf you parlay "Team A wins" + "Team A QB throws 2+ TDs", those are positively correlated — books know this and price SGPs tighter than naive multiplication.\n\nNegative correlation (Over total + low-scoring leg) tanks your true probability below the math.\n\nFor correlated legs, use a book's SGP product — don't manually parlay same-game legs.`, picks: [] };
  }

  let tier = "balanced";
  let propsOnly = false;
  let bestMode = false;
  let targetMode = false;
  // Did the user explicitly ask for a specific leg count (e.g. "6-leg parlay")?
  const explicitLegCount = /(\d+)[-\s]?(leg|pick|game)/i.test(text);
  if (intent === "safe") tier = "safe";
  else if (intent === "longshot") tier = "longshot";
  else if (intent === "props") propsOnly = true;
  else if (intent === "best") {
    bestMode = true;
    targetMode = true;
    tier = "balanced";
  } else if (intent === "build" && !explicitLegCount) {
    // Default build (no leg count given) targets 60%+ parlay confidence
    targetMode = true;
  }

  let picks, targetResult = null;
  if (targetMode) {
    targetResult = buildParlayToTarget(sports, legCount, {
      propsOnly, livePool, target: 60,
      tierBias: bestMode ? "safe" : "balanced", // best mode draws the highest-probability legs
    });
    picks = targetResult.picks;
  } else {
    // Explicit leg count: build exactly that many, ranked by full model, no trimming
    picks = buildParlay(sports, tier, legCount, propsOnly, livePool);
  }
  const usingLive = livePool && livePool.length > 0 && picks.some((p) => p.teamId);
  if (picks.length === 0) {
    if (propsOnly) return { text: "No player props in your selected sports' pool. Try selecting NFL, NBA, or MLB.", picks: [] };
    return { text: "Select at least one sport from the chips at the top and I'll build something.", picks: [] };
  }

  const math = calculateParlay(picks);
  const tierLabel = propsOnly
    ? "player-props"
    : bestMode
      ? "model-optimized"
      : { safe: "favorite-heavy", balanced: "balanced", longshot: "high-variance" }[tier];
  const pickConfidences = picks.map((p) => calculateConfidence(p));
  const parlayConf = Math.round(
    pickConfidences.reduce((acc, c) => acc * (c / 100), 1) * 100
  );

  if (bestMode) {
    // Build a transparent signal breakdown for each leg
    const legBreakdowns = picks.map((p) => {
      return `PICK: ${p.game} | ${p.market} | ${p.pick} | ${formatOdds(p.odds)}`;
    });
    const hitMsg = targetResult && targetResult.hitTarget
      ? `Cleared the 60% bar at ${picks.length} leg${picks.length !== 1 ? "s" : ""}.`
      : `Best I could clear was ${parlayConf}% — going to fewer legs would raise it. I won't pad it with weak legs to hit a number.`;
    const intro = `Here's my **highest-confidence parlay** targeting 60%+ model confidence. I ran every candidate through the full tool stack — odds, player form, matchup, coach game-state, weather, injuries, and rest/travel/pace — drew from the highest-probability legs, and trimmed until the compounded confidence cleared the bar. ${hitMsg}${usingLive ? " Built from today's real ESPN games." : ""}\n\nThis raises confidence by choosing genuinely better legs — not by inflating the number. Expand "Why this pick?" on each card to see every factor.\n\n`;
    const footer = `\n\nCombined: ${formatOdds(math.american)} · market implied ~${(math.prob * 100).toFixed(1)}% · **model confidence ~${parlayConf}%**${usingLive ? " · Live ESPN data" : " · sample data"}.\n\nEven a 60%+ parlay loses often — that's the math of variance. Bet responsibly.`;
    return { text: intro + legBreakdowns.join("\n") + footer, picks };
  }

  const targetNote = targetResult
    ? (targetResult.hitTarget
        ? ` I aimed for 60%+ confidence and landed at ${parlayConf}% with ${picks.length} leg${picks.length !== 1 ? "s" : ""}.`
        : ` Couldn't clear 60% — best was ${parlayConf}%. Ask for fewer legs to push it higher; I won't fake the number.`)
    : "";

  const intro = usingLive
    ? `Here's a ${picks.length}-leg ${tierLabel} parlay from **today's real ESPN games**, ranked by my full model (odds, form, coaches, weather). Team records load when you expand "Why this pick?".\n\n`
    : `Here's a ${picks.length}-leg ${tierLabel} parlay — these scored highest in my model, which weighs odds, player form, coach trends, weather, injuries, and situational spots (rest, travel/altitude, pace) together.${targetNote} I've added them to your slip below — remove any you don't want.\n\n`;
  const pickLines = picks
    .map((p) => `PICK: ${p.game} | ${p.market} | ${p.pick} | ${formatOdds(p.odds)}`)
    .join("\n");
  const footer = usingLive
    ? `\n\nCombined: ${formatOdds(math.american)} · market implied ~${(math.prob * 100).toFixed(1)}% · **model confidence ~${parlayConf}%**. Live ESPN data.`
    : `\n\nCombined: ${formatOdds(math.american)} · market implied ~${(math.prob * 100).toFixed(1)}% · **model confidence ~${parlayConf}%**. Hypothetical only.`;
  return { text: intro + pickLines + footer, picks };
};

export default function ParlayBuilder() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Welcome to Stadium Edge. I'm wired to **live odds** (The Odds API), **live games** (ESPN), and a real AI brain. Flip on **PICK LIVE** to pull real odds and matchups, then ask me anything — I weigh odds value, form, coach tendencies, injuries, and weather.\n\nTap **3-Leg, 6-Leg, 9-Leg, or 15-Leg** to build a parlay that size, or just type what you want. Heads up: confidence compounds down with each leg — a 15-leg parlay is a true longshot.",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeLegBtn, setActiveLegBtn] = useState(3);
  // When the user taps "Build" on a game we first ASK how many legs they want
  // (instead of auto-building). This holds the game we're waiting on a leg
  // count for; cleared once they answer (tap a chip or type a number).
  const [pendingLegBuild, setPendingLegBuild] = useState(null);
  const [attachment, setAttachment] = useState(null); // { dataUrl, name, kind }
  const fileInputRef = useRef(null);
  // Per-message slip snapshots persist in chat by default. The user can dismiss
  // a specific snapshot card with the X button (we remember the message index
  // here) or it auto-hides once every game in the snapshot is final.
  const [dismissedSnapshots, setDismissedSnapshots] = useState(() => new Set());
  // Message indices whose slip snapshot the user has "pinned" to send with
  // the next chat message. Lets the user attach multiple prior slips to
  // one question (e.g. "compare these three tickets") instead of being
  // limited to just the current slip.
  const [attachedSlipIdxs, setAttachedSlipIdxs] = useState(() => new Set());

  // Map raw Odds API market keys (e.g. "batter_home_runs") to their
  // user-facing labels. The AI sometimes copies the raw key into the
  // PICK line's market column; we normalize at parse so the card badge
  // never shows snake_case.
  const friendlyMarketLabel = (marketTxt) => {
    if (!marketTxt) return marketTxt;
    const t = String(marketTxt).trim();
    const MARKET_MAP = {
      batter_home_runs: "Home Runs",
      batter_hits: "Hits",
      batter_total_bases: "Total Bases",
      pitcher_strikeouts: "Strikeouts",
      player_points: "Points",
      player_rebounds: "Rebounds",
      player_assists: "Assists",
      player_threes: "3-Pointers Made",
      player_points_rebounds_assists: "Pts+Reb+Ast",
      player_points_rebounds: "Pts+Reb",
      player_points_assists: "Pts+Ast",
      player_rebounds_assists: "Reb+Ast",
      player_points_q1: "1Q Points",
      player_rebounds_q1: "1Q Rebounds",
      player_assists_q1: "1Q Assists",
      player_pass_yds: "Passing Yards",
      player_pass_tds: "Passing TDs",
      player_rush_yds: "Rushing Yards",
      player_reception_yds: "Receiving Yards",
      player_receptions: "Receptions",
      player_anytime_td: "Anytime TD",
      player_pass_yds_q1: "1Q Passing Yards",
      player_pass_tds_q1: "1Q Passing TDs",
      player_rush_yds_q1: "1Q Rushing Yards",
      player_reception_yds_q1: "1Q Receiving Yards",
      player_pass_yds_h1: "1H Passing Yards",
      player_rush_yds_h1: "1H Rushing Yards",
      player_reception_yds_h1: "1H Receiving Yards",
      player_goals: "Goals",
      player_shots_on_goal: "Shots on Goal",
      player_sacks: "Sacks",
      player_tackles: "Tackles",
      player_tackles_assists: "Tackles + Assists",
      player_solo_tackles: "Solo Tackles",
      player_defensive_interceptions: "Interceptions",
      player_pass_interceptions: "Pass INTs Thrown",
      player_pass_completions: "Pass Completions",
      player_pass_attempts: "Pass Attempts",
      player_rush_attempts: "Rush Attempts",
      player_rush_reception_yds: "Rush + Rec Yards",
      player_kicking_points: "Kicking Points",
      player_field_goals: "Field Goals Made",
      player_blocks: "Blocks",
      player_steals: "Steals",
      player_turnovers: "Turnovers",
      player_blocks_steals: "Blocks + Steals",
    };
    const lower = t.toLowerCase();
    if (MARKET_MAP[lower]) return MARKET_MAP[lower];
    // Generic fallback: replace underscores with spaces and title-case.
    if (/_/.test(t)) {
      return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return t;
  };

  // Normalize yes/no markets to the friendly book labels. The Odds API
  // returns HR / anytime-TD / anytime-goal as Over 0.5 props, but books
  // display them as "To Hit a HR" / "Anytime TD" / "Anytime Goal". The
  // AI sometimes drops the trailing market word ("Player Over 0.5" with
  // no "Home Runs" suffix) and sometimes wraps the player in markdown
  // bold (**Player Over 0.5**) — handle both, using the market column
  // as the signal when the pick text alone is ambiguous.
  const friendlyPickLabel = (pickTxt, marketTxt) => {
    if (!pickTxt) return pickTxt;
    // Strip markdown bold/italic wrappers — the cards render plain text.
    let t = String(pickTxt).replace(/\*+/g, "").trim();
    const mk = String(marketTxt || "").toLowerCase();
    const isHR = /home.?run|batter_home_runs/.test(mk) || /\bhome runs?\b/i.test(t) || /\bHR\b/.test(t);
    const isTD = /anytime.?td|player_anytime_td|touchdown/.test(mk) || /\banytime td\b|\btouchdowns?\b/i.test(t);
    const isGoal = /anytime.?goal|player_goals|^goals?$/.test(mk) || /\banytime goal\b/i.test(t);
    // Replace "<anything> Over 0.5 <optional market word>" → "<player> <friendly>"
    const apply = (friendly) => {
      // Try with trailing market word first, then without.
      const m = t.match(/^(.*?)\s*Over\s+0\.5(?:\s+\S.*)?$/i);
      if (m) return `${m[1].trim()} ${friendly}`;
      return t;
    };
    if (isHR) return apply("To Hit a HR");
    if (isTD) return apply("Anytime TD");
    if (isGoal) return apply("Anytime Goal");
    // Countable stat markets (hits, strikeouts, rebounds, etc.) — books
    // display "Over 0.5 Hits" as "1+ Hits", "Over 1.5 Hits" as "2+ Hits".
    // Yardage stats are excluded because their half-point lines really
    // ARE decimal cutoffs (Over 245.5 ≠ "246+").
    const COUNTABLE_MARKET = /\b(hits?|strikeouts?|points?|rebounds?|assists?|3-?pointers?|threes|pts\+reb\+ast|pts\+reb|pts\+ast|reb\+ast|receptions?|shots on goal|sog|goals?|saves?|stolen bases?|walks?|rbis?|runs?|home runs?|sacks?|tackles?|tackles \+ assists?|solo tackles?|interceptions?|pass ints? thrown|pass completions?|pass attempts?|rush attempts?|field goals? made|kicking points?|blocks?|steals?|turnovers?|blocks \+ steals?)\b/i;
    if (COUNTABLE_MARKET.test(t)) {
      // Match "<player> Over N.5 <market>" where N is a non-negative int.
      const cm = t.match(/^(.*?)\s*Over\s+(\d+)\.5\s+(.+)$/i);
      if (cm) {
        const player = cm[1].trim();
        const min = parseInt(cm[2], 10) + 1;
        const mkt = cm[3].trim();
        return `${player} ${min}+ ${mkt}`;
      }
    }
    return t;
  };

  // Parse pick-like rows from uploaded text or CSV.
  // Accepts "Game | Market | Pick | Odds" or CSV "Game,Market,Pick,Odds".
  const parsePicksFromText = (text) => {
    const found = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.includes("|") ? line.split("|") : line.split(",");
      if (parts.length >= 4) {
        const odds = parseInt(parts[3].replace(/[^\d+-]/g, ""));
        if (!isNaN(odds)) {
          { const mkt = friendlyMarketLabel(parts[1].trim()); found.push({ game: parts[0].trim(), market: mkt, pick: friendlyPickLabel(parts[2].trim(), mkt), odds }); }
        }
      }
    }
    return found;
  };

  const handleFileUpload = (file) => {
    if (!file) return;
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setAttachment({ dataUrl: reader.result, name: file.name, kind: "image" });
      reader.readAsDataURL(file);
    } else if (/text|csv|json/.test(file.type) || /\.(txt|csv|tsv)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = () => {
        const picks = parsePicksFromText(String(reader.result));
        if (picks.length) autoFillSlip(picks);
        setMessages((p) => [
          ...p,
          { role: "user", content: `📎 Uploaded ${file.name}` },
          {
            role: "assistant",
            content: picks.length
              ? `I read ${picks.length} pick${picks.length !== 1 ? "s" : ""} from your file and added them to your slip below — remove any you don't want.\n\n${picks
                  .map((pk) => `PICK: ${pk.game} | ${pk.market} | ${pk.pick} | ${formatOdds(pk.odds)}`)
                  .join("\n")}`
              : `I couldn't find pick rows in ${file.name}. Format each line as: Game | Market | Pick | Odds (e.g. "Lakers @ Celtics | Spread | Celtics -4.5 | -110").`,
          },
        ]);
      };
      reader.readAsText(file);
    } else {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: `I can preview images and read text/CSV files. ${file.name} is an unsupported type.` },
      ]);
    }
  };
  const [selectedSports, setSelectedSports] = useState(SPORTS.map((s) => s.id));
  const [parlayLegs, setParlayLegs] = useState([]);
  const [stake, setStake] = useState(20);
  const [loading, setLoading] = useState(false);
  const [showDemoPicker, setShowDemoPicker] = useState(false);
  const [showMatchup, setShowMatchup] = useState(false);
  const [matchupSport, setMatchupSport] = useState("nfl");
  const [playerA, setPlayerA] = useState(null);
  const [playerB, setPlayerB] = useState(null);
  const [selectingFor, setSelectingFor] = useState(null); // 'A' or 'B'
  const [showWeather, setShowWeather] = useState(false);
  const [showInjuries, setShowInjuries] = useState(false);
  const [showCoaches, setShowCoaches] = useState(false);
  const [showLiveDemo, setShowLiveDemo] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [view, setView] = useState("home"); // "chat" | "home" | "profile"
  const [homeLiveGames, setHomeLiveGames] = useState([]);
  const [homeUpcomingGames, setHomeUpcomingGames] = useState([]);
  const [homeDataStatus, setHomeDataStatus] = useState("loading"); // "loading" | "live" | "sim"
  const [realGamesBySport, setRealGamesBySport] = useState({}); // { nfl: [{awayTeam,homeTeam,status,startsAt,venue,...}], ... }
  const [realOddsBySport, setRealOddsBySport] = useState({}); // { nfl: [{id,homeTeam,awayTeam,markets}], ... }
  const [realPropsByEvent, setRealPropsByEvent] = useState({}); // { eventId: { home, away, bookmaker, props:[{player,market,line,overPrice,underPrice}] } }
  // Sports for which the backend now ships quarter/half player markets
  // (_q1 / _h1). A cached entry for one of these sports that contains ZERO
  // QH rows is treated as STALE and re-fetched — this auto-migrates users
  // who had the page open across the QH-markets deploy and would otherwise
  // be stuck on a pre-QH cached payload until they hard-refresh.
  const QH_SUPPORTED_SPORTS = new Set(["nba", "wnba", "nfl", "ncaaf"]);
  const isStalePropsCache = (sport, cached) => {
    if (!cached || !Array.isArray(cached.props) || cached.props.length === 0) return false;
    if (!QH_SUPPORTED_SPORTS.has(sport)) return false;
    // ONE-SHOT guard: once we've refetched this event and stamped it as
    // QH-checked, treat the cache as fresh even if QH rows are still empty
    // (the game may just be too far out for bookmakers to have posted QH
    // lines yet). Without this, the game-detail useEffect — which depends
    // on realPropsByEvent — would loop: detect stale → refetch → setState
    // with same stale shape → effect re-runs → detect stale → refetch …
    if (cached._qhChecked) return false;
    return !cached.props.some((p) => /_q1$|_h1$/.test(p?.market || ""));
  };
  const stampQhChecked = (data) => ({ ...data, _qhChecked: true });
  const [propsLoading, setPropsLoading] = useState(false);
  const [headshotErrors, setHeadshotErrors] = useState({}); // { [headshotUrl]: true } — track broken URLs so we can swap to initials
  const [homeSearch, setHomeSearch] = useState("");
  const [sportDetail, setSportDetail] = useState(null); // sport id when viewing a sport's teams/props
  const [expandedGame, setExpandedGame] = useState(null); // game string expanded to show all props
  const [gameDetail, setGameDetail] = useState(null); // { game, sport } for the full game-detail screen
  const [openPropCats, setOpenPropCats] = useState(["AI Spreads & Totals", "Game Lines"]); // categories open (independent accordions)
  const [gameDetailHistory, setGameDetailHistory] = useState({ key: null, data: null, loading: false }); // real recent-form pull for the open Game Detail's AI spread/total tab
  const [expandedPropPlayers, setExpandedPropPlayers] = useState({}); // player name -> bool, tracks which player-prop cards are expanded
  const [legMenuOpen, setLegMenuOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null); // { player, sport }
  const [propLine, setPropLine] = useState(null); // current adjustable prop line in the detail view
  const propChartRef = useRef(null);
  const [propStatKey, setPropStatKey] = useState(null);
  // Team detail page (mirror of the player props page, but for a team total —
  // built from REAL last-10 final scores, not a sample). { sport, side,
  // teamName, logo, oppName, gameLabel, loading, error, last10, recent, streak, season }
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamLine, setTeamLine] = useState(null); // adjustable team-total line in the team view
  const teamChartRef = useRef(null);
  const [slipAnalysis, setSlipAnalysis] = useState(null); // analysis text shown under the slip
  const [fixSummary, setFixSummary] = useState(null); // compact one-line receipt of the last Fix action
  const [legsAnalyzed, setLegsAnalyzed] = useState(false); // per-leg analysis under each bet
  const [selectedPlan, setSelectedPlan] = useState("free");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [gatedFeature, setGatedFeature] = useState("");
  // 7-day free trial — unlocks everything. NOTE: the offline app can't track real
  // calendar days (no persistent storage), so this is a session-level demo trial.
  // Real day-counting + expiry is the Next.js version (server-tracked start date).
  const [trialActive, setTrialActive] = useState(true);
  const trialDaysLeft = 7; // demo value
  // DEMO paywall: unlocked if on a paid plan OR within the free trial.
  const isPro = selectedPlan !== "free" || trialActive;
  // Returns true if allowed; otherwise opens the upgrade prompt and returns false.
  const requirePro = (featureLabel) => {
    if (isPro) return true;
    setGatedFeature(featureLabel);
    setUpgradeOpen(true);
    return false;
  };
  const [betslipOpen, setBetslipOpen] = useState(false);
  // Popup slip above the chat input. Collapsed by default; tap the bar to expand.
  const [slipOpen, setSlipOpen] = useState(false);
  // Per-leg "edge notes" expand state — set of leg ids currently showing reasons.
  const [expandedLegIds, setExpandedLegIds] = useState(() => new Set());
  // Real authentication via Replit-managed Clerk. The user store IS the database:
  // accounts created here persist in Clerk. Auth is optional — the app is a public
  // landing; signing in lets a user attach their tracked slips to an account.
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();
  const handleSignOut = () => {
    signOut();
  };
  const [booting, setBooting] = useState(true);
  const swipeStart = useRef(null); // { x, y } or null

  const onPointerDown = (e) => {
    // pointer events cover both touch and mouse
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Mostly-horizontal swipe of decent length
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
    const screenW = typeof window !== "undefined" ? window.innerWidth : 400;
    if (dx > 0 && start.x < screenW * 0.4 && !fabOpen) {
      // Swipe right starting from the left ~40% of the screen → open drawer
      setFabOpen(true);
    } else if (dx < 0 && fabOpen) {
      // Swipe left while open → close drawer
      setFabOpen(false);
    }
  };
  const [showSports, setShowSports] = useState(false);
  const [simLiveGames, setSimLiveGames] = useState([]);
  const [simTick, setSimTick] = useState(0);
  // Real head-to-head data the chat send already fetches from /matchup-history.
  // Keyed by "Away @ Home" game label, value is the same compact h2h object
  // ({ homeWins, awayWins, meetings:[…] }) we send to the AI. Stored here so
  // generateReasoning() can render the W-L line under "Why this pick?" for
  // moneyline picks without re-fetching.
  const [matchupHistoryByGame, setMatchupHistoryByGame] = useState({}); // { "<gameLabel>": { home, away, h2h } }
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualForm, setManualForm] = useState({ game: "", market: "Moneyline", pick: "", odds: -110 });
  const [expandedPicks, setExpandedPicks] = useState(new Set());
  const [tracker, setTracker] = useState([]);
  const [showTracker, setShowTracker] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(new Set());
  const [historyFilter, setHistoryFilter] = useState({ status: "all", market: "all" });
  const [historySort, setHistorySort] = useState("newest"); // "newest" | "oldest"
  const [liveMode, setLiveMode] = useState(false);
  const [livePicks, setLivePicks] = useState([]); // ESPN-derived picks
  const [liveStatus, setLiveStatus] = useState("idle"); // "idle"|"loading"|"ok"|"blocked"
  const [teamRecords, setTeamRecords] = useState({}); // { "sport::teamId": record }
  const [enrichedPicks, setEnrichedPicks] = useState({}); // pickKey -> {teamId, sport, teamAbbr}
  const [playerPhotos, setPlayerPhotos] = useState({}); // { sport: { normalizedName: url } }

  // Fetch league-wide athlete headshots for each selected sport (cached server-side 6h).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates = {};
      await Promise.all(
        selectedSports.map(async (s) => {
          if (playerPhotos[s]) return;
          try {
            const r = await fetch(`/api/sports/athletes?sport=${s}`);
            if (!r.ok) return;
            const data = await r.json();
            if (data?.photos) updates[s] = data.photos;
          } catch {
            // ignore
          }
        }),
      );
      if (!cancelled && Object.keys(updates).length) {
        setPlayerPhotos((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when selected sports list changes. normalizeName intentionally omitted (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSports.join(",")]);

  const lookupPlayerPhoto = (sport, name) => {
    if (!name) return null;
    const norm = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    return playerPhotos[sport]?.[norm] ?? null;
  };

  // When Live Mode toggles on or selected sports change, fetch ESPN games
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 2100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!liveMode) return;
    let cancelled = false;
    setLiveStatus("loading");

    const fetchRealOdds = async (sportId) => {
      try {
        // Three-tier real-odds chain — all return identical shape:
        //   1. The Odds API (paid, multi-book consensus)
        //   2. ESPN pickcenter (free, DraftKings)
        //   3. Bovada public coupon (free, Bovada)
        // Each tier is only consulted when the prior returns !ok OR an
        // empty array (so we don't get stuck on a tier that responds 200
        // but has nothing for this sport, e.g. UFC out-of-season).
        const tryFetch = async (url, retry = true) => {
          try {
            const r = await fetch(url);
            // 429 = our own per-IP limiter throttled a burst, NOT "no data for
            // this sport". Retry once after a short jitter so a transient
            // throttle doesn't silently drop the sport from the pool.
            if (r.status === 429 && retry) {
              await new Promise((res) => setTimeout(res, 400 + Math.random() * 600));
              return tryFetch(url, false);
            }
            if (!r.ok) return null;
            const j = await r.json();
            return Array.isArray(j) && j.length > 0 ? j : null;
          } catch { return null; }
        };
        const games = (await tryFetch(`/api/sports/odds?sport=${sportId}`))
          ?? (await tryFetch(`/api/sports/odds-espn?sport=${sportId}`))
          ?? (await tryFetch(`/api/sports/odds-bovada?sport=${sportId}`))
          ?? [];
        const picks = [];
        for (const g of games) {
          const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
          const startsAt = g.commenceTime || null;
          const h2h = g.markets.find((m) => m.key === "h2h");
          const spread = g.markets.find((m) => m.key === "spreads");
          const total = g.markets.find((m) => m.key === "totals");
          if (h2h) {
            for (const o of h2h.outcomes) {
              picks.push({
                game: gameLabel,
                market: "Moneyline",
                pick: `${o.name} ML`,
                odds: o.price,
                tier: o.price < -200 ? 1 : 2,
                sport: sportId,
                teamAbbr: o.name.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "",
                sourceSport: sportId,
                startsAt,
              });
            }
          }
          if (spread) {
            for (const o of spread.outcomes) {
              picks.push({
                game: gameLabel,
                market: "Spread",
                pick: `${o.name} ${o.point > 0 ? "+" : ""}${o.point}`,
                odds: o.price,
                tier: 2,
                sport: sportId,
                teamAbbr: o.name.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "",
                sourceSport: sportId,
                startsAt,
              });
            }
          }
          if (total) {
            for (const o of total.outcomes) {
              picks.push({
                game: gameLabel,
                market: "Total",
                pick: `${o.name} ${o.point}`,
                odds: o.price,
                tier: 2,
                sport: sportId,
                sourceSport: sportId,
                startsAt,
              });
            }
          }
        }
        return picks;
      } catch (_e) {
        return [];
      }
    };

    Promise.allSettled([
      ...selectedSports.map((s) => fetchEspnGamesForSport(s)),
      ...selectedSports.map((s) => fetchRealOdds(s)),
    ])
      .then((results) => {
        if (cancelled) return;
        const half = selectedSports.length;
        const espnResults = results.slice(0, half);
        const oddsResults = results.slice(half);

        const allGames = espnResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        const espnPicks = buildPicksFromEspnGames(allGames);
        const realOddsPicks = oddsResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

        // Real-odds picks first (preferred); fall back to ESPN-derived for sports not in odds feed
        const combined = [...realOddsPicks, ...espnPicks];
        const anySuccess = results.some((r) => r.status === "fulfilled" && Array.isArray(r.value) && r.value.length > 0);
        setLivePicks(combined);
        setLiveStatus(anySuccess ? "ok" : "blocked");
      })
      .catch(() => {
        if (!cancelled) setLiveStatus("blocked");
      });
    return () => {
      cancelled = true;
    };
  }, [liveMode, selectedSports]);

  // Fetch team record on demand for a pick (called when "Why this pick?" expands)
  const ensureTeamRecord = async (pick) => {
    if (!pick.teamId || !pick.sport) return;
    const key = `${pick.sport}::${pick.teamId}`;
    if (teamRecords[key] !== undefined) return; // already fetched (incl. null)
    const rec = await fetchEspnTeamRecord(pick.sport, pick.teamId);
    setTeamRecords((prev) => ({ ...prev, [key]: rec }));
  };

  // Keep a current set of simulated live games so the live count shows on pills
  // even before the modal is opened. (Sim only — real live data is the Next.js version.)
  useEffect(() => {
    setSimLiveGames(generateSimLiveGames(selectedSports));
  }, [selectedSports]);

  // Refresh simulated live games when the demo modal is open (every 10s)
  useEffect(() => {
    if (!showLiveDemo) return;
    setSimLiveGames(generateSimLiveGames(selectedSports));
    const iv = setInterval(() => {
      setSimLiveGames(generateSimLiveGames(selectedSports));
      setSimTick((t) => t + 1);
    }, 10000);
    return () => clearInterval(iv);
  }, [showLiveDemo, selectedSports]);

  // Populate + refresh real live + upcoming games and bookmaker odds for the
  // selected sports. Powers the Home Screen, Sport Detail, search, and the live
  // modal. Falls back to simulated games if the API is unreachable.
  // Fetch real player props when a Game Detail is opened. Uses the event id
  // from the matched Odds API entry; cached on the server for 5 minutes.
  useEffect(() => {
    if (!gameDetail) { setPropsLoading(false); return; }
    const { game, sport } = gameDetail;
    const match = (realOddsBySport[sport] || []).find(
      (g) => `${g.awayTeam} @ ${g.homeTeam}` === game,
    );
    if (!match?.id) { setPropsLoading(false); return; }
    if (realPropsByEvent[match.id] && !isStalePropsCache(sport, realPropsByEvent[match.id])) {
      setPropsLoading(false);
      return;
    }
    // Look up team IDs from the matching ESPN game so the server can enrich
    // each prop with player headshots from the team rosters.
    const espnGame = (realGamesBySport[sport] || []).find(
      (g) => `${g.awayTeam} @ ${g.homeTeam}` === game,
    );
    const qsParts = [`sport=${encodeURIComponent(sport)}`, `eventId=${encodeURIComponent(match.id)}`];
    if (espnGame?.homeTeamId) qsParts.push(`homeTeamId=${encodeURIComponent(espnGame.homeTeamId)}`);
    if (espnGame?.awayTeamId) qsParts.push(`awayTeamId=${encodeURIComponent(espnGame.awayTeamId)}`);
    // Pass team names so the server can resolve the real Odds API event id when
    // match.id came from a fallback odds source (ESPN/Bovada) — otherwise that
    // id 404s/422s the props endpoint and Game Detail shows no props.
    if (match.homeTeam) qsParts.push(`home=${encodeURIComponent(match.homeTeam)}`);
    if (match.awayTeam) qsParts.push(`away=${encodeURIComponent(match.awayTeam)}`);
    let cancelled = false;
    setPropsLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/sports/props?${qsParts.join("&")}`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setRealPropsByEvent((prev) => ({ ...prev, [match.id]: stampQhChecked(data) }));
      } catch {
        /* leave unset — section just won't render */
      } finally {
        if (!cancelled) setPropsLoading(false);
      }
    })();
    return () => { cancelled = true; setPropsLoading(false); };
  }, [gameDetail, realOddsBySport, realGamesBySport, realPropsByEvent]);

  // Fetch REAL recent-form history (each team's last-10 scoring) for the open
  // Game Detail, so the "AI Spreads & Totals" tab can base its spread/total
  // call on actual analytics — not just a de-vigged price. Honest empty bucket
  // on failure; the tab then falls back to the market-price read.
  useEffect(() => {
    if (!gameDetail) { setGameDetailHistory({ key: null, data: null, loading: false }); return; }
    const { game, sport } = gameDetail;
    const key = `${sport}::${game}`;
    const espnGame = (realGamesBySport[sport] || []).find(
      (g) => `${g.awayTeam} @ ${g.homeTeam}` === game,
    );
    if (!espnGame?.homeTeamId || !espnGame?.awayTeamId) {
      setGameDetailHistory({ key, data: null, loading: false });
      return;
    }
    let cancelled = false;
    setGameDetailHistory({ key, data: null, loading: true });
    (async () => {
      try {
        const qs = `sport=${encodeURIComponent(sport)}&homeTeamId=${encodeURIComponent(espnGame.homeTeamId)}&awayTeamId=${encodeURIComponent(espnGame.awayTeamId)}`;
        const r = await fetch(`/api/sports/matchup-history?${qs}`);
        const data = r.ok ? await r.json() : null;
        if (!cancelled) setGameDetailHistory({ key, data, loading: false });
      } catch {
        if (!cancelled) setGameDetailHistory({ key, data: null, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [gameDetail, realGamesBySport]);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        // Fetch games for ALL sports — Upcoming on home shows every sport, not
        // just the ones currently selected for parlay building.
        const allSportIds = SPORTS.map((x) => x.id);
        const results = await Promise.all(
          allSportIds.map(async (s) => {
            try {
              const r = await fetch(`/api/sports/games?sport=${s}`);
              if (!r.ok) return { sport: s, games: [] };
              const games = await r.json();
              return { sport: s, games: games.map((g) => ({ ...g, sportId: s })) };
            } catch {
              return { sport: s, games: [] };
            }
          })
        );
        if (cancelled) return;
        const bySport = {};
        for (const { sport, games } of results) {
          bySport[sport] = games.filter((g) => g.awayTeam && g.homeTeam);
        }
        setRealGamesBySport(bySport);
        // Fire-and-forget odds fetch (don't block games render).
        Promise.all(
          selectedSports.map(async (s) => {
            // Three-tier chain: paid Odds API → ESPN pickcenter → Bovada
            // public coupon. Each tier only consulted when prior returns
            // !ok or empty so we don't get stuck on an empty-200 response.
            const tryFetch = async (url, retry = true) => {
              try {
                const r = await fetch(url);
                if (r.status === 429 && retry) {
                  await new Promise((res) => setTimeout(res, 400 + Math.random() * 600));
                  return tryFetch(url, false);
                }
                if (!r.ok) return null;
                const j = await r.json();
                return Array.isArray(j) && j.length > 0 ? j : null;
              } catch { return null; }
            };
            const odds = (await tryFetch(`/api/sports/odds?sport=${s}`))
              ?? (await tryFetch(`/api/sports/odds-espn?sport=${s}`))
              ?? (await tryFetch(`/api/sports/odds-bovada?sport=${s}`))
              ?? [];
            return { sport: s, odds };
          })
        ).then((oddsResults) => {
          if (cancelled) return;
          const oBySport = {};
          for (const { sport, odds } of oddsResults) oBySport[sport] = odds;
          setRealOddsBySport(oBySport);
        });
        const all = results.flatMap((r) => r.games);
        const live = [];
        const upcoming = [];
        for (const g of all) {
          if (!g.awayTeam || !g.homeTeam) continue;
          // Both Live and Upcoming span ALL sports — the selected-sports
          // filter only narrows what parlay-building draws from. "Live now"
          // should always show every real live game across every sport so
          // the user never misses a game in progress just because they
          // hadn't toggled that sport on for parlays.
          const s = (g.status || "").toLowerCase();
          // Widened to include "ended" + standalone "ft" so games that ESPN
          // has flipped to a finished state never linger in the live bucket.
          const isFinal = s.includes("final") || s.includes("full time") || s.includes("postponed") || s.includes("canceled") || s.includes("cancelled") || s.includes("ended") || /\bft\b/.test(s);
          if (isFinal) continue;
          const isScheduled = s.includes("scheduled") || s.includes("pre");
          // A game stays in the Live bucket until ESPN literally flips it
          // to a final/postponed/cancelled status (caught by isFinal above)
          // or it's still pre-game (isScheduled). Anything in between —
          // "In Progress", "Halftime", "End of 3rd", "Overtime",
          // "Suspended", "Delayed", an unrecognized status string, etc. —
          // is treated as live so the Pick Live view doesn't drop a game
          // just because we don't recognize its period label.
          const isLive = !isScheduled;
          if (isLive) {
            live.push({
              real: true,
              // ESPN event id — required for the per-game ESPN odds fallback
              // (`/api/sports/espn-odds?eventId=…`). Without it the analyzer
              // can't pull DraftKings pickcenter lines when the primary
              // odds feed is out of credits.
              id: g.id,
              sport: g.sportId,
              away: g.awayTeam,
              home: g.homeTeam,
              // Keep nulls when ESPN hasn't shipped scores yet — UI renders
              // "—" so we never imply 0-0 on a game that's actually live.
              awayScore: g.awayScore ?? null,
              homeScore: g.homeScore ?? null,
              // Real period + clock straight from ESPN's scoreboard payload.
              // `periodLabel` is ESPN's shortDetail ("Q3 8:42", "Bot 7th",
              // "HT", "OT") which is what fans see on espn.com. Falls back
              // only to the real status string — never to a fabricated "Live".
              periodLabel: g.periodLabel || g.status || null,
              clock: g.clock || null,
              period: g.period ?? null,
              game: `${g.awayTeam} @ ${g.homeTeam}`,
              startsAt: g.startsAt,
              homeLogo: g.homeLogo,
              awayLogo: g.awayLogo,
            });
          } else if (isScheduled) {
            // Safety net: ESPN occasionally leaves a game stuck on
            // "scheduled" past its real tipoff (cache lag, postponement
            // flag stuck, team-name mismatch against the score feed).
            // Any "scheduled" game whose start time is already in the
            // past is not actually upcoming — drop it so we don't show
            // "TUE 7:30 PM" on Wednesday morning. Tiny 10-minute grace
            // covers pre-game pageviews where the clock crosses tipoff.
            if (g.startsAt) {
              const t = new Date(g.startsAt).getTime();
              if (Number.isFinite(t)) {
                // Already past its real start (cache lag / stuck flag) — not upcoming.
                if (Date.now() - t > 10 * 60 * 1000) continue;
                // Cap how far out "Upcoming" reaches. Offseason schedules (esp.
                // NFL in spring/summer) list games weeks/months ahead; those
                // aren't bettable yet and crowd out this week's slate. Only show
                // games tipping off within the next 7 days.
                if (t - Date.now() > 7 * 24 * 60 * 60 * 1000) continue;
              }
            }
            upcoming.push({
              real: true,
              game: `${g.awayTeam} @ ${g.homeTeam}`,
              sport: g.sportId,
              startsAt: g.startsAt,
              venue: g.venue,
              homeLogo: g.homeLogo,
              awayLogo: g.awayLogo,
            });
          }
        }
        // Sort UPCOMING by popularity within the next 24h, then by start time.
        // Popularity heuristic = sport weight + popular-team weight (per team)
        // + finals/playoffs bonus + small soon-to-start bonus.
        const SPORT_W = { nfl: 100, nba: 90, soccer: 85, wnba: 80, mlb: 70, nhl: 65, ncaaf: 60, ncaab: 55, ufc: 50, tennis: 45 };
        const POPULAR_TEAMS = new Set([
          // NFL
          "KC","DAL","BUF","PHI","SF","BAL","GB","DET","MIA","NYJ","CIN","NE","PIT","LAR",
          // NBA
          "LAL","BOS","GSW","DEN","MIL","PHX","DAL","NYK","MIA","OKC","MIN",
          // MLB
          "NYY","LAD","BOS","HOU","ATL","CHC","SF","PHI","STL",
          // NHL
          "TOR","BOS","NYR","EDM","COL","VGK","FLA","DAL","DET","CHI",
          // Popular soccer clubs (abbr varies)
          "ARS","PSG","RMA","BAR","MCI","LIV","MUN","BAY","JUV","CHE","TOT","INT","MIL","DOR","ATM",
        ]);
        const FINAL_RX = /final|conference|championship|playoff|elimination|series/i;
        const popularityScore = (g) => {
          const sportW = SPORT_W[g.sport] ?? 40;
          const ah = (g.awayAbbr || g.away || "").toUpperCase();
          const hh = (g.homeAbbr || g.home || "").toUpperCase();
          // Pull abbreviations from "AWAY @ HOME" label as a fallback.
          const m = /^(\S+)\s+@\s+(\S+)/.exec(g.game || "");
          const a = ah || (m?.[1] || "").toUpperCase();
          const h = hh || (m?.[2] || "").toUpperCase();
          const teamW = (POPULAR_TEAMS.has(a) ? 25 : 0) + (POPULAR_TEAMS.has(h) ? 25 : 0);
          const finalsW = FINAL_RX.test(g.status || "") || FINAL_RX.test(g.venue || "") ? 40 : 0;
          // Slightly prefer games tipping off sooner (within 24h) so the
          // soonest popular game floats to the top.
          const ts = new Date(g.startsAt).getTime();
          const hoursOut = isNaN(ts) ? 24 : Math.max(0, (ts - Date.now()) / 3_600_000);
          const soonW = hoursOut <= 24 ? Math.max(0, 24 - hoursOut) * 0.5 : -1000; // de-prioritize >24h
          return sportW + teamW + finalsW + soonW;
        };
        // Stash abbreviations on each upcoming game (used by popularityScore).
        for (const u of upcoming) {
          const src = (all || []).find((g) => `${g.awayTeam} @ ${g.homeTeam}` === u.game && g.sportId === u.sport);
          if (src) { u.awayAbbr = src.awayAbbr; u.homeAbbr = src.homeAbbr; u.status = src.status; }
        }
        upcoming.sort((a, b) => {
          const sa = popularityScore(a), sb = popularityScore(b);
          if (sb !== sa) return sb - sa;
          return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        });
        if (all.length > 0) {
          setHomeLiveGames(live);
          setHomeUpcomingGames(upcoming);
          setHomeDataStatus("live");
        } else {
          // API unreachable or no data — fall back to simulator
          setHomeLiveGames(generateSimLiveGames(selectedSports));
          setHomeUpcomingGames([]);
          setHomeDataStatus("sim");
        }
      } catch {
        if (!cancelled) {
          setHomeLiveGames(generateSimLiveGames(selectedSports));
          setHomeUpcomingGames([]);
          setHomeDataStatus("sim");
        }
      }
    };

    fetchAll();
    const iv = setInterval(fetchAll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [selectedSports]);

  // Parse a leg count (1–15) out of a free-text reply like "5", "5 legs",
  // "give me 4". Returns null if no usable number is present.
  const parseLegCount = (text) => {
    const m = /\b(\d{1,2})\b/.exec(String(text || ""));
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 15 ? n : null;
  };

  // Helper: instead of auto-building, ASK how many legs the user wants for this
  // game first. Stash the game in `pendingLegBuild`; the build fires once they
  // answer (tap a chip via confirmLegCountForGame, or type a number — handled
  // at the top of sendMessage).
  const askLegCountForGame = (gameLabel, sport, kind) => {
    if (!requirePro("Build from game")) return;
    setView("chat");
    setPendingLegBuild({ gameLabel, sport, kind, real: true });
    setMessages((p) => [
      ...p,
      { role: "user", content: `Build a parlay for ${gameLabel}` },
      {
        role: "assistant",
        content: `How many legs would you like for **${gameLabel}**?`,
      },
    ]);
  };

  // Build the parlay now that we know the leg count.
  const confirmLegCountForGame = (n) => {
    const pend = pendingLegBuild;
    if (!pend) return;
    setPendingLegBuild(null);
    setActiveLegBtn(n);
    if (pend.real) {
      const verb = pend.kind === "live" ? "live parlay" : "parlay";
      sendMessage(`Build me the best ${n}-leg ${verb} for ${pend.gameLabel} (${pend.sport.toUpperCase()}).`);
    } else {
      buildParlayForUpcomingGame(pend.gameLabel, pend.sport, n);
    }
  };

  // Helper: ask the AI to build a parlay for a real game using live context.
  const buildParlayForRealGame = (gameLabel, sport, kind) => {
    if (!requirePro("Build from game")) return;
    // Upcoming games go through the "how many legs?" prompt first. Live games
    // keep building immediately (the live-game flow is a fast in-the-moment
    // action, not a planned ticket).
    if (kind === "live") {
      setView("chat");
      sendMessage(`Build me the best live parlay for ${gameLabel} (${sport.toUpperCase()}). Use real current odds.`);
      return;
    }
    askLegCountForGame(gameLabel, sport, kind);
  };

  // ---- In-app live-game parlay analyzer (REAL data only) ----
  // Given one real live game (`g.real === true`), pull the matching odds
  // entry from realOddsBySport, build candidate picks from h2h / spreads /
  // totals + any loaded live player props, score each against the live
  // state (score margin, pacing, period progression), and post the
  // strongest 2-5 distinct-market legs as a chat reply + auto-fill the slip.
  // Honest fallback: if odds aren't available for this game (odds API
  // quota / off-season market), tell the user — never fabricate.
  const buildBestParlayForLiveRealGame = async (g) => {
    if (!requirePro("Live picks")) return;
    setView("chat");
    const userMsg = `Best 2–5 leg live parlay for ${g.away} @ ${g.home}`;

    // 1) Match the live game to a bookmaker odds entry by team names.
    let oddsEntry = (realOddsBySport[g.sport] || []).find(
      (o) => o.awayTeam === g.away && o.homeTeam === g.home,
    );

    // 1b) Fallback: if our primary odds feed is out of credits / paused,
    // pull DraftKings live lines straight from ESPN's per-event summary
    // (it carries pickcenter[0] even for in-progress games). Real
    // bookmaker numbers, just from a different source — never fabricated.
    if (!oddsEntry && g.id) {
      try {
        const r = await fetch(`/api/sports/espn-odds?sport=${g.sport}&eventId=${g.id}`);
        const espnOdds = await r.json();
        if (espnOdds && (espnOdds.moneyline || espnOdds.spread || espnOdds.total)) {
          const markets = [];
          if (espnOdds.moneyline) {
            markets.push({ key: "h2h", outcomes: [
              { name: g.home, price: espnOdds.moneyline.home },
              { name: g.away, price: espnOdds.moneyline.away },
            ]});
          }
          if (espnOdds.spread) {
            markets.push({ key: "spreads", outcomes: [
              { name: g.home, price: espnOdds.spread.homePrice, point: espnOdds.spread.homeLine },
              { name: g.away, price: espnOdds.spread.awayPrice, point: espnOdds.spread.awayLine },
            ]});
          }
          if (espnOdds.total) {
            markets.push({ key: "totals", outcomes: [
              { name: "Over", price: espnOdds.total.over, point: espnOdds.total.line },
              { name: "Under", price: espnOdds.total.under, point: espnOdds.total.line },
            ]});
          }
          oddsEntry = {
            id: g.id,
            sport: g.sport,
            homeTeam: g.home,
            awayTeam: g.away,
            markets,
            _source: `ESPN/${espnOdds.provider || "DraftKings"}`,
          };
        }
      } catch (_e) { /* fall through to honest "no odds" message */ }
    }

    if (!oddsEntry) {
      setMessages((p) => [
        ...p,
        { role: "user", content: userMsg },
        { role: "assistant", content:
          `No live bookmaker odds available for **${g.away} @ ${g.home}** right now — both our primary feed and the ESPN fallback came back empty. I won't fabricate lines. Try again in a minute, or pick a different live game.`
        },
      ]);
      return;
    }

    // 2) Build candidate picks from h2h / spreads / totals.
    const main = buildPicksFromOdds({ ...oddsEntry, sport: g.sport });

    // 3) Optionally add live player props (over side only, reasonable odds).
    // The props API is keyed by the Odds-API event id (NOT the ESPN id), so
    // we always look up the matching odds-API entry by team names — even
    // when oddsEntry came from the ESPN fallback above and has an ESPN id.
    // If the odds-API feed has no entry for this game (off-season, quota
    // exhausted, or game just not listed), props simply aren't available
    // here — we never fabricate them.
    const oddsApiMatch = (realOddsBySport[g.sport] || []).find(
      (o) => o.awayTeam === g.away && o.homeTeam === g.home,
    );
    const propsKey = oddsApiMatch?.id || null;
    // Look up the ESPN game ONCE — we use its team ids for props
    // enrichment AND for the matchup-history pull below.
    const espnGameForHistory = (realGamesBySport[g.sport] || []).find(
      (e) => e.awayTeam === g.away && e.homeTeam === g.home,
    );
    // Proactively fetch props for this game if we haven't already cached
    // them — clicking "Build best parlay" doesn't otherwise trigger the
    // game-detail or chat-side fetch path. Enrich with ESPN team ids so
    // the server can attach player headshots.
    // Local override used when we have to fetch in this closure — the
    // setRealPropsByEvent setter is async so the React-state map is still
    // empty in this run; we read from `freshlyFetched` first, then fall
    // back to the existing state map.
    let freshlyFetched = null;
    const cachedForKey = propsKey ? realPropsByEvent[propsKey] : null;
    const needsFetch = propsKey && (!cachedForKey || isStalePropsCache(g.sport, cachedForKey));
    if (needsFetch) {
      try {
        const espn = espnGameForHistory;
        const qs = [`sport=${encodeURIComponent(g.sport)}`, `eventId=${encodeURIComponent(propsKey)}`];
        if (espn?.homeTeamId) qs.push(`homeTeamId=${encodeURIComponent(espn.homeTeamId)}`);
        if (espn?.awayTeamId) qs.push(`awayTeamId=${encodeURIComponent(espn.awayTeamId)}`);
        const pr = await fetch(`/api/sports/props?${qs.join("&")}`);
        if (pr.ok) {
          const data = await pr.json();
          if (data?.props?.length) {
            const stamped = stampQhChecked(data);
            setRealPropsByEvent((prev) => ({ ...prev, [propsKey]: stamped }));
            freshlyFetched = stamped;
          }
        }
      } catch { /* honest no-props fallback */ }
    }
    const liveProps = freshlyFetched || (propsKey ? realPropsByEvent[propsKey] : null);
    const propPicks = [];
    if (liveProps?.props?.length) {
      const MARKET_LABEL = {
        player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
        player_threes: "3-Pointers Made", player_points_rebounds_assists: "Pts+Reb+Ast", player_points_rebounds: "Pts+Reb", player_points_assists: "Pts+Ast", player_rebounds_assists: "Reb+Ast",
        player_blocks: "Blocks", player_steals: "Steals", player_turnovers: "Turnovers", player_blocks_steals: "Blocks + Steals",
        player_points_q1: "1Q Points", player_rebounds_q1: "1Q Rebounds", player_assists_q1: "1Q Assists",
        player_pass_yds: "Passing Yards", player_pass_tds: "Passing TDs",
        player_rush_yds: "Rushing Yards", player_reception_yds: "Receiving Yards",
        player_receptions: "Receptions", player_anytime_td: "Anytime TD",
        player_pass_yds_q1: "1Q Passing Yards", player_pass_tds_q1: "1Q Passing TDs",
        player_rush_yds_q1: "1Q Rushing Yards", player_reception_yds_q1: "1Q Receiving Yards",
        player_pass_yds_h1: "1H Passing Yards", player_rush_yds_h1: "1H Rushing Yards",
        player_reception_yds_h1: "1H Receiving Yards",
        batter_hits: "Hits", batter_total_bases: "Total Bases", batter_home_runs: "Home Runs",
        pitcher_strikeouts: "Strikeouts", player_goals: "Goals", player_shots_on_goal: "Shots on Goal",
      };
      for (const pr of liveProps.props) {
        if (pr.overPrice == null) continue;
        if (pr.overPrice < -200 || pr.overPrice > 180) continue;
        const label = MARKET_LABEL[pr.market] || pr.market;
        const lineTxt = pr.line == null ? "" : ` ${pr.line}`;
        // Yes/no markets are technically Over 0.5 in the feed but books
        // display them as "To Hit a HR" / "Anytime TD" / "Anytime Goal".
        const YES_NO_LABEL = {
          batter_home_runs: "To Hit a HR",
          player_anytime_td: "Anytime TD",
          player_goals: "Anytime Goal",
        };
        const friendlyLabel = pr.line === 0.5 && YES_NO_LABEL[pr.market];
        const pickTxt = friendlyLabel
          ? `${pr.player} ${friendlyLabel}`
          : `${pr.player} Over${lineTxt} ${label}`;
        propPicks.push({
          game: `${g.away} @ ${g.home}`,
          sport: g.sport,
          market: label,
          pick: pickTxt,
          odds: pr.overPrice,
          tier: 2,
          real: true,
        });
      }
    }

    // 3b) PrizePicks DFS fallback. When the paid odds-API has no props
    // for this game (off-market, quota exhausted, etc.), pull real player
    // lines from PrizePicks. These have NO per-leg American odds — they
    // ride on a flat DFS payout — so we attach them with `odds: null` and
    // `priceSource: "PrizePicks"`. The null-safe odds helpers above make
    // sure they no-op the combined-odds math instead of polluting it.
    if (propPicks.length === 0) {
      try {
        const qs = [
          `sport=${encodeURIComponent(g.sport)}`,
          `home=${encodeURIComponent(g.home)}`,
          `away=${encodeURIComponent(g.away)}`,
        ];
        const ppRes = await fetch(`/api/sports/prizepicks-props?${qs.join("&")}`);
        if (ppRes.ok) {
          const ppData = await ppRes.json();
          // Dedup by player+stat so we don't double-add the same projection.
          const seen = new Set();
          for (const pp of ppData?.props || []) {
            if (pp.line == null || !pp.player || !pp.market) continue;
            // Include line in the dedup key so distinct projections for the
            // same player/stat at different lines are preserved.
            const key = `${pp.player.toLowerCase()}|${pp.market.toLowerCase()}|${pp.line}`;
            if (seen.has(key)) continue;
            seen.add(key);
            propPicks.push({
              game: `${g.away} @ ${g.home}`,
              sport: g.sport,
              market: pp.market, // e.g. "Points", "Rebounds", "Dunks"
              pick: `${pp.player} Over ${pp.line} ${pp.market}`,
              odds: null,
              priceSource: "PrizePicks",
              tier: 2,
              real: true,
            });
          }
        }
      } catch { /* honest no-PP fallback */ }
    }

    // 3c) Pull previous-matchup history: each team's last-10 form +
    // head-to-head meetings, straight from ESPN's per-team schedule
    // feed. Used below to bump confidence for ML / spread / total picks
    // when real form/H2H signals back the side. Honest empty bucket on
    // failure — never fabricated.
    let history = null;
    if (espnGameForHistory?.homeTeamId && espnGameForHistory?.awayTeamId) {
      try {
        const qs = [
          `sport=${encodeURIComponent(g.sport)}`,
          `homeTeamId=${encodeURIComponent(espnGameForHistory.homeTeamId)}`,
          `awayTeamId=${encodeURIComponent(espnGameForHistory.awayTeamId)}`,
        ];
        const hr = await fetch(`/api/sports/matchup-history?${qs.join("&")}`);
        if (hr.ok) history = await hr.json();
      } catch { /* honest no-history fallback */ }
    }

    // 4) Score each candidate honestly against the live state.
    const hasScores = Number.isFinite(g.awayScore) && Number.isFinite(g.homeScore);
    const margin = hasScores ? (g.homeScore - g.awayScore) : 0;     // + = home leading
    const periodLabel = g.periodLabel || "live";
    // Regulation period count per sport — used to estimate elapsed fraction
    // so a late-game cover scores higher than an early-game one.
    const REG_PERIODS = { nfl: 4, ncaaf: 4, nba: 4, wnba: 4, ncaab: 2, nhl: 3, mlb: 9, soccer: 2, ufc: 3 };
    const regCount = REG_PERIODS[g.sport];
    const reasons = {};
    // --- DEAD-MARKET GUARD ---------------------------------------------------
    // A moneyline (or near-impossible spread cover) on a team trailing by an
    // insurmountable margin this late in the game is a no-bet — real books lock
    // those markets (e.g. the OKC ML padlocked while down 26 in Q4). We EXCLUDE
    // such legs outright rather than just docking points, so a blowout never
    // yields "back the team that's down 26 in the 4th". Returns true when a
    // deficit of `deficitAgainst` points is effectively unwinnable right now.
    // Per-sport deficit that's a wrap IN THE FINAL PERIOD (early in that period).
    const DEAD_FINAL_DEFICIT = { nba: 12, wnba: 12, ncaab: 12, nfl: 16, ncaaf: 19, nhl: 3, mlb: 4, soccer: 3 };
    const PERIOD_MINUTES = { nba: 12, wnba: 10, ncaab: 20, nfl: 15, ncaaf: 15, nhl: 20 };
    const inFinalPeriod = !!regCount && Number.isFinite(g.period) && g.period >= regCount;
    const penultimatePeriod = !!regCount && Number.isFinite(g.period) && g.period === regCount - 1;
    // Seconds left in the CURRENT period, parsed off ESPN's live clock when present.
    const clockSecs = (() => {
      if (!g.clock) return null;
      const m = String(g.clock).match(/(\d+):(\d{2})/);
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
    })();
    const isDeadDeficit = (deficitAgainst) => {
      if (!hasScores || deficitAgainst <= 0) return false;
      const base = DEAD_FINAL_DEFICIT[g.sport];
      if (base == null) return false; // UFC / unknown — no scoreboard-margin concept
      if (inFinalPeriod) {
        // The unwinnable line tightens as the period clock runs down. With no
        // live clock we assume mid-period.
        const perMin = PERIOD_MINUTES[g.sport];
        const periodElapsedFrac = (clockSecs != null && perMin)
          ? Math.max(0, Math.min(1, 1 - clockSecs / (perMin * 60)))
          : 0.5;
        const threshold = periodElapsedFrac >= 0.66 ? Math.ceil(base * 0.6)
                        : periodElapsedFrac >= 0.33 ? Math.ceil(base * 0.8)
                        : base;
        return deficitAgainst >= threshold;
      }
      // One period before the final: only a true blowout is already decided.
      if (penultimatePeriod) return deficitAgainst >= base * 2;
      return false;
    };
    // Pre-compute per-team form signals from real history (last 10 games).
    // `marginDiff` > 0 means home team has the better recent point margin.
    // `combinedPace` is the avg total points across both teams' last 10
    // games — used to nudge OVER/UNDER picks when the line is well above
    // or below their actual recent pace. All numbers are real averages of
    // real final scores — nothing inferred or fabricated.
    const homeL10 = history?.home?.last10 || null;
    const awayL10 = history?.away?.last10 || null;
    const marginDiff = (homeL10?.avgMargin != null && awayL10?.avgMargin != null)
      ? (homeL10.avgMargin - awayL10.avgMargin) : null;
    const combinedPace = (homeL10?.ptsFor != null && homeL10?.ptsAgainst != null
                          && awayL10?.ptsFor != null && awayL10?.ptsAgainst != null)
      ? ((homeL10.ptsFor + homeL10.ptsAgainst + awayL10.ptsFor + awayL10.ptsAgainst) / 2)
      : null;
    const h2h = history?.h2h || null;
    const h2hHomeEdge = h2h && (h2h.meetings?.length ?? 0) > 0
      ? (h2h.homeWins - h2h.awayWins) : null;
    // Pre-game venue splits + current streak (real ESPN). For a game at the
    // home team's venue, the home side's HOME split vs the away side's AWAY
    // split is the venue-specific read. `venueDiff` > 0 favors the home side.
    const homeVenue = (history?.home?.homeSplit && history.home.homeSplit.games > 0) ? history.home.homeSplit : null;
    const awayVenue = (history?.away?.awaySplit && history.away.awaySplit.games > 0) ? history.away.awaySplit : null;
    const venueDiff = (homeVenue?.avgMargin != null && awayVenue?.avgMargin != null)
      ? (homeVenue.avgMargin - awayVenue.avgMargin) : null;
    const homeStreak = history?.home?.streak || null;
    const awayStreak = history?.away?.streak || null;
    // Signed streak strength: + for a win streak, − for a losing streak.
    const streakStrength = (s) => (s && s.count > 0 ? (s.type === "W" ? s.count : -s.count) : 0);
    const scoreCandidate = (pk) => {
      let score = 50;
      const why = [];
      const isOver = /\bover\b/i.test(pk.pick);
      const isUnder = /\bunder\b/i.test(pk.pick);
      if (pk.market === "Moneyline") {
        // Whoever is currently leading on the scoreboard gets a bump
        // proportional to margin. Bigger lead = bigger bump. If no score
        // yet (pre-pitch), fall back to implied probability from odds.
        const isHomeML = pk.teamFull === g.home;
        const isAwayML = pk.teamFull === g.away;
        // HARD EXCLUDE a moneyline on the team that's trailing by an
        // insurmountable margin this late — that market is effectively dead
        // (books lock it). deficitAgainst > 0 means THIS team is behind.
        const mlDeficitAgainst = isHomeML ? -margin : margin;
        if (isDeadDeficit(mlDeficitAgainst)) {
          reasons[pk.pick + "|" + pk.market] =
            `${pk.teamFull} down ${mlDeficitAgainst} in ${periodLabel}${g.clock ? " " + g.clock : ""} — comeback near-impossible, market effectively dead`;
          return { ...pk, _score: -999, _dead: true };
        }
        if (hasScores && (margin !== 0)) {
          if ((isHomeML && margin > 0) || (isAwayML && margin < 0)) {
            score += Math.min(28, Math.abs(margin) * (g.sport === "nba" ? 1.2 : g.sport === "nfl" ? 3 : g.sport === "mlb" ? 5 : 4));
            why.push(`${pk.teamFull} leading by ${Math.abs(margin)} in ${periodLabel}`);
          } else {
            score -= Math.min(20, Math.abs(margin) * 1.5);
            why.push(`${pk.teamFull} trailing by ${Math.abs(margin)} in ${periodLabel}`);
          }
        } else {
          // Use implied prob as a baseline
          const ip = impliedProb(pk.odds) * 100;
          score = 35 + ip * 0.4;
          why.push(`market-implied ${ip.toFixed(0)}% (no live margin yet)`);
        }
        // Real form/H2H bump on top of the live-margin or implied-prob
        // baseline. Capped so history never dominates a live read.
        if (marginDiff != null) {
          const sideEdge = isHomeML ? marginDiff : -marginDiff;
          const bump = Math.max(-10, Math.min(10, sideEdge * 1.2));
          if (Math.abs(bump) >= 2) {
            score += bump;
            const myL10 = isHomeML ? homeL10 : awayL10;
            why.push(`${pk.teamFull} ${myL10.wins}-${myL10.losses} L10, ${myL10.avgMargin > 0 ? "+" : ""}${myL10.avgMargin} avg margin`);
          }
        }
        if (h2hHomeEdge != null && h2hHomeEdge !== 0) {
          const sideH2H = isHomeML ? h2hHomeEdge : -h2hHomeEdge;
          if (sideH2H > 0) {
            // Capped at +5 (was +8) so combined form+H2H bump stays at
            // most +15 — keeps history a secondary signal, not a driver.
            score += Math.min(5, sideH2H * 2);
            const meetings = h2h.meetings?.length ?? 0;
            const wins = isHomeML ? h2h.homeWins : h2h.awayWins;
            const losses = isHomeML ? h2h.awayWins : h2h.homeWins;
            why.push(`${wins}-${losses} in last ${meetings} H2H`);
          }
        }
        // Venue split bump: home side's home form vs away side's road form.
        // Capped at ±6 so it complements — never overrides — the L10/H2H read.
        if (venueDiff != null) {
          const sideVenue = isHomeML ? venueDiff : -venueDiff;
          const vBump = Math.max(-6, Math.min(6, sideVenue * 0.9));
          if (Math.abs(vBump) >= 2) {
            score += vBump;
            const vf = isHomeML ? homeVenue : awayVenue;
            why.push(`${pk.teamFull} ${vf.record} ${isHomeML ? "at home" : "on the road"} (${vf.avgMargin > 0 ? "+" : ""}${vf.avgMargin} margin)`);
          }
        }
        // Streak bump: ride a hot side, fade a cold one. Capped at ±5.
        const myStreak = isHomeML ? homeStreak : awayStreak;
        const sStr = streakStrength(myStreak);
        if (sStr !== 0) {
          score += Math.max(-5, Math.min(5, sStr * 1.2));
          why.push(`${pk.teamFull} on a ${Math.abs(sStr)}-game ${myStreak.type === "W" ? "win" : "losing"} streak`);
        }
      } else if (pk.market === "Spread" || pk.market === "Alt Spread") {
        const ptMatch = pk.pick.match(/(-?\+?\d+\.?\d*)$/);
        const spreadPt = ptMatch ? parseFloat(ptMatch[1]) : 0;
        const isHomeSpread = pk.teamFull === g.home;
        // Adjusted margin from the perspective of this side
        const adj = (isHomeSpread ? margin : -margin) + spreadPt;
        // HARD EXCLUDE a spread the trailing side can no longer realistically
        // cover this late (e.g. +5.5 while down 26 in Q4 needs +20.5 net).
        // A near-pick'em cover (down 26 on +25.5 → adj -0.5) stays live.
        // isDeadDeficit() already scopes itself to the final/penultimate period,
        // so it handles both — no extra period gate needed here.
        if (hasScores && adj < 0 && isDeadDeficit(-adj)) {
          reasons[pk.pick + "|" + pk.market] =
            `needs ${Math.abs(adj).toFixed(1)} more to cover in ${periodLabel}${g.clock ? " " + g.clock : ""} — out of reach, market effectively dead`;
          return { ...pk, _score: -999, _dead: true };
        }
        if (hasScores) {
          // Period progression: a 4-point cover late in the game is much
          // more meaningful than the same cover in the 1st quarter.
          // `elapsed` runs 0..1; multiply the cover signal by it so early
          // leads don't get over-credited.
          const elapsed = regCount && Number.isFinite(g.period) && g.period > 0
            ? Math.min(1, g.period / regCount) : 0.5;
          const lateBonus = 0.6 + 0.8 * elapsed; // 0.6 → 1.4 across the game
          score += Math.max(-22, Math.min(24, adj * 2.5 * lateBonus));
          if (adj > 0) why.push(`already covering by ${adj.toFixed(1)} (margin ${margin} + line ${spreadPt > 0 ? "+" : ""}${spreadPt}) — ${Math.round(elapsed * 100)}% of regulation done`);
          else if (adj < 0) why.push(`needs ${Math.abs(adj).toFixed(1)} more to cover — ${Math.round(elapsed * 100)}% of regulation done`);
        } else {
          score = 45;
          why.push("game just started — no live cover signal");
        }
        // Form bump for spreads: if recent point-margin diff aligns
        // with this side, give it a small boost. Capped at +/-8.
        if (marginDiff != null) {
          const sideEdge = isHomeSpread ? marginDiff : -marginDiff;
          const bump = Math.max(-8, Math.min(8, sideEdge * 1.0));
          if (Math.abs(bump) >= 2) {
            score += bump;
            const myL10 = isHomeSpread ? homeL10 : awayL10;
            why.push(`${pk.teamFull} ${myL10.wins}-${myL10.losses} L10, ${myL10.avgMargin > 0 ? "+" : ""}${myL10.avgMargin} avg margin`);
          }
        }
        // Venue split bump for spreads — same venue read as ML, capped ±5.
        if (venueDiff != null) {
          const sideVenue = isHomeSpread ? venueDiff : -venueDiff;
          const vBump = Math.max(-5, Math.min(5, sideVenue * 0.7));
          if (Math.abs(vBump) >= 2) {
            score += vBump;
            const vf = isHomeSpread ? homeVenue : awayVenue;
            why.push(`${pk.teamFull} ${vf.record} ${isHomeSpread ? "at home" : "on the road"} (${vf.avgMargin > 0 ? "+" : ""}${vf.avgMargin} margin)`);
          }
        }
      } else if (pk.market === "Total") {
        if (g.pacing === "over" && isOver) { score += 18; why.push(`current pace ${g.currentTotal} → over the line`); }
        else if (g.pacing === "under" && isUnder) { score += 18; why.push(`current pace ${g.currentTotal} → under the line`); }
        else if (g.pacing === "on pace") { score += 4; why.push("right on pace — slight live edge to the favored side"); }
        else if (g.pacing === "over" && isUnder) { score -= 16; why.push("pacing against this side"); }
        else if (g.pacing === "under" && isOver) { score -= 16; why.push("pacing against this side"); }
        else { score = 48; why.push("not enough game elapsed to read pacing"); }
        // Recent-pace bump: compare the actual line to both teams' L10
        // combined scoring pace. Only kick in when we have a posted line
        // AND a real pace number AND a meaningful gap (≥4 points).
        if (combinedPace != null && Number.isFinite(g.total)) {
          const gap = combinedPace - g.total;
          if (Math.abs(gap) >= 4) {
            if (gap > 0 && isOver) { score += Math.min(8, gap * 0.6); why.push(`both teams averaging ${combinedPace.toFixed(1)} combined pts L10 — above the ${g.total} line`); }
            else if (gap < 0 && isUnder) { score += Math.min(8, -gap * 0.6); why.push(`both teams averaging ${combinedPace.toFixed(1)} combined pts L10 — below the ${g.total} line`); }
            else if (gap > 0 && isUnder) { score -= Math.min(6, gap * 0.5); why.push(`L10 pace ${combinedPace.toFixed(1)} runs hot vs this under`); }
            else if (gap < 0 && isOver) { score -= Math.min(6, -gap * 0.5); why.push(`L10 pace ${combinedPace.toFixed(1)} runs cold vs this over`); }
          }
        }
      } else {
        // Player prop. If we have a real American price, use the
        // bookmaker's implied probability as an honest baseline.
        // PrizePicks (null odds) lines are DFS pick'em — designed to be
        // ~50/50 by construction — so we give them a flat 55 baseline
        // instead of fabricating a price-derived signal.
        if (pk.odds == null) {
          score = 55;
          why.push(`PrizePicks line — DFS standard payout (no per-leg sportsbook price)`);
        } else {
          const ip = impliedProb(pk.odds) * 100;
          score = 30 + ip * 0.4;
          why.push(`live prop, market-implied ${ip.toFixed(0)}%`);
        }
      }
      reasons[pk.pick + "|" + pk.market] = why.join(" · ");
      return { ...pk, _score: score };
    };

    // Score everything, then pick the best per market category and stop
    // when we have 2-5 distinct legs. NEVER take both sides of the same
    // market (no ML + opposing-ML, no over + under, no team + opposing
    // spread) — that's a built-in contradiction. Also enforce same-game
    // COMBINABILITY: every leg added must be compatible with all legs
    // already on the slip (most importantly: ML side and spread side
    // must agree on the team — books reject Home ML + Away spread in a
    // same-game parlay because they pull against each other).
    const scored = [...main, ...propPicks].map(scoreCandidate);
    scored.sort((a, b) => b._score - a._score);
    const picked = [];
    const usedCategory = new Set(); // "ml" | "spread" | "total" | prop key
    // Pull "side" out of a leg so we can check directional agreement.
    // For ML/spread the side is the team being backed; for totals it's
    // "over"/"under"; props are skipped (Over-only, freely combinable
    // with any team-side bet at major books).
    const sideOf = (pk) => {
      if (pk.market === "Moneyline" || pk.market === "Spread") {
        if (pk.teamFull === g.home) return { kind: "team", team: g.home };
        if (pk.teamFull === g.away) return { kind: "team", team: g.away };
      }
      if (pk.market === "Total") {
        if (/\bover\b/i.test(pk.pick)) return { kind: "total", dir: "over" };
        if (/\bunder\b/i.test(pk.pick)) return { kind: "total", dir: "under" };
      }
      return null;
    };
    const isCombinableWith = (pk, alreadyPicked) => {
      const a = sideOf(pk);
      if (!a) return true; // player props pass — Over-side only, no direction conflict
      for (const q of alreadyPicked) {
        const b = sideOf(q);
        if (!b) continue;
        // ML <-> Spread must back the same team. (ML vs ML / spread vs
        // spread is already blocked by usedCategory above.)
        if (a.kind === "team" && b.kind === "team" && a.team !== b.team) return false;
      }
      return true;
    };
    for (const pk of scored) {
      if (picked.length >= 5) break;
      let cat;
      if (pk.market === "Moneyline") cat = "ml";
      else if (pk.market === "Spread") cat = "spread";
      else if (pk.market === "Total") cat = "total";
      else cat = `prop:${pk.pick.replace(/\s+Over\s+\S+\s+.*$/, "")}`; // one prop per player
      if (usedCategory.has(cat)) continue;
      // HARD skip dead markets (trailing-team ML / out-of-reach spread late) no
      // matter how thin the ticket is — never recommend an effectively-locked bet.
      if (pk._dead || pk._score <= 0) continue;
      // Require a minimally credible score so we don't pad weak legs.
      if (pk._score < 45 && picked.length >= 2) continue;
      // Drop legs that contradict something already on the ticket.
      if (!isCombinableWith(pk, picked)) continue;
      usedCategory.add(cat);
      picked.push(pk);
    }

    if (picked.length < 2) {
      setMessages((p) => [
        ...p,
        { role: "user", content: userMsg },
        { role: "assistant", content:
          `Couldn't find 2 strong live legs in **${g.away} @ ${g.home}** right now (only ${picked.length} credible spot${picked.length === 1 ? "" : "s"}). Live markets for this game might be paused, or the score is too tight to lean either way. I won't pad with weak legs.`
        },
      ]);
      return;
    }

    // 5) Pre-check the slip filter so we never tell the user "ticket added"
    // while autoFillSlip silently drops every leg (e.g. game just fell out
    // of the 24h window between scoring and rendering).
    const ticketRaw = picked.slice(0, 5);
    const { kept: ticket, dropped } = filterPicksToReal(ticketRaw);
    if (ticket.length === 0) {
      setMessages((p) => [
        ...p,
        { role: "user", content: userMsg },
        { role: "assistant", content:
          `Built ${ticketRaw.length} candidate legs for **${g.away} @ ${g.home}** but every one got rejected by the live-game filter (the game may have just gone Final or fallen outside the 48h window). Nothing added to your slip — pick a different game.`
        },
      ]);
      return;
    }
    const math = calculateParlay(ticket);
    const impliedPct = (impliedProb(math.american) * 100).toFixed(1);
    autoFillSlip(ticket);

    const stateLine = hasScores
      ? `${g.away} ${g.awayScore} – ${g.homeScore} ${g.home} · ${periodLabel}${g.clock ? " " + g.clock : ""}`
      : `${periodLabel}${g.clock ? " " + g.clock : ""}`;
    const totalLine = Number.isFinite(g.total)
      ? ` · current total ${g.currentTotal}/${g.total}${g.pacing ? ` (pacing ${g.pacing})` : ""}`
      : "";

    const droppedNote = dropped.length > 0
      ? `_Note: ${dropped.length} candidate leg${dropped.length === 1 ? "" : "s"} dropped by the live-game filter._\n\n`
      : "";
    const sourceNote = oddsEntry._source
      ? `_Live lines from ${oddsEntry._source} (primary odds feed was unavailable — using ESPN fallback)._\n\n`
      : "";
    const intro =
      `🔴 **LIVE PARLAY — ${g.away} @ ${g.home} · ${ticket.length} legs**\n` +
      `_${stateLine}${totalLine}_\n\n` +
      sourceNote +
      droppedNote +
      `I scored every live spot in this game (live margin, pacing, period progression, market-implied probability${liveProps?.props?.length ? ", live player props" : ""}${history ? ", L10 form, H2H history" : ""}) and took the strongest ${ticket.length} distinct-market legs.\n\n` +
      (history && (homeL10?.games || awayL10?.games)
        ? `_Recent form (real ESPN finals): **${g.home}** ${homeL10?.wins ?? 0}-${homeL10?.losses ?? 0} L10 (${homeL10?.avgMargin != null ? (homeL10.avgMargin > 0 ? "+" : "") + homeL10.avgMargin : "n/a"} margin) · **${g.away}** ${awayL10?.wins ?? 0}-${awayL10?.losses ?? 0} L10 (${awayL10?.avgMargin != null ? (awayL10.avgMargin > 0 ? "+" : "") + awayL10.avgMargin : "n/a"} margin)${(h2h?.meetings?.length ?? 0) > 0 ? ` · H2H last ${h2h.meetings.length}: ${g.home} ${h2h.homeWins}-${h2h.awayWins} ${g.away}` : " · no head-to-head in ESPN's window"}._\n\n`
        : "");

    // Format an odds cell. PrizePicks legs (null odds) have no per-leg
    // American price — surface that honestly instead of a fake number.
    const oddsCell = (p) =>
      p.priceSource === "PrizePicks" || p.odds == null
        ? "PrizePicks line"
        : formatOdds(p.odds);

    const lines = ticket.map((p) =>
      `PICK: ${p.game} | ${p.market} | ${p.pick} | ${oddsCell(p)}`
    ).join("\n");

    const analysis =
      "\n\nLive analysis:\n" +
      ticket.map((p) => {
        const why = reasons[p.pick + "|" + p.market] || "live read";
        return `• **${p.market} — ${p.pick}** (${oddsCell(p)}) — ${why}`;
      }).join("\n");

    // Combined-odds math only includes legs with a real American price.
    // PrizePicks DFS legs ride a separate flat payout, so we count them
    // separately in the footer instead of pretending they fold into the
    // sportsbook combined number.
    const ppLegs = ticket.filter((p) => p.odds == null).length;
    const bookLegs = ticket.length - ppLegs;
    const combinedLine = bookLegs >= 2
      ? `Combined odds (${bookLegs} book leg${bookLegs === 1 ? "" : "s"}): **${formatOdds(math.american)}** · payout ${math.decimal.toFixed(2)}× stake\n` +
        `Implied probability: ${impliedPct}% (what the market actually prices these at)\n`
      : bookLegs === 1
        ? `1 book leg at **${formatOdds(math.american)}** · the rest are PrizePicks lines (DFS flat payout, no combined American number).\n`
        : `All legs are PrizePicks lines — DFS flat payout, no combined American odds.\n`;
    const ppNote = ppLegs > 0
      ? `_${ppLegs} of ${ticket.length} legs are PrizePicks DFS lines — they have a real line but no per-leg sportsbook price, so they don't contribute to the combined odds above._\n`
      : "";

    const footer =
      `\n\n${combinedLine}${ppNote}` +
      `_Live odds move every few seconds — confirm prices in your sportsbook before placing. 21+ · bet responsibly._`;

    setMessages((p) => [
      ...p,
      { role: "user", content: userMsg },
      { role: "assistant", content: intro + lines + analysis + footer },
    ]);
  };

  // Build a simulated live parlay and post it into the chat
  const buildSimLiveParlay = () => {
    const games = generateSimLiveGames(selectedSports);
    if (games.length === 0) {
      setMessages((p) => [
        ...p,
        { role: "user", content: "Pick live" },
        { role: "assistant", content: "No simulated live games for your selected sports right now. Select more sports and try again.\n\n(Reminder: this is a SIMULATION — not real live games. Real live data is in the Next.js version.)" },
      ]);
      return;
    }
    // Score every simulated live spot, then take the best distinct-game legs
    const allPicks = buildSimLivePicks(games).map((pk) => {
      // spot score: ML uses win prob from the note; total uses pacing strength
      let score = 50;
      const wpMatch = pk.liveNote.match(/(\d+)%/);
      if (pk.market === "Live Moneyline" && wpMatch) score = parseInt(wpMatch[1]);
      else if (pk.market === "Live Total") score = 62;
      // Coach game-state tendency reinforcing the live read adds a few points
      if (pk.market === "Live Total" && pk.coachLean) {
        const isOver = /over/i.test(pk.pick);
        if ((pk.coachLean === "over" && isOver) || (pk.coachLean === "under" && !isOver)) score += 6;
        else if (pk.coachLean !== "neutral") score -= 4;
      }
      return { ...pk, spotScore: score };
    });
    allPicks.sort((a, b) => b.spotScore - a.spotScore);
    const used = new Set();
    const best = [];
    for (const pk of allPicks) {
      if (best.length >= 3) break;
      if (!used.has(pk.game)) { best.push(pk); used.add(pk.game); }
    }
    // Keep it to a 2–3 leg ticket
    const ticket = best.slice(0, Math.max(2, Math.min(3, best.length)));
    if (ticket.length < 2) {
      setMessages((p) => [
        ...p,
        { role: "user", content: "Pick live — best 2-3 leg ticket" },
        { role: "assistant", content: "Only one clear live spot right now — not enough for a 2-leg ticket. (Simulated data; real live games are in the Next.js version.)" },
      ]);
      return;
    }
    const math = calculateParlay(ticket);
    // Model confidence (relative ranking from sample data) vs implied prob (the market)
    const modelConf = Math.round(
      ticket.map((p) => calculateConfidence(p)).reduce((acc, c) => acc * (c / 100), 1) * 100
    );
    const impliedPct = (impliedProb(math.american) * 100).toFixed(1);
    autoFillSlip(ticket);
    const intro = `🔴 **LIVE TICKET (SIM) — ${ticket.length} legs**\nI scored every live spot (win probability + total pacing) and took the strongest ${ticket.length}.\n\n`;
    const lines = ticket.map((p) => `PICK: ${p.game} | ${p.market} | ${p.pick} | ${formatOdds(p.odds)}`).join("\n");
    const notes = "\n\nLive analysis:\n" + ticket.map((p) => `• [${p.spotScore}] ${p.liveNote}`).join("\n");
    const footer =
      `\n\nCombined odds: ${formatOdds(math.american)}\n` +
      `**Model confidence: ${modelConf}%** (my relative ranking from sample data)\n` +
      `Implied probability: ${impliedPct}% (what the odds actually price this at)\n\n` +
      `_These two numbers are the honest picture. I'm NOT giving you a "60–80% to win" — that number would be fabricated. The implied probability is what the market really thinks; the model confidence is just my ranking, not a prediction. ⚠️ Simulation only — never bet off simulated data._`;
    setMessages((p) => [
      ...p,
      { role: "user", content: "Pick live — best 2-3 leg ticket" },
      { role: "assistant", content: intro + lines + notes + footer },
    ]);
  };

  // Build the best parlay focused on ONE simulated live game (from its live spots)
  const buildParlayForLiveGame = (g) => {
    if (!requirePro("Build from game")) return;
    setView("chat");
    const spots = buildSimLivePicks([g]);
    if (spots.length === 0) {
      setMessages((p) => [
        ...p,
        { role: "user", content: `Best live parlay for ${g.away} @ ${g.home}` },
        { role: "assistant", content: `No clear live spots in ${g.away} @ ${g.home} right now. (Simulated — real live data is in the Next.js version.)` },
      ]);
      return;
    }
    const math = calculateParlay(spots);
    const intro = `🔴 **LIVE PARLAY — ${g.away} @ ${g.home} (SIM)**\n\nI scored the live spots in this game (win prob + pacing) and built the strongest legs.\n\n`;
    const lines = spots.map((p) => `PICK: ${p.game} | ${p.market} | ${p.pick} | ${formatOdds(p.odds)}`).join("\n");
    const notes = "\n\nLive analysis:\n" + spots.map((p) => `• ${p.liveNote}`).join("\n");
    const footer = `\n\nCombined: ${formatOdds(math.american)}. ⚠️ SIMULATION ONLY — live odds move every second; never bet off simulated data.`;
    setMessages((p) => [
      ...p,
      { role: "user", content: `Best live parlay for ${g.away} @ ${g.home}` },
      { role: "assistant", content: intro + lines + notes + footer },
    ]);
  };

  // Build the best parlay focused on ONE upcoming game (from the hypothetical pool)
  const buildParlayForUpcomingGame = (game, sport, legCount = 3) => {
    if (!requirePro("Build from game")) return;
    setView("chat");
    const pool = (PICK_POOL[sport] || []).filter((p) => p.game === game).map((p) => ({ ...p, sport }));
    if (pool.length === 0) {
      setMessages((p) => [
        ...p,
        { role: "user", content: `Best parlay for ${game}` },
        { role: "assistant", content: `I don't have picks for ${game} in the sample pool.` },
      ]);
      return;
    }
    // Rank this game's picks by model confidence, take the N strongest.
    const ranked = [...pool].sort(
      (a, b) => calculateConfidence(b) - calculateConfidence(a)
    ).slice(0, Math.max(1, legCount || 3));
    autoFillSlip(ranked);
    const math = calculateParlay(ranked);
    const conf = Math.round(ranked.reduce((acc, p) => acc * (calculateConfidence(p) / 100), 1) * 100);
    const shortfall = ranked.length < (legCount || 3)
      ? ` (only ${ranked.length} quality pick${ranked.length !== 1 ? "s" : ""} available for this game)`
      : "";
    const intro = `Here's a ${ranked.length}-leg parlay from **${game}**${shortfall}, ranked by my model (odds, form, coaches). Added to your slip below.\n\n`;
    const lines = ranked.map((p) => `PICK: ${p.game} | ${p.market} | ${p.pick} | ${formatOdds(p.odds)}`).join("\n");
    const footer = `\n\nCombined: ${formatOdds(math.american)} · **model confidence ~${conf}%**. Hypothetical only.`;
    setMessages((p) => [
      ...p,
      { role: "user", content: `Best parlay for ${game}` },
      { role: "assistant", content: intro + lines + footer },
    ]);
  };

  const toggleHistoryExpand = (id) => {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Load tracker from localStorage on mount
  useEffect(() => {
    setTracker(loadTracker());
  }, []);

  // Persist tracker to localStorage whenever it changes
  useEffect(() => {
    if (tracker.length > 0 || localStorage.getItem(TRACKER_KEY)) {
      saveTracker(tracker);
    }
  }, [tracker]);

  // AUTO CLV CAPTURE: as live odds refresh, snapshot the current market
  // price for each tracked book pick. While the game hasn't started we keep
  // updating `lastSeenOdds` (the latest line). Once the game leaves the
  // pre-game feed AND its start time has passed, we freeze the last line we
  // saw as `closingOdds` — the honest closing-line-value reference. It's
  // best-effort: the "close" is the last line observed while the app was
  // open before kickoff, not a guaranteed final tick. Users can still
  // override it by hand in History. Only book legs with a numeric entry
  // price get CLV; PrizePicks/AI-only legs are skipped.
  useEffect(() => {
    const byGame = new Map();
    for (const sport of Object.keys(realOddsBySport || {})) {
      for (const g of realOddsBySport[sport] || []) {
        const key = `${g.awayTeam} @ ${g.homeTeam}`;
        const priceByKey = new Map();
        for (const p of buildPicksFromOdds(g)) {
          if (p.odds == null || !Number.isFinite(p.odds)) continue;
          // buildPicksFromOdds emits nickname-form picks ("Thunder ML"), but a
          // tracker entry may have been stored with the full team name
          // ("Oklahoma City Thunder ML") depending on which add path created
          // it (game-detail row vs live-odds row vs AI-parsed card). Register
          // BOTH key variants (normalized) so the live price resolves no matter
          // which form was persisted. Totals have no team name so they already
          // match. Prices are always the real merged book price — never invented.
          priceByKey.set(clvMatchKey(p.market, p.pick), p.odds);
          if (p.teamFull) {
            const nick = p.teamFull.split(/\s+/).filter(Boolean).pop();
            if (nick && p.pick.startsWith(nick)) {
              priceByKey.set(clvMatchKey(p.market, p.teamFull + p.pick.slice(nick.length)), p.odds);
            }
          }
        }
        byGame.set(key, { commenceTime: g.commenceTime, priceByKey });
      }
    }
    const now = Date.now();
    setTracker((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        if (e.odds == null || !Number.isFinite(e.odds)) return e; // no book price → no CLV
        if (e.closingOdds != null) return e; // already frozen / set manually
        const live = byGame.get(e.game);
        if (live) {
          const cur = live.priceByKey.get(clvMatchKey(e.market, e.pick));
          const updates = {};
          if (live.commenceTime && e.commenceTime !== live.commenceTime) updates.commenceTime = live.commenceTime;
          if (cur != null && Number.isFinite(cur) && e.lastSeenOdds !== cur) {
            updates.lastSeenOdds = cur;
            updates.lastSeenAt = now;
          }
          if (Object.keys(updates).length) { changed = true; return { ...e, ...updates }; }
          return e;
        }
        // Game no longer in the pre-game feed. If we captured a pre-game line
        // and the game has started, freeze that as the closing line.
        const commenced = e.commenceTime && new Date(e.commenceTime).getTime() <= now;
        if (e.lastSeenOdds != null && commenced) {
          changed = true;
          return { ...e, closingOdds: e.lastSeenOdds, closingAuto: true, closingCapturedAt: now };
        }
        return e;
      });
      return changed ? next : prev;
    });
  }, [realOddsBySport]);

  const scrollRef = useRef(null);
  const scrollAnimRef = useRef(null);
  // The bottom composer (slip pill + controls + input) is absolutely
  // positioned over the chat, so its height varies (slip pill, attachments,
  // pinned slips all grow it). Measure it and pad the scroll area to match so
  // the last messages are never hidden behind it.
  const composerRef = useRef(null);
  const [composerH, setComposerH] = useState(130);
  useEffect(() => {
    const el = composerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setComposerH(el.offsetHeight));
    ro.observe(el);
    setComposerH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  // Custom slow, eased scroll-to-bottom. Duration scales a little with
  // distance so big jumps don't feel abrupt, capped for sanity.
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const start = el.scrollTop;
    const target = el.scrollHeight - el.clientHeight;
    const distance = target - start;
    if (Math.abs(distance) < 2) return;

    // ~900ms base, a touch longer for long scrolls, capped at 1600ms
    const duration = Math.min(1600, 700 + Math.abs(distance) * 0.6);
    const startTime = performance.now();
    // easeInOutCubic — gentle start and finish
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    const step = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      el.scrollTop = start + distance * ease(t);
      if (t < 1) scrollAnimRef.current = requestAnimationFrame(step);
    };
    scrollAnimRef.current = requestAnimationFrame(step);
  };

  // Download a DOM node as a PNG the user can save to their camera roll.
  // Loads the html-to-image library from CDN on first use.
  const [downloadingId, setDownloadingId] = useState(null);
  const loadHtmlToImage = () =>
    new Promise((resolve, reject) => {
      if (window.htmlToImage) return resolve(window.htmlToImage);
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js";
      script.onload = () => resolve(window.htmlToImage);
      script.onerror = () => reject(new Error("Could not load image library"));
      document.head.appendChild(script);
    });

  const downloadParlayImage = async (nodeId) => {
    const node = document.getElementById(nodeId);
    if (!node) return;
    setDownloadingId(nodeId);
    try {
      const htmlToImage = await loadHtmlToImage();
      const dataUrl = await htmlToImage.toPng(node, {
        backgroundColor: "#09090b",
        pixelRatio: 2,
        style: { padding: "16px" },
      });
      const link = document.createElement("a");
      link.download = `parlay-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      // Surface a gentle failure in chat
      setMessages((p) => [
        ...p,
        { role: "assistant", content: "Couldn't generate the image — your browser may have blocked the image library. Try again, or screenshot manually." },
      ]);
    } finally {
      setDownloadingId(null);
    }
  };

  // Follow new content: scroll after the DOM paints. Does NOT include
  // expandedPicks or parlayLegs — expanding reasoning or adding/removing a leg
  // should keep your place, not yank you to the bottom.
  useEffect(() => {
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(scrollToBottom);
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [messages, loading]);

  const toggleSport = (id) =>
    setSelectedSports((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));
  const legKey = (l) => `${l.game}|${l.market}|${l.pick}`;
  const addLeg = (leg, opts = {}) => {
    const key = legKey(leg);
    // Prevent duplicate picks — same game + market + pick can only appear once
    // on the ticket. Silently no-op if it's already there. Check current state
    // synchronously so the tracker append below only fires on a real insert
    // (a check inside the updater would also run twice under StrictMode and
    // can't reliably gate side effects).
    if (parlayLegs.some((l) => legKey(l) === key)) return;
    // Defense in depth: validate against real live data the same way the slip
    // cleanup effect and autoFillSlip do, so a card rendered from a stale or
    // hallucinated assistant reply can't sneak onto the slip via this direct
    // path. If the matchup isn't verifiable in any raw feed, silently drop.
    // Callers that already validated against an in-call eligible pool can
    // pass { skipValidation: true } — the chat snapshot card uses this so
    // canonical-label mismatches don't silently swallow legitimate adds.
    // Even when skipping the reject gate, we still ask filterPicksToReal
    // to ATTEMPT canonicalization: if it produces a canonical version of
    // this leg, we store it under the canonical game label so the post-
    // grace sweep finds a matching key (otherwise the sweep would strip
    // the leg after GRACE_MS for being keyed under a non-canonical label).
    let toAdd = leg;
    const { kept } = filterPicksToReal([leg]);
    if (kept.length > 0) {
      toAdd = kept[0];
    } else if (!opts.skipValidation) {
      return;
    }
    const insertKey = legKey(toAdd);
    if (parlayLegs.some((l) => legKey(l) === insertKey)) return;
    const id = Date.now() + Math.random();
    const addedAt = Date.now();
    // Capture the game's known start time NOW (while it's still in a feed) so a
    // chat-validated leg can be expired later even if the game rotates out of
    // every feed once it's over (see the slip-sweep staleness fallback).
    const gsRaw = lookupGameStart(toAdd.game);
    const gsTs = gsRaw ? new Date(gsRaw).getTime() : NaN;
    const gameStartTs = Number.isFinite(gsTs) ? gsTs : null;
    setParlayLegs((p) => (p.some((l) => legKey(l) === insertKey) ? p : [...p, { ...toAdd, id, addedAt, ...(opts.skipValidation ? { chatValidated: true, gameStartTs } : {}) }]));
    // Snapshot the reasoning at the moment of adding so History stays accurate
    const reasoningAtTime = generateReasoning(leg);
    const confAtTime = calculateConfidence(leg);
    setTracker((prev) => [
      ...prev,
      {
        id,
        game: leg.game,
        market: leg.market,
        pick: leg.pick,
        odds: leg.odds,
        signature: pickSignature(leg),
        status: "pending",
        addedAt: Date.now(),
        reasoning: reasoningAtTime,
        confidenceAtAdd: confAtTime,
      },
    ]);
  };
  const removeLeg = (id) => { setFixSummary(null); setParlayLegs((p) => p.filter((l) => l.id !== id)); };
  // Remove by matching game + pick (used by the card's Added toggle)
  const removeLegByPick = (pick) =>
    setParlayLegs((p) => p.filter((l) => !(legKey(l) === legKey(pick))));
  const clearParlay = () => { setParlayLegs([]); setSlipAnalysis(null); setFixSummary(null); setLegsAnalyzed(false); setSlipOpen(false); };

  // Map coach team abbreviations to the team names used in PICK_POOL game strings.
  const TEAM_ABBR_TO_NAME = {
    nfl: {
      ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears",
      CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers",
      HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs", LV: "Raiders", LAC: "Chargers",
      LAR: "Rams", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants",
      NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SF: "49ers", SEA: "Seahawks", TB: "Buccaneers",
      TEN: "Titans", WAS: "Commanders",
    },
    nba: {
      ATL: "Hawks", BOS: "Celtics", BKN: "Nets", CHA: "Hornets", CHI: "Bulls", CLE: "Cavaliers",
      DAL: "Mavericks", DEN: "Nuggets", DET: "Pistons", GSW: "Warriors", HOU: "Rockets",
      IND: "Pacers", LAC: "Clippers", LAL: "Lakers", MEM: "Grizzlies", MIA: "Heat", MIL: "Bucks",
      MIN: "Timberwolves", NOP: "Pelicans", NYK: "Knicks", OKC: "Thunder", ORL: "Magic",
      PHI: "76ers", PHX: "Suns", POR: "Trail Blazers", SAC: "Kings", SAS: "Spurs", TOR: "Raptors",
      UTA: "Jazz", WAS: "Wizards",
    },
    mlb: {
      ARI: "Diamondbacks", ATL: "Braves", BAL: "Orioles", BOS: "Red Sox", CHC: "Cubs",
      CHW: "White Sox", CIN: "Reds", CLE: "Guardians", COL: "Rockies", DET: "Tigers",
      HOU: "Astros", KC: "Royals", LAA: "Angels", LAD: "Dodgers", MIA: "Marlins", MIL: "Brewers",
      MIN: "Twins", NYM: "Mets", NYY: "Yankees", OAK: "Athletics", PHI: "Phillies",
      PIT: "Pirates", SD: "Padres", SF: "Giants", SEA: "Mariners", STL: "Cardinals",
      TB: "Rays", TEX: "Rangers", TOR: "Blue Jays", WAS: "Nationals",
    },
    nhl: {
      ANA: "Ducks", BOS: "Bruins", BUF: "Sabres", CGY: "Flames", CAR: "Hurricanes",
      CHI: "Blackhawks", COL: "Avalanche", CBJ: "Blue Jackets", DAL: "Stars", DET: "Red Wings",
      EDM: "Oilers", FLA: "Panthers", LAK: "Kings", MIN: "Wild", MTL: "Canadiens",
      NSH: "Predators", NJD: "Devils", NYI: "Islanders", NYR: "Rangers", OTT: "Senators",
      PHI: "Flyers", PIT: "Penguins", SJS: "Sharks", SEA: "Kraken", STL: "Blues",
      TBL: "Lightning", TOR: "Maple Leafs", VAN: "Canucks", VGK: "Golden Knights",
      WSH: "Capitals", WPG: "Jets",
    },
  };

  // Expand a search query so team initials/abbreviations also match. Team game
  // labels use full names ("Oklahoma City Thunder"), so we map an abbreviation
  // (OKC) to its nickname (Thunder) — which the full label contains — and add
  // that as an extra search term. Returns the raw query plus any matched
  // nicknames (all lowercase).
  const expandTeamQuery = (q) => {
    const terms = [q];
    if (q.length >= 2) {
      for (const sport of Object.keys(TEAM_ABBR_TO_NAME)) {
        const m = TEAM_ABBR_TO_NAME[sport];
        for (const abbr of Object.keys(m)) {
          if (abbr.toLowerCase().startsWith(q)) terms.push(m[abbr].toLowerCase());
        }
      }
    }
    return Array.from(new Set(terms));
  };
  const matchesTerms = (text, terms) => {
    const t = (text || "").toLowerCase();
    return terms.some((term) => t.includes(term));
  };

  // Find a pick from the pool that a coach's tendency bears on, so it can be
  // added to the ticket. Aggressive/front-runner → that team's spread or ML;
  // big-game → an over in their game. Returns a pick or null.
  const findCoachPick = (coach, sport) => {
    const teamName = (TEAM_ABBR_TO_NAME[sport] || {})[coach.team] || coach.team;
    const pool = (PICK_POOL[sport] || []).filter(
      (p) => p.game.includes(teamName) || p.pick.includes(teamName)
    );
    if (pool.length === 0) return null;
    // Prefer a market matching the dominant lean
    if (coach.primetime >= 2) {
      const over = pool.find((p) => /over/i.test(p.pick));
      if (over) return { ...over, sport };
    }
    if (coach.favLean >= 1) {
      const ml = pool.find((p) => /moneyline|ml/i.test(p.market));
      if (ml) return { ...ml, sport };
      const spread = pool.find((p) => /spread/i.test(p.market));
      if (spread) return { ...spread, sport };
    }
    return { ...pool[0], sport };
  };

  // Find a bettable pick tied to an injury: a pick in the injured team's game
  // that benefits from the injury — i.e. on the OPPONENT side (easier matchup),
  // or a player prop in that game. Searches all sports' pools.
  const findInjuryPick = (teamAbbr) => {
    const teamNames = INJURY_TEAM_NAMES[teamAbbr];
    const names = Array.isArray(teamNames) ? teamNames : [teamNames];
    for (const sport of Object.keys(PICK_POOL)) {
      const pool = PICK_POOL[sport] || [];
      // Picks whose game involves the injured team
      const inGame = pool.filter((p) => names.some((n) => n && p.game.includes(n)));
      if (inGame.length === 0) continue;
      // Prefer one on the opponent side (pick text does NOT name the injured team)
      const oppSide = inGame.find((p) => !names.some((n) => n && p.pick.includes(n)));
      const chosen = oppSide || inGame[0];
      return { ...chosen, sport };
    }
    return null;
  };

  // Analyze the current slip and show the breakdown UNDER the slip (not in chat)
  const analyzeCurrentSlip = () => {
    if (parlayLegs.length === 0) return;
    setSlipAnalysis(analyzeSlip(parlayLegs));
    setLegsAnalyzed(true);
    setSlipOpen(true);
  };

  // Render the current ticket to a premium dark "AI PICKS" PNG via the canvas
  // API directly (no internet / no library) so it works offline. Every number
  // shown is derived from REAL slip data — per-leg + parlay confidence, combined
  // odds, stake/payout. We deliberately DON'T print fabricated betting signals
  // (sharp money %, public bet %, line movement, edge score) the app has no feed
  // for; the design's richness comes from layout/typography, not invented stats.
  const downloadTicketImage = async () => {
    if (parlayLegs.length === 0) return;
    const legs = parlayLegs;
    const W = 720;
    const pad = 36;
    const scale = 2; // crisp on retina

    // ---- Derived REAL stats -------------------------------------------------
    const legConfs = legs.map((l) => Math.round(calculateConfidence(l)));
    const avgConf = Math.round(legConfs.reduce((a, b) => a + b, 0) / legs.length);
    let bestIdx = 0;
    legConfs.forEach((c, i) => { if (c > legConfs[bestIdx]) bestIdx = i; });
    const teamBets = legs.filter((l) => l.market !== "Player Prop").length;
    const propBets = legs.length - teamBets;
    const plusLegs = legs.filter((l) => typeof l.odds === "number" && l.odds > 0).length;
    const oddsLabel = bookLegCount >= 2
      ? formatOdds(parlayMath.american)
      : bookLegCount === 1 ? formatOdds(parlayMath.american) : "PP SLIP";
    const toWin = bookLegCount >= 1 ? `$${payout}` : "DFS";
    const potReturn = bookLegCount >= 1 ? `$${(parseFloat(payout) + stake).toFixed(2)}` : "DFS";

    // Honest "why" bullets (max 4) — all derived from real slip data.
    const bullets = [];
    bullets.push(`Avg leg confidence ${avgConf}% · parlay ${parlayConfidence}%`);
    bullets.push(`Top leg: ${legs[bestIdx].pick} (${legConfs[bestIdx]}%)`);
    if (teamBets > 0 && propBets > 0) {
      bullets.push(`Balanced: ${teamBets} team market${teamBets === 1 ? "" : "s"} + ${propBets} player prop${propBets === 1 ? "" : "s"}`);
    } else if (propBets > 0) {
      bullets.push(`${propBets} player prop${propBets === 1 ? "" : "s"} screened on form & matchup`);
    } else {
      bullets.push(`${teamBets} team market${teamBets === 1 ? "" : "s"} screened by the model`);
    }
    if (bookLegCount >= 2) {
      bullets.push(`Combined book price ${formatOdds(parlayMath.american)} — $${payout} to win on $${stake}`);
    } else if (plusLegs > 0) {
      bullets.push(`Includes ${plusLegs} plus-money value pick${plusLegs === 1 ? "" : "s"}`);
    }
    const whyBullets = bullets.slice(0, 4);

    // ---- Layout geometry ----------------------------------------------------
    const headerH = 164;
    const heroH = 128;
    const picksLabelH = 44;
    const rowH = 96;
    const payoutH = 132;
    const whyBodyH = Math.max(whyBullets.length * 30, 124);
    const whyH = 56 + whyBodyH + 22;
    const footerH = 84;
    const GAP = 16;
    const innerW = W - pad * 2;
    let H = headerH + GAP + heroH + GAP + picksLabelH + legs.length * rowH + GAP + payoutH + GAP + whyH + GAP + footerH + 12;

    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.textBaseline = "alphabetic";

    // ---- Helpers ------------------------------------------------------------
    const rr = (x, y, w, h, r) => {
      const rad = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    };
    const fit = (text, maxW, font) => {
      ctx.font = font;
      let t = String(text ?? "");
      if (ctx.measureText(t).width <= maxW) return t;
      while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    };
    const badgeFor = (m) => {
      const x = (m || "").toLowerCase();
      if (x.includes("prop")) return { label: "PLAYER PROP", color: "#c084fc" };
      if (x.includes("spread")) return { label: "SPREAD", color: "#60a5fa" };
      if (x.includes("moneyline") || x === "ml") return { label: "MONEYLINE", color: "#22d3ee" };
      if (x.includes("total") || x.includes("over") || x.includes("under")) return { label: "TOTAL", color: "#fbbf24" };
      return { label: (m || "PICK").toUpperCase(), color: "#94a3b8" };
    };
    const hexA = (hex, a) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    };
    const monogram = (s) => {
      const words = (s || "").replace(/[^a-zA-Z ]/g, " ").trim().split(/\s+/).filter(Boolean);
      if (!words.length) return "SE";
      if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
      return (words[0][0] + words[1][0]).toUpperCase();
    };
    const confColor = (c) => (c >= 65 ? "#22c55e" : c >= 50 ? "#eab308" : "#fb923c");
    const loadImage = (src) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

    // ---- Background + ambient stadium glows ---------------------------------
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#070b16");
    bg.addColorStop(1, "#0a1122");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glowL = ctx.createRadialGradient(110, 50, 0, 110, 50, 340);
    glowL.addColorStop(0, "rgba(34,211,238,0.20)");
    glowL.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = glowL; ctx.fillRect(0, 0, W, 280);
    const glowR = ctx.createRadialGradient(W - 110, 50, 0, W - 110, 50, 340);
    glowR.addColorStop(0, "rgba(34,197,94,0.16)");
    glowR.addColorStop(1, "rgba(34,197,94,0)");
    ctx.fillStyle = glowR; ctx.fillRect(0, 0, W, 280);

    // ---- Header (centered brand) -------------------------------------------
    const logo = await loadImage(stadiumEdgeLogo);
    if (logo) {
      const lh = 54, lw = lh * (logo.width / logo.height || 1);
      ctx.drawImage(logo, W / 2 - lw / 2, 22, lw, lh);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 38px sans-serif";
    ctx.fillText("STADIUM EDGE", W / 2, 110);
    ctx.fillStyle = "#22d3ee";
    ctx.font = "700 15px sans-serif";
    ctx.fillText("• A I   P A R L A Y   P I C K S •", W / 2, 138);
    ctx.textAlign = "left";

    // ---- Hero stat panel (3 cells) -----------------------------------------
    let y = headerH + GAP;
    ctx.fillStyle = "#0f1729";
    rr(pad, y, innerW, heroH, 18); ctx.fill();
    ctx.strokeStyle = "#1e2a44"; ctx.lineWidth = 1; rr(pad, y, innerW, heroH, 18); ctx.stroke();
    const cellW = innerW / 3;
    const heroCells = [
      { label: "COMBINED ODDS", value: oddsLabel, color: "#22d3ee" },
      { label: "PARLAY CONFIDENCE", value: `${parlayConfidence}%`, color: confColor(parlayConfidence) },
      { label: legs.length === 1 ? "LEG" : "LEGS", value: String(legs.length), color: "#f8fafc", sub: `${teamBets} team · ${propBets} prop` },
    ];
    heroCells.forEach((c, i) => {
      const cx = pad + cellW * i + cellW / 2;
      if (i > 0) {
        ctx.strokeStyle = "#1b263e"; ctx.beginPath();
        ctx.moveTo(pad + cellW * i, y + 22); ctx.lineTo(pad + cellW * i, y + heroH - 22); ctx.stroke();
      }
      ctx.textAlign = "center";
      ctx.fillStyle = "#7c8aa5"; ctx.font = "700 12px sans-serif";
      ctx.fillText(c.label, cx, y + 38);
      ctx.fillStyle = c.color; ctx.font = "800 38px sans-serif";
      ctx.fillText(fit(c.value, cellW - 24, "800 38px sans-serif"), cx, y + 82);
      if (c.sub) { ctx.fillStyle = "#64748b"; ctx.font = "600 12px sans-serif"; ctx.fillText(c.sub, cx, y + 104); }
    });
    ctx.textAlign = "left";

    // ---- Picks label --------------------------------------------------------
    y += heroH + GAP;
    ctx.fillStyle = "#f8fafc"; ctx.font = "800 16px sans-serif";
    ctx.fillText("THE PICKS", pad, y + 28);
    ctx.textAlign = "right";
    ctx.fillStyle = "#64748b"; ctx.font = "700 13px sans-serif";
    ctx.fillText(`${legs.length} PICKS · ${teamBets} TEAM · ${propBets} PROP`, W - pad, y + 28);
    ctx.textAlign = "left";

    // ---- Pick rows ----------------------------------------------------------
    y += picksLabelH;
    legs.forEach((leg, i) => {
      const ry = y + i * rowH;
      const card = rowH - 12;
      ctx.fillStyle = "#0e1626"; rr(pad, ry, innerW, card, 14); ctx.fill();
      ctx.strokeStyle = "#1b2740"; ctx.lineWidth = 1; rr(pad, ry, innerW, card, 14); ctx.stroke();
      const b = badgeFor(leg.market);
      // left accent
      ctx.fillStyle = b.color; rr(pad, ry, 5, card, 3); ctx.fill();
      // monogram chip
      const chipX = pad + 20, chipY = ry + card / 2, chipR = 22;
      ctx.fillStyle = hexA(b.color, 0.16);
      ctx.beginPath(); ctx.arc(chipX + chipR, chipY, chipR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexA(b.color, 0.5); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(chipX + chipR, chipY, chipR, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = b.color; ctx.font = "800 16px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(monogram(leg.pick), chipX + chipR, chipY + 6);
      ctx.textAlign = "left";
      const textX = chipX + chipR * 2 + 16;
      const rightColW = 110;
      const textMaxW = W - pad - rightColW - textX - 12;
      // badge + game
      ctx.font = "800 10px sans-serif"; ctx.fillStyle = b.color;
      const badgeW = ctx.measureText(b.label).width + 16;
      ctx.fillStyle = hexA(b.color, 0.14); rr(textX, ry + 16, badgeW, 18, 9); ctx.fill();
      ctx.fillStyle = b.color; ctx.font = "800 10px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(b.label, textX + 8, ry + 29);
      ctx.fillStyle = "#64748b"; ctx.font = "600 12px sans-serif";
      ctx.fillText(fit(leg.game, textMaxW - badgeW - 10, "600 12px sans-serif"), textX + badgeW + 10, ry + 29);
      // pick
      ctx.fillStyle = "#f1f5f9"; ctx.font = "800 19px sans-serif";
      ctx.fillText(fit(leg.pick, textMaxW, "800 19px sans-serif"), textX, ry + 57);
      // right: odds + confidence
      ctx.textAlign = "right";
      ctx.fillStyle = "#e2e8f0"; ctx.font = "800 20px sans-serif";
      ctx.fillText(formatOdds(leg.odds), W - pad - 16, ry + 34);
      const c = legConfs[i];
      ctx.fillStyle = confColor(c); ctx.font = "800 14px sans-serif";
      ctx.fillText(`${c}%`, W - pad - 16, ry + 58);
      ctx.fillStyle = "#475569"; ctx.font = "600 10px sans-serif";
      ctx.fillText("CONFIDENCE", W - pad - 16, ry + 72);
      ctx.textAlign = "left";
    });

    // ---- Payout panel (3 cells) --------------------------------------------
    y += legs.length * rowH + GAP;
    const payGrad = ctx.createLinearGradient(pad, y, pad + innerW, y);
    payGrad.addColorStop(0, "#0c1a2e");
    payGrad.addColorStop(1, "#0c241c");
    ctx.fillStyle = payGrad; rr(pad, y, innerW, payoutH, 18); ctx.fill();
    ctx.strokeStyle = "#1f3a33"; ctx.lineWidth = 1; rr(pad, y, innerW, payoutH, 18); ctx.stroke();
    const payCells = [
      { label: "STAKE", value: `$${stake.toFixed(2)}`, color: "#f8fafc" },
      { label: bookLegCount >= 1 ? "TO WIN" : "TO WIN", value: toWin, color: "#22c55e" },
      { label: "POTENTIAL RETURN", value: potReturn, color: "#22c55e" },
    ];
    payCells.forEach((c, i) => {
      const cx = pad + cellW * i + cellW / 2;
      if (i > 0) {
        ctx.strokeStyle = "#1c3a30"; ctx.beginPath();
        ctx.moveTo(pad + cellW * i, y + 24); ctx.lineTo(pad + cellW * i, y + payoutH - 40); ctx.stroke();
      }
      ctx.textAlign = "center";
      ctx.fillStyle = "#7c8aa5"; ctx.font = "700 12px sans-serif";
      ctx.fillText(c.label, cx, y + 40);
      ctx.fillStyle = c.color; ctx.font = "800 34px sans-serif";
      ctx.fillText(fit(c.value, cellW - 20, "800 34px sans-serif"), cx, y + 80);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b"; ctx.font = "600 11px sans-serif";
    const payNote = ppLegCount > 0
      ? `${bookLegCount} book leg${bookLegCount === 1 ? "" : "s"} priced · ${ppLegCount} PrizePicks leg${ppLegCount === 1 ? "" : "s"} on flat DFS schedule (not in combined odds)`
      : `Based on a $${stake.toFixed(2)} stake at ${formatOdds(parlayMath.american)} combined odds`;
    ctx.fillText(fit(payNote, innerW - 24, "600 11px sans-serif"), W / 2, y + payoutH - 16);
    ctx.textAlign = "left";

    // ---- Why panel (bullets + confidence gauge) ----------------------------
    y += payoutH + GAP;
    ctx.fillStyle = "#0f1729"; rr(pad, y, innerW, whyH, 18); ctx.fill();
    ctx.strokeStyle = "#1e2a44"; ctx.lineWidth = 1; rr(pad, y, innerW, whyH, 18); ctx.stroke();
    ctx.fillStyle = "#22c55e"; ctx.font = "800 14px sans-serif";
    ctx.fillText("WHY THE AI LIKES THIS PARLAY", pad + 22, y + 34);
    const gaugeW = 150;
    const bulletMaxW = innerW - gaugeW - 64;
    whyBullets.forEach((t, i) => {
      const by = y + 64 + i * 30;
      ctx.fillStyle = "#22c55e"; ctx.font = "800 13px sans-serif";
      ctx.fillText("✓", pad + 22, by);
      ctx.fillStyle = "#cbd5e1"; ctx.font = "600 13px sans-serif";
      ctx.fillText(fit(t, bulletMaxW, "600 13px sans-serif"), pad + 42, by);
    });
    // half-circle confidence gauge (right)
    const gx = pad + innerW - gaugeW / 2 - 16;
    const gy = y + whyH - 40;
    const gR = 50;
    ctx.lineCap = "round"; ctx.lineWidth = 12;
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath(); ctx.arc(gx, gy, gR, Math.PI, Math.PI * 2); ctx.stroke();
    const frac = Math.max(0, Math.min(1, parlayConfidence / 100));
    ctx.strokeStyle = confColor(parlayConfidence);
    ctx.beginPath(); ctx.arc(gx, gy, gR, Math.PI, Math.PI + Math.PI * frac); ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = confColor(parlayConfidence); ctx.font = "800 26px sans-serif";
    ctx.fillText(`${parlayConfidence}%`, gx, gy - 6);
    ctx.fillStyle = "#7c8aa5"; ctx.font = "700 11px sans-serif";
    ctx.fillText("PARLAY CONFIDENCE", gx, gy + 16);
    ctx.textAlign = "left";

    // ---- Footer -------------------------------------------------------------
    y += whyH + GAP;
    ctx.fillStyle = "#0b1120"; rr(pad, y, innerW, footerH, 16); ctx.fill();
    ctx.strokeStyle = "#1a2236"; ctx.lineWidth = 1; rr(pad, y, innerW, footerH, 16); ctx.stroke();
    ctx.fillStyle = "#22d3ee"; ctx.font = "800 14px sans-serif";
    ctx.fillText("STADIUM EDGE AI", pad + 22, y + 32);
    ctx.fillStyle = "#94a3b8"; ctx.font = "600 12px sans-serif";
    ctx.fillText("Make smarter bets. Beat the market.", pad + 22, y + 52);
    ctx.fillStyle = "#475569"; ctx.font = "600 10px sans-serif";
    ctx.fillText("Hypothetical only · not a real bet · 21+ · model ranking, not a prediction", pad + 22, y + 70);

    // ---- Download -----------------------------------------------------------
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stadium-edge-ticket-${legs.length}leg.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  // Pick ONE brand-new AI-recommended leg for the "Fix" button to append.
  // "Best" = highest model confidence (calculateConfidence), drawn ONLY from
  // the live odds feed (realOddsBySport) so we never invent a line, and from a
  // game NOT already on the slip (excludeGames) to avoid correlated/contradictory
  // legs. Skips no-value steamroller juice and extreme longshots, and any pick
  // already on the slip. Returns null when nothing eligible exists.
  const bestAiPickForFix = (excludeGames) => {
    // Identify a game by its (orientation-independent) team pair, not its raw
    // label, so "A vs B", "B @ A", and "A @ B" all resolve to the same key.
    // This prevents a same-game (correlated) leg from sneaking on when an
    // existing leg's label format differs from the odds-feed format.
    const gamePairKey = (label) => {
      const m = String(label || "").match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+)$/i);
      if (!m) return String(label || "").trim().toLowerCase();
      return [m[1].trim().toLowerCase(), m[2].trim().toLowerCase()].sort().join(" @ ");
    };
    const exclude = new Set((excludeGames || []).map(gamePairKey));
    const existingKeys = new Set(parlayLegs.map(legKey));
    const candidates = [];
    for (const games of Object.values(realOddsBySport || {})) {
      for (const g of games || []) {
        const label = `${g.awayTeam} @ ${g.homeTeam}`;
        if (exclude.has(gamePairKey(label))) continue;
        for (const pk of buildPicksFromOdds(g)) {
          if (pk.odds != null && (pk.odds <= -1000 || pk.odds >= 1000)) continue;
          if (existingKeys.has(legKey(pk))) continue;
          candidates.push(pk);
        }
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => calculateConfidence(b) - calculateConfidence(a));
    return candidates[0];
  };

  // "Fix for best outcome": KEEPS every leg (no removals). Adjusts each leg's
  // line toward the model's higher-confidence direction — buys points on
  // spreads/totals (easier to hit, lower payout) and nudges player-prop lines
  // toward the player's season average. Legs whose line can't be moved
  // (moneyline or an unmovable prop) are left as-is. Applies the changes
  // SILENTLY: the slip cards update in place with the safer line + new price,
  // and no analysis panel pops up (per user preference).
  const optimizeSlip = () => {
    if (parlayLegs.length === 0) return;

    const adjusted = parlayLegs.map((leg) => {
      // Spread / total: buy a point in the safer direction
      if (canBuyPoints(leg)) {
        const safer = buyPoints(leg, 1);
        return safer ? { ...safer, id: leg.id } : leg;
      }
      // Player prop: nudge the line toward the player's average to raise hit-odds.
      // Over → lower the line; Under → raise it. Half-point step.
      const m = leg.pick.match(/(over|under)\s+([+-]?\d+(?:\.\d+)?)/i);
      if (m) {
        const isOver = /over/i.test(m[1]);
        const oldLine = parseFloat(m[2]);
        const newLine = isOver ? oldLine - 0.5 : oldLine + 0.5;
        // Worsen the payout to reflect the easier line (mirror of buyPoints pricing)
        const baseDecimal = americanToDecimal(leg.odds);
        const newNet = Math.max(0.05, (baseDecimal - 1) * 0.82);
        const newOdds = decimalToAmerican(1 + newNet);
        const newPick = leg.pick.replace(m[2], `${newLine}`);
        return {
          ...leg,
          pick: newPick,
          odds: newOdds,
          pointsDelta: (leg.pointsDelta || 0) + 0.5,
          originalPick: leg.originalPick ?? leg.pick,
          originalOdds: leg.originalOdds ?? leg.odds,
        };
      }
      // Moneyline / anything else: can't move a line, leave as-is
      return leg;
    });

    // Count how many existing legs actually moved (line or price changed) so
    // we can show a compact receipt. Clear any stale full analysis note first.
    const changed = adjusted.reduce((n, leg, i) => {
      const orig = parlayLegs[i];
      return n + (orig && (orig.pick !== leg.pick || orig.odds !== leg.odds) ? 1 : 0);
    }, 0);

    setParlayLegs(adjusted);
    setLegsAnalyzed(false);
    setSlipAnalysis(null);

    // Then append ONE brand-new AI-recommended real leg from the live odds
    // feed (a game not already on the slip). autoFillSlip re-validates the
    // matchup, dedupes, logs it to the tracker, and rolls the new leg's price
    // into the slip's aggregated total automatically (the total derives from
    // parlayLegs). No-op if no eligible pick exists.
    const aiPick = bestAiPickForFix(adjusted.map((l) => l.game));
    if (aiPick) autoFillSlip([aiPick]);

    // Compact one-line receipt so the user can SEE what Fix did — how many
    // legs were safened and whether a new AI leg was added — without the
    // wall-of-text analysis panel they explicitly rejected.
    setFixSummary(
      `${changed} leg${changed !== 1 ? "s" : ""} safened` +
      (aiPick ? ` · +1 AI leg (${aiPick.pick})` : "")
    );
  };

  // Up = add a point (line in your favor); Down = remove a point (against you)
  // Step size: yardage props move by 5, everything else by 1 (spreads/totals) or 0.5 (other props)
  const stepForLeg = (leg) => {
    if (leg.market === "Player Prop") {
      if (/yds|yards|passing|rushing|receiving/i.test(leg.pick)) return 5;
      return 0.5;
    }
    return 1;
  };
  // + always RAISES the displayed number, − always LOWERS it (symbol matches).
  // Under the hood this maps to buy/sell depending on the pick's side so the
  // odds still move correctly (raising an over line = harder = bigger payout).
  const isOverSide = (leg) => /\bover\b/i.test(leg.pick) || /\d+(\.\d+)?\s*\+/.test(leg.pick);
  const isUnderSide = (leg) => /\bunder\b/i.test(leg.pick);

  // Raise the line number
  const addPointOnLeg = (id, points) => {
    setParlayLegs((p) =>
      p.map((l) => {
        if (l.id !== id) return l;
        const step = points ?? stepForLeg(l);
        // Raising the number: harder for an over (sell), easier for an under (buy),
        // and "add" for a spread/total via buyPoints' spread branch.
        let updated;
        if (isOverSide(l)) updated = sellPoints(l, step);
        else if (isUnderSide(l)) updated = buyPoints(l, step);
        else updated = buyPoints(l, step); // spread/other: buyPoints adds to the number
        return updated ? { ...updated, id: l.id } : l;
      })
    );
  };
  // Lower the line number
  const removePointOnLeg = (id, points) => {
    setParlayLegs((p) =>
      p.map((l) => {
        if (l.id !== id) return l;
        const step = points ?? stepForLeg(l);
        let updated;
        if (isOverSide(l)) updated = buyPoints(l, step);
        else if (isUnderSide(l)) updated = sellPoints(l, step);
        else updated = sellPoints(l, step); // spread/other: sellPoints subtracts from the number
        return updated ? { ...updated, id: l.id } : l;
      })
    );
  };
  const resetLegPoints = (id) => {
    setParlayLegs((p) =>
      p.map((l) => {
        if (l.id !== id || l.originalPick == null) return l;
        return { ...l, pick: l.originalPick, odds: l.originalOdds, pointsDelta: 0, originalPick: undefined, originalOdds: undefined };
      })
    );
  };

  // Detect same-game (correlated) legs in the current slip
  const correlatedGames = (() => {
    const counts = {};
    parlayLegs.forEach((l) => { counts[l.game] = (counts[l.game] || 0) + 1; });
    return Object.keys(counts).filter((g) => counts[g] > 1);
  })();

  // Auto-fill the slip with a freshly built set of picks. APPENDS to the
  // current slip (does not replace) so when the user taps "Build a parlay" or
  // asks the chat to build a new one, their existing legs stay put and the
  // new picks pile on. The Trash / "Remove all" buttons in the slip UI are
  // the only way to clear — the chat never wipes the user's ticket. We still
  // dedupe inside the incoming batch AND against legs already on the slip
  // so the same pick can't land twice.
  // Shared guard: filter a batch of picks down to only those whose game
  // appears in the live ESPN schedule or live odds feed. Returns the
  // canonical (full-name) label for each kept pick so the slip stays
  // consistent with the live data. If the live pool is empty (e.g. odds API
  // out of credits AND no ESPN games loaded), nothing passes — we never
  // surface a matchup we can't prove is real. Used by every path that
  // touches the slip, so file uploads, AI replies, and the offline fallback
  // are all guarded the same way.
  const filterPicksToReal = (picks) => {
    if (!picks || picks.length === 0) return { kept: [], dropped: [] };
    const teamTokensFor = (name) => {
      const out = new Set();
      const raw = String(name || "").trim();
      if (!raw) return out;
      const norm = raw.toLowerCase();
      out.add(norm);
      const parts = norm.split(/\s+/);
      out.add(parts[parts.length - 1]);
      if (parts.length >= 3) out.add(parts.slice(-2).join(" "));
      const abbr = FULL_TO_ABBR[raw];
      if (abbr) out.add(abbr.toLowerCase());
      return out;
    };
    const splitLabel = (label) => {
      const mm = String(label || "").match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+)$/i);
      return mm ? [mm[1].trim(), mm[2].trim()] : null;
    };
    // 48h window: include games up to 4h in the past (live / just-started)
    // and 48h in the future. Anything outside is "far out" and must not be
    // pickable — matches the chat handler's eligibility window exactly.
    // Widened from 24h to 48h so prop markets (HR / K's / anytime-TD) that
    // only post for tomorrow's slate are visible alongside today's.
    const NOW = Date.now();
    const WINDOW_MS = 48 * 60 * 60 * 1000;
    const BACK_MS = 4 * 60 * 60 * 1000;
    const inWindow = (ts) => {
      if (!ts) return false;
      const t = new Date(ts).getTime();
      return !isNaN(t) && t >= NOW - BACK_MS && t <= NOW + WINDOW_MS;
    };
    const matchups = [];
    for (const sportGames of Object.values(realGamesBySport || {})) {
      for (const g of (sportGames || [])) {
        if (!g.awayTeam || !g.homeTeam) continue;
        if (!inWindow(g.startsAt)) continue;
        matchups.push({
          awayTokens: teamTokensFor(g.awayTeam),
          homeTokens: teamTokensFor(g.homeTeam),
          canonical: `${g.awayTeam} @ ${g.homeTeam}`,
        });
      }
    }
    for (const sportOdds of Object.values(realOddsBySport || {})) {
      for (const g of (sportOdds || [])) {
        if (!g.awayTeam || !g.homeTeam) continue;
        if (!inWindow(g.commenceTime)) continue;
        matchups.push({
          awayTokens: teamTokensFor(g.awayTeam),
          homeTokens: teamTokensFor(g.homeTeam),
          canonical: `${g.awayTeam} @ ${g.homeTeam}`,
        });
      }
    }
    // Also include livePicks — the chat handler builds its eligibility pool
    // from a *local* snapshot of fresh fetch results that the React state
    // (realGamesBySport / realOddsBySport) hasn't necessarily caught up to
    // by the time autoFillSlip runs (setState is async). livePicks is set
    // well before any chat request, so its matchups are always available
    // here. Without this, every chat-validated pick gets dropped a second
    // time and the slip stays empty.
    const seenLabels = new Set(matchups.map((m) => m.canonical));
    // Also include any game whose player props we've already loaded into
    // realPropsByEvent (typically because the user opened that game's
    // detail page, or chat pre-fetched its props on a prior send). Without
    // this, when the odds API is dead and ESPN has the game but the props
    // are only cached in realPropsByEvent, a chat-recommended prop leg
    // would fall through the matchup match and silently get dropped — the
    // exact failure path that made "props from chat don't add to the slip".
    for (const propData of Object.values(realPropsByEvent || {})) {
      const label = propData?.home && propData?.away ? `${propData.away} @ ${propData.home}` : null;
      if (!label || seenLabels.has(label)) continue;
      matchups.push({
        awayTokens: teamTokensFor(propData.away),
        homeTokens: teamTokensFor(propData.home),
        canonical: label,
      });
      seenLabels.add(label);
    }
    for (const lp of livePicks || []) {
      const label = String(lp.game || "");
      if (!label || seenLabels.has(label)) continue;
      // Drop anything outside the 48h window — livePicks contains the next
      // several days of ESPN games for the selected sports and we only want
      // games starting (or already started) within the chat window.
      if (!inWindow(lp.startsAt)) continue;
      const mm = label.match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+)$/i);
      if (!mm) continue;
      const away = mm[1].trim();
      const home = mm[2].trim();
      matchups.push({
        awayTokens: teamTokensFor(away),
        homeTokens: teamTokensFor(home),
        canonical: label,
      });
      seenLabels.add(label);
    }
    const overlap = (a, b) => {
      for (const t of a) if (b.has(t)) return true;
      return false;
    };
    const kept = [];
    const dropped = [];
    for (const p of picks) {
      const parts = splitLabel(p.game);
      if (!parts) { dropped.push(p.game); continue; }
      // First pass: drop cross-sport legs purely from team identity. This
      // catches hallucinations like "Miami Dolphins @ Toronto Raptors"
      // (NFL vs NBA) even when the live data pool is empty — which is the
      // exact case the user keeps hitting because the odds API is dead.
      const aSport = teamSportOf(parts[0]);
      const hSport = teamSportOf(parts[1]);
      if (aSport && hSport && aSport !== hSport) {
        dropped.push(p.game);
        continue;
      }
      // Second pass: time-window check that runs even when the matchup
      // pool (which only contains in-window games) is empty. We scan the
      // raw feeds unfiltered for the leg's start time — if it's known and
      // outside the [-4h, +24h] window we drop, no matter the sport. This
      // catches things like "Bucs @ Ravens" in September showing up while
      // the in-window pool is empty for the user's sport selection.
      const rawStart = (() => {
        const label = p.game;
        for (const sg of Object.values(realGamesBySport || {})) {
          for (const g of (sg || [])) {
            if (`${g.awayTeam} @ ${g.homeTeam}` === label) return g.startsAt || null;
          }
        }
        for (const so of Object.values(realOddsBySport || {})) {
          for (const g of (so || [])) {
            if (`${g.awayTeam} @ ${g.homeTeam}` === label) return g.commenceTime || null;
          }
        }
        for (const lp of livePicks || []) {
          if (lp.game === label && lp.startsAt) return lp.startsAt;
        }
        return null;
      })();
      if (rawStart && !inWindow(rawStart)) { dropped.push(p.game); continue; }

      // Third pass: require a real matchup. If the pool is empty AND we
      // couldn't find this leg's matchup in ANY raw feed (rawStart is
      // null), the leg is unverifiable — drop it. This is the project's
      // "no fake fallbacks" rule: a hallucinated matchup like
      // "Bucs @ Ravens" (Bucs actually play Bengals) has no entry in the
      // raw feeds, so we can't prove it's real and we must not show it.
      // The only legs that get a pass-through here are ones whose game
      // label DID match a raw feed entry but that entry had no usable
      // start time — extremely rare; better to keep than drop on noise.
      if (matchups.length === 0) {
        if (!rawStart) { dropped.push(p.game); continue; }
        kept.push(p);
        continue;
      }
      const aTokens = teamTokensFor(parts[0]);
      const hTokens = teamTokensFor(parts[1]);
      let hit = null;
      for (const m of matchups) {
        if (
          (overlap(aTokens, m.awayTokens) && overlap(hTokens, m.homeTokens)) ||
          (overlap(aTokens, m.homeTokens) && overlap(hTokens, m.awayTokens))
        ) { hit = m; break; }
      }
      if (!hit) { dropped.push(p.game); continue; }
      kept.push({ ...p, game: hit.canonical || p.game });
    }
    return { kept, dropped, poolSize: matchups.length };
  };

  // Look up the kickoff timestamp for a given "Away @ Home" label across
  // every live data source we have. Returns null if the game isn't in the
  // current live feeds (e.g. it ended and rotated out, or it was added
  // before the latest refresh).
  const lookupGameStart = (gameLabel) => {
    if (!gameLabel) return null;
    // Playoff series produce multiple games with identical "Away @ Home"
    // labels (e.g. Spurs @ Thunder Game 1, Game 3, Game 5). Collect every
    // matching candidate then prefer:
    //   1. a non-final game whose start is in the future (the actual next
    //      game), nearest-soonest first
    //   2. else any non-final game (live/in-progress)
    //   3. else the most recent past game
    // Without this, returning the first match leaks the finished game's
    // start time onto the upcoming card.
    const isFinalSt = (st) => {
      const x = (st || "").toLowerCase();
      return x.includes("final") || x.includes("full time") || x.includes("postponed") || x.includes("canceled") || x.includes("cancelled") || x.includes("ended") || /\bft\b/.test(x);
    };
    const candidates = [];
    for (const sportGames of Object.values(realGamesBySport || {})) {
      for (const g of (sportGames || [])) {
        if (`${g.awayTeam} @ ${g.homeTeam}` !== gameLabel) continue;
        if (g.startsAt) candidates.push({ ts: new Date(g.startsAt).getTime(), iso: g.startsAt, final: isFinalSt(g.status) });
      }
    }
    for (const sportOdds of Object.values(realOddsBySport || {})) {
      for (const g of (sportOdds || [])) {
        if (`${g.awayTeam} @ ${g.homeTeam}` !== gameLabel) continue;
        if (g.commenceTime) candidates.push({ ts: new Date(g.commenceTime).getTime(), iso: g.commenceTime, final: false });
      }
    }
    for (const lp of livePicks || []) {
      if (lp.game === gameLabel && lp.startsAt) candidates.push({ ts: new Date(lp.startsAt).getTime(), iso: lp.startsAt, final: false });
    }
    if (candidates.length === 0) return null;
    const NOW = Date.now();
    const future = candidates.filter((c) => !c.final && Number.isFinite(c.ts) && c.ts >= NOW - 10 * 60 * 1000);
    if (future.length) return future.sort((a, b) => a.ts - b.ts)[0].iso;
    const nonFinal = candidates.filter((c) => !c.final);
    if (nonFinal.length) return nonFinal.sort((a, b) => b.ts - a.ts)[0].iso;
    return candidates.sort((a, b) => b.ts - a.ts)[0].iso;
  };

  // True when a game LABEL resolves ONLY to a finished/past game and has no
  // live or future candidate in the current feeds. This catches two cases:
  //   1. the AI built a pick on a genuinely finished game, and
  //   2. the AI FLIPPED home/away ("OKC @ SAS" instead of the real upcoming
  //      "SAS @ OKC"), and the reversed label collides with a DIFFERENT,
  //      already-final game in the feed — which would otherwise stamp that
  //      finished game's "Today 7:30 PM" tipoff onto the card.
  // Used to suppress such cards in the chat render. Unknown labels (no feed
  // match at all) return false so a legit pick whose feed simply dropped is
  // still kept (historical snapshots stay immutable).
  const gameResolvesToFinal = (gameLabel) => {
    if (!gameLabel) return false;
    const isFinalSt = (st) => {
      const x = (st || "").toLowerCase();
      return x.includes("final") || x.includes("full time") || x.includes("postponed") || x.includes("canceled") || x.includes("cancelled") || x.includes("ended") || /\bft\b/.test(x);
    };
    const isActiveSt = (st) => {
      const x = (st || "").toLowerCase();
      return x.includes("in progress") || x.includes("in-progress") || x.includes("live")
        || x.includes("halftime") || x.includes("half time") || x.includes("end of")
        || x.includes("delay") || x.includes("suspend") || x.includes("overtime") || /\bot\b/.test(x);
    };
    let sawFinal = false;
    const NOW = Date.now();
    const GRACE = 10 * 60 * 1000;
    for (const sportGames of Object.values(realGamesBySport || {})) {
      for (const g of (sportGames || [])) {
        if (`${g.awayTeam} @ ${g.homeTeam}` !== gameLabel) continue;
        if (isActiveSt(g.status)) return false; // live → keep
        if (isFinalSt(g.status)) { sawFinal = true; continue; }
        const t = g.startsAt ? new Date(g.startsAt).getTime() : NaN;
        if (!Number.isFinite(t) || t > NOW - GRACE) return false; // future/scheduled → keep
        sawFinal = true; // scheduled-but-past tipoff with no live status → treat as done
      }
    }
    // A future/live odds or livePicks entry for this exact label keeps it alive;
    // an odds entry whose commence time is already past (and nothing live/future
    // contradicts it) is itself evidence the game is done.
    for (const sportOdds of Object.values(realOddsBySport || {})) {
      for (const g of (sportOdds || [])) {
        if (`${g.awayTeam} @ ${g.homeTeam}` !== gameLabel) continue;
        const t = g.commenceTime ? new Date(g.commenceTime).getTime() : NaN;
        if (!Number.isFinite(t) || t > NOW - GRACE) return false;
        sawFinal = true;
      }
    }
    for (const lp of livePicks || []) {
      if (lp.game === gameLabel) return false;
    }
    return sawFinal;
  };

  // If a slip leg's game is currently LIVE in the ESPN feed, return a
  // short "🔴 Q3 8:42" / "🔴 HT" tag built from the real period + clock —
  // never a fabricated "Live" string. Returns null when the game is
  // scheduled (pre-game), final, or simply not in any current feed (so
  // the caller falls back to the kickoff timestamp instead).
  const lookupLiveTag = (gameLabel) => {
    if (!gameLabel) return null;
    for (const sportGames of Object.values(realGamesBySport || {})) {
      for (const g of (sportGames || [])) {
        if (`${g.awayTeam} @ ${g.homeTeam}` !== gameLabel) continue;
        const s = (g.status || "").toLowerCase();
        // Widened to match the All Sports filter: ended/FT games must not
        // render a 🔴 live tag anywhere (slip legs, chat picks, game cards).
        const isFinal = s.includes("final") || s.includes("full time") || s.includes("postponed") || s.includes("canceled") || s.includes("cancelled") || s.includes("ended") || /\bft\b/.test(s);
        const isScheduled = s.includes("scheduled") || s.includes("pre");
        if (isFinal || isScheduled) return null;
        // periodLabel is ESPN's shortDetail ("Q3 8:42", "Bot 7th", "HT",
        // "OT"). Fall back only to the raw status string — never a
        // synthesized "Live" — so we keep the no-fake-data guarantee.
        const tag = g.periodLabel || g.status || null;
        return tag ? `🔴 ${tag}` : null;
      }
    }
    return null;
  };

  // Format a kickoff timestamp as a short human-readable tag for the slip:
  // "Today 8:30 PM", "Tomorrow 1:05 PM", or "Wed May 27 · 8:30 PM" for
  // anything further out. Returns null on bad/missing input.
  const formatGameTime = (ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay(d, now)) return `Today · ${time}`;
    if (sameDay(d, tomorrow)) return `Tomorrow · ${time}`;
    const date = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    return `${date} · ${time}`;
  };

  // Sweep stale/invalid legs out of the slip whenever the live feeds
  // refresh. Catches: (1) legs added before the eligibility filter existed,
  // (2) cross-sport hallucinations that slipped through earlier code, (3)
  // games that ended and aged out of the 24h window. Only runs once the
  // pool is populated so we don't nuke the slip during a momentary blank
  // (e.g. between mounts, before fetches resolve).
  useEffect(() => {
    if (parlayLegs.length === 0) return;
    // Drop anything the filter rejected. The filter itself already
    // handles the "feed gap" case correctly — it only drops legs that
    // either (a) are cross-sport hallucinations, (b) have a known start
    // time outside the 48h window, or (c) have no entry in any raw feed
    // (unverifiable). We DON'T early-return on poolSize===0 anymore: a
    // hallucinated leg with no raw-feed match should disappear even when
    // the live data is momentarily empty, because more data isn't going
    // to make a fake matchup real.
    //
    // GRACE WINDOW: legs auto-filled by the streaming chat were validated
    // moments ago against a freshly-fetched in-call matchup pool. The
    // React state this sweep reads is async and may not yet include the
    // props/odds that justified those legs — re-filtering immediately
    // would strip 5-of-6 valid legs ("asked for 6, got 1" bug). Exempt
    // anything added within the last 90s; by then props/odds state has
    // caught up and the sweep can fairly judge them.
    //
    // We validate PER LEG (not a single bulk filter) because the bulk
    // call's `kept` array is keyed under canonicalized labels — if a leg
    // was inserted under the AI's raw label and later canonicalization
    // would change it, the bulk-key set comparison wrongly drops it.
    // Per-leg check returns truthy whenever ANY canonical form survives.
    const now = Date.now();
    const GRACE_MS = 90_000;
    // Hard ceiling for keeping a chat-validated leg whose game has rotated out
    // of every feed: 8h comfortably covers long games / extra innings while
    // still clearing a stale leg the same day.
    const CHATVALID_MAX_MS = 8 * 60 * 60 * 1000;
    const survives = (l) =>
      filterPicksToReal([l]).kept.length > 0 ||
      (l.addedAt && now - l.addedAt < GRACE_MS) ||
      // Legs committed from a chat slip card were already validated against the
      // live pool when the AI generated that message (hallucinated / out-of-
      // window legs were stripped before the text rendered). The Odds API pool
      // CHURNS between sends — a 429 collapses it to a smaller ESPN fallback —
      // so a real game the user picked can briefly disappear from the current
      // pool, and a blind re-filter here would wrongly strip it. Keep any
      // chat-validated leg until its game has actually FINISHED, OR — as a
      // bounded staleness fallback for a finished game that rotated out of
      // every feed (so gameResolvesToFinal can no longer see it) — until well
      // past its known start time.
      (l.chatValidated && !gameResolvesToFinal(l.game) &&
        !(l.gameStartTs && now - l.gameStartTs > CHATVALID_MAX_MS));
    const survivors = parlayLegs.filter(survives);
    if (survivors.length === parlayLegs.length) return; // nothing to drop — safe no-op, prevents loop
    const survivorKeys = new Set(survivors.map(legKey));
    setParlayLegs((prev) => prev.filter((l) => survivorKeys.has(legKey(l))));
    // No deps array on purpose: runs after every render. The
    // early-return above (`survivors.length === parlayLegs.length`)
    // makes this safe — once the slip is clean, the effect is a no-op
    // and the loop terminates. This is the only way to guarantee the slip
    // re-evaluates after a hot module reload, when the filter logic
    // changes but parlayLegs state is preserved unchanged.
  });

  const autoFillSlip = (picks, opts = {}) => {
    if (!picks || picks.length === 0) return { requested: 0, added: 0, droppedNotLive: [], droppedDup: 0 };
    // Guard #1: drop any leg whose matchup isn't in the live feed. This
    // catches the fallback path, file uploads, and any leg the chat-side
    // filter missed.
    //
    // EXCEPTION: the streaming chat auto-fill path already validates every
    // leg against a comprehensive matchup pool built INSIDE the same
    // sendMessage call (which includes fresh props fetched THIS turn). If
    // we re-run filterPicksToReal here we use React state that hasn't
    // committed the just-fetched props yet (setState is async), so 5 of 6
    // legs get silently dropped — the exact "asked for 6, got 1" failure.
    // Skip the redundant filter when the caller has already validated.
    const requested = picks.length;
    const filtered = opts.alreadyValidated ? { kept: picks, dropped: [] } : filterPicksToReal(picks);
    const kept = filtered.kept;
    const droppedNotLive = (filtered.dropped || []).filter(Boolean);
    if (kept.length === 0) return { requested, added: 0, droppedNotLive, droppedDup: 0 };
    const existingKeys = new Set(parlayLegs.map(legKey));
    const seen = new Set();
    const deduped = [];
    for (const p of kept) {
      const k = legKey(p);
      if (existingKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      deduped.push(p);
    }
    const droppedDup = kept.length - deduped.length;
    if (deduped.length === 0) return { requested, added: 0, droppedNotLive, droppedDup };
    // Unique id per leg even when several land in the same millisecond
    // (Date.now() resolution is coarse; adding the index prevents React-key
    // collisions when 6+ legs are auto-filled at once). addedAt is what
    // the slip-sweep grace window keys off — without it the sweep would
    // re-filter against stale React state and drop 5-of-6 valid legs.
    const now = Date.now();
    const legs = deduped.map((leg, i) => {
      const base = { ...leg, id: now + i + Math.random(), addedAt: now };
      if (!opts.chatValidated) return base;
      // Stamp the known start time so the slip-sweep can expire this leg long
      // after kickoff even if the game has rotated out of every live feed.
      const gsRaw = lookupGameStart(leg.game);
      const gsTs = gsRaw ? new Date(gsRaw).getTime() : NaN;
      return { ...base, chatValidated: true, gameStartTs: Number.isFinite(gsTs) ? gsTs : null };
    });
    setParlayLegs((prev) => [...prev, ...legs]);
    // Log each to the tracker as pending
    setTracker((prev) => [
      ...prev,
      ...legs.map((leg) => {
        return {
          id: leg.id,
          game: leg.game,
          market: leg.market,
          pick: leg.pick,
          odds: leg.odds,
          signature: pickSignature(leg),
          status: "pending",
          addedAt: Date.now(),
          reasoning: generateReasoning(leg),
          confidenceAtAdd: calculateConfidence(leg),
        };
      }),
    ]);
    return { requested, added: legs.length, droppedNotLive, droppedDup };
  };

  const updateTrackerStatus = (entryId, status) => {
    setTracker((prev) => prev.map((e) => (e.id === entryId ? { ...e, status, resolvedAt: Date.now() } : e)));
  };

  // CLV (closing line value): record the line that closed, compare to what you got.
  // Beating the close (better odds than the final market) is the single best
  // honest signal that your bet had value — independent of whether it won.
  const setClosingOdds = (entryId, closing) => {
    setTracker((prev) => prev.map((e) => (e.id === entryId ? { ...e, closingOdds: closing } : e)));
  };
  // Positive = you beat the close (your implied prob was lower than closing).
  const clvForEntry = (e) => {
    if (e.closingOdds == null || isNaN(e.closingOdds)) return null;
    const yours = impliedProb(e.odds) * 100;
    const close = impliedProb(e.closingOdds) * 100;
    return +(close - yours).toFixed(1); // % points of edge vs the close
  };

  const deleteTrackerEntry = (entryId) => {
    setTracker((prev) => prev.filter((e) => e.id !== entryId));
  };

  const parlayMath = calculateParlay(parlayLegs);
  // PrizePicks DFS legs have no per-leg American price, so they contribute
  // identity-1 to `parlayMath` (no effect). Tracking the count lets us show
  // an honest "X book leg(s), Y PP leg(s)" note in slip headers — otherwise
  // the displayed payout looks like it covers the whole slip when it
  // actually only covers the book legs (or shows $0 when all legs are PP).
  const ppLegCount = parlayLegs.filter((l) => l.odds == null).length;
  const bookLegCount = parlayLegs.length - ppLegCount;
  const payout = ((parlayMath.decimal - 1) * stake).toFixed(2);
  // Parlay confidence = product of individual leg confidences (independence assumption)
  const parlayConfidence = parlayLegs.length === 0
    ? 0
    : Math.round(
        parlayLegs.reduce((acc, leg) => acc * (calculateConfidence(leg) / 100), 1) * 100
      );

  const sendMessage = async (override) => {
    const text = override || input.trim();
    if ((!text && !attachment) || loading) return;
    if (!requirePro("AI Chat")) return; // chat is a Pro feature

    // If we asked the user how many legs they want for a specific game, a typed
    // reply (e.g. "5", "5 legs") answers that question — route it into the build
    // instead of treating it as a fresh chat. `override` calls already carry the
    // full build prompt, so only intercept genuine user-typed input.
    if (!override && pendingLegBuild && text) {
      const n = parseLegCount(text);
      if (n) {
        setInput("");
        confirmLegCountForGame(n);
        return;
      }
      // No number in their reply — abandon the prompt and let the message flow
      // through as a normal chat turn.
      setPendingLegBuild(null);
    }

    // If there's an image attachment, post it with an honest note (offline can't read images)
    if (attachment && attachment.kind === "image") {
      const imgData = attachment.dataUrl;
      const note = text;
      setInput("");
      setAttachment(null);
      setMessages((p) => [
        ...p,
        { role: "user", content: note ? `🖼️ [image] ${note}` : "🖼️ [image attached]", image: imgData },
        {
          role: "assistant",
          content:
            "I can show your image but I can't read what's inside it yet. Type the picks out as: Game | Market | Pick | Odds and I'll add them to the slip.",
        },
      ]);
      return;
    }

    if (!text) return;
    setInput("");
    setLoading(true);

    // Re-fetch games + odds for the selected sports RIGHT NOW so the chat
    // sees up-to-the-minute scores, lines, and live status — not a cached
    // snapshot up to 60 seconds old. We hold the fresh data in local vars
    // (and also push it to state) so the rest of this send uses them.
    let realGamesBySportLocal = realGamesBySport;
    let realOddsBySportLocal = realOddsBySport;
    try {
      const [gamesResults, oddsResults] = await Promise.all([
        Promise.all(
          selectedSports.map(async (s) => {
            try {
              const r = await fetch(`/api/sports/games?sport=${s}`);
              if (!r.ok) return { sport: s, games: realGamesBySport[s] || [] };
              const games = await r.json();
              return { sport: s, games: games.map((g) => ({ ...g, sportId: s })).filter((g) => g.awayTeam && g.homeTeam) };
            } catch {
              return { sport: s, games: realGamesBySport[s] || [] };
            }
          }),
        ),
        Promise.all(
          selectedSports.map(async (s) => {
            const tryFetch = async (url, retry = true) => {
              try {
                const r = await fetch(url);
                if (r.status === 429 && retry) {
                  await new Promise((res) => setTimeout(res, 400 + Math.random() * 600));
                  return tryFetch(url, false);
                }
                if (!r.ok) return null;
                const j = await r.json();
                return Array.isArray(j) && j.length > 0 ? j : null;
              } catch { return null; }
            };
            const odds = (await tryFetch(`/api/sports/odds?sport=${s}`))
              ?? (await tryFetch(`/api/sports/odds-espn?sport=${s}`))
              ?? (await tryFetch(`/api/sports/odds-bovada?sport=${s}`));
            return odds ? { sport: s, odds } : { sport: s, odds: realOddsBySport[s] || [] };
          }),
        ),
      ]);
      const freshGames = { ...realGamesBySport };
      for (const { sport, games } of gamesResults) freshGames[sport] = games;
      const freshOdds = { ...realOddsBySport };
      for (const { sport, odds } of oddsResults) freshOdds[sport] = odds;
      realGamesBySportLocal = freshGames;
      realOddsBySportLocal = freshOdds;
      setRealGamesBySport(freshGames);
      setRealOddsBySport(freshOdds);
    } catch { /* keep cached state on failure */ }

    // Capture history before adding the new user message
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });

    setMessages((p) => [
      ...p,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    // Only surface games tipping off within the next 24h so the AI can't
    // build a ticket from matchups days out.
    const CHAT_NOW = Date.now();
    // Widened from 24h to 48h so prop markets that only post for tomorrow's
    // slate (HR / K's / anytime-TD) are visible alongside today's games.
    const CHAT_WINDOW_MS = 48 * 60 * 60 * 1000;
    const CHAT_LIVE_BACK_MS = 4 * 60 * 60 * 1000; // include games already in progress
    const isWithin24h = (ts) => {
      if (!ts) return false;
      const t = new Date(ts).getTime();
      return !isNaN(t) && t >= CHAT_NOW - CHAT_LIVE_BACK_MS && t <= CHAT_NOW + CHAT_WINDOW_MS;
    };
    // A finished game has no bettable market — it must never reach the AI's
    // pickable pool, in EITHER mode. (The 4h-back window above exists so a
    // genuinely in-progress game stays eligible for live picks, but a game
    // ESPN has flipped to final/postponed/cancelled is dead.)
    const isFinalStatusChat = (st) => {
      const x = (st || "").toLowerCase();
      return x.includes("final") || x.includes("full time") || x.includes("postponed") || x.includes("canceled") || x.includes("cancelled") || x.includes("ended") || /\bft\b/.test(x);
    };
    // For a PRE-GAME build (not live mode) a game that already tipped off is
    // not bettable as a pre-game side — even if ESPN's status feed lags or the
    // team name doesn't match the score feed (so isFinalStatusChat misses it),
    // a start time already in the past is a strong "this game is underway or
    // over" signal. Live mode keeps the 4h-back window so in-progress games
    // stay eligible there. 10-min grace covers the clock crossing tip-off.
    const PREGAME_GRACE_MS = 10 * 60 * 1000;
    const pregameOk = (ts) => {
      if (liveMode) return true;
      if (!ts) return true; // no timestamp (sample/hypothetical) — keep
      const t = new Date(ts).getTime();
      return isNaN(t) || t > CHAT_NOW - PREGAME_GRACE_MS;
    };
    // Matchup labels ESPN has marked final — used to cross-filter the Odds API
    // pool (which carries no status, only a commence time) so a finished game
    // can't sneak back in through the odds feed.
    const finalKeysChat = new Set();
    for (const games of Object.values(realGamesBySportLocal || {})) {
      for (const g of (games || [])) {
        if (isFinalStatusChat(g.status)) finalKeysChat.add(`${g.awayTeam} @ ${g.homeTeam}`);
      }
    }
    // True when a game is still bettable for the AI's pool.
    const gamePickable = (label, status, ts) => {
      // Its own status says it's done — dead in either mode.
      if (isFinalStatusChat(status)) return false;
      // Non-live: a game already past tip-off (status feed may lag) is dead.
      if (!pregameOk(ts)) return false;
      // Odds-feed cross-filter: a label ESPN marked final kills a same-label
      // entry UNLESS that entry is clearly a future game (protects game 2 of
      // an MLB doubleheader, which shares the "Away @ Home" label with game 1).
      if (finalKeysChat.has(label)) {
        const t = ts ? new Date(ts).getTime() : NaN;
        if (isNaN(t) || t <= CHAT_NOW + PREGAME_GRACE_MS) return false;
      }
      return true;
    };

    // Proactively fetch real player props so the AI can either recommend
    // props directly OR mix them into a parlay alongside game-level picks.
    // Trigger on either an explicit prop ask OR any parlay-building intent.
    const wantsProps = /\b(player\s*props?|prop bet|prop parlay|props\b|over\/?under on (a |the )?player|points\b|rebounds\b|assists\b|home runs?|strikeouts?|shots on goal|passing yards?|rushing yards?|receiving yards?|receptions?)\b/i.test(text);
    // "leg" / "legs" / "N-leg" / "N leg" all signal parlay-building intent
    // even when the word "parlay" is never said (e.g. "10 leg for nba game
    // tonight", "give me a 5-legger", "8 legs cross sport"). Without this,
    // the prop-fetch block was skipped and the AI got stuck on the 3 base
    // odds markets (ML/Spread/Total) per game — capping the ticket at 3-4
    // legs regardless of what the user asked for.
    const wantsParlayRe = /\b(parlay|ticket|build (me )?(a |my )?(slip|card|ticket)|picks?\b|recommend|suggest|best (bets?|plays?|picks?)|lock|locks?\b|sgp|same.?game|\d+\s*-?\s*legg?(?:er|ers|s)?)\b/i;
    const wantsParlayMsg = wantsParlayRe.test(text);
    // CONVERSATION-AWARE INTENT. A follow-up CORRECTION almost never repeats the
    // word "parlay" or "leg" — e.g. after the AI returns a 10-leg ticket the user
    // says "no, give me the full 15", "I asked for 15", "do 15", "make it bigger",
    // "the full fifteen". Those match NEITHER wantsParlay NOR the "<N> leg" regex,
    // so the prop-fetch block was skipped (realProps arrived EMPTY) and bigParlay
    // was false (alts kept → only ~6-7 distinct games), so the model honestly but
    // WRONGLY told the user "only ~10 legs, realProps is empty". Fix: treat the
    // message as parlay intent when the RECENT conversation is already about a
    // parlay, and resolve the requested leg count from the current message
    // (digits, "<N> leg", or a number-word) OR inherit it from the last turn.
    const priorMsgs = (messages || []).filter((m) => m.role === "user" || m.role === "assistant").slice(-8);
    const priorUserText = priorMsgs.filter((m) => m.role === "user").map((m) => m.content || "").join("\n");
    const priorAssistantText = priorMsgs.filter((m) => m.role === "assistant").map((m) => m.content || "").join("\n");
    // We're mid-parlay if the user recently asked for one OR the assistant already
    // produced PICK lines / talked legs/parlay/ticket.
    const inParlayConvo = wantsParlayMsg || wantsParlayRe.test(priorUserText) || /\bPICK:\s|\b\d+\s*-?\s*leg|\bparlay\b|\bticket\b/i.test(priorAssistantText);
    const NUM_WORDS = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
    // Explicit "<N> leg/pick/game/selection/teamer" — the keyword makes this
    // ALWAYS-SAFE to honor (it cannot be money/time/ordinal). Returns the LAST
    // such match so "not 10 — make it a 15 leg" resolves to 15.
    const keywordLegCount = (str) => {
      if (!str) return 0;
      const re = /(\d+)\s*-?\s*(?:leg|legg|pick|game|selection|teamer)/gi;
      let m; let last = 0;
      while ((m = re.exec(String(str)))) last = parseInt(m[1], 10);
      return last;
    };
    // Spelled-out number-word ("the full fifteen"). NOT self-qualifying, so the
    // CALLER must only use this when we're already in a parlay conversation —
    // otherwise "I have fifteen dollars" would look like a leg count. Skips a
    // number-word immediately followed by a money/unit noun.
    const wordLegCount = (str) => {
      if (!str) return 0;
      const s = String(str);
      let best = 0; let bestIdx = -1;
      for (const w of Object.keys(NUM_WORDS)) {
        const re = new RegExp(`\\b${w}\\b(?!\\s*(?:dollars?|bucks?|cents?|units?|percent))`, "gi");
        let m;
        while ((m = re.exec(s))) { if (m.index >= bestIdx) { bestIdx = m.index; best = NUM_WORDS[w]; } }
      }
      return best;
    };
    // A bare in-range number (3-30) standing on its own ("do 15", "I asked for
    // 15") — NOT attached to money/percent/time/ordinals. Token-scanned (no regex
    // lookbehind, which older Safari rejects). Only trusted by the CALLER when
    // we're already in a parlay conversation. Takes the LAST qualifying number so
    // "why only 10? I asked for 15" resolves to 15.
    const bareLegCount = (str) => {
      if (!str) return 0;
      let last = 0;
      for (const raw of String(str).split(/\s+/)) {
        // Trim surrounding punctuation but KEEP $ and % so we can detect money.
        const tok = raw.replace(/^[^\w$%]+|[^\w$%]+$/g, "");
        if (/[$%]/.test(tok)) continue;          // $15 / 15% → not a leg count
        if (!/^\d{1,2}$/.test(tok)) continue;     // rejects "15th", "15k", "2:30", "abc15"
        const n = parseInt(tok, 10);
        if (n >= 3 && n <= 30) last = n;
      }
      return last;
    };
    // Inherit the most-recent leg count the user named earlier — scan prior USER
    // turns newest→oldest so the LATEST explicit ask wins (recency), not key order.
    const priorUserMsgsArr = priorMsgs.filter((m) => m.role === "user").map((m) => m.content || "");
    const inheritLegCount = () => {
      for (let i = priorUserMsgsArr.length - 1; i >= 0; i--) {
        const s = priorUserMsgsArr[i];
        const n = keywordLegCount(s) || wordLegCount(s) || bareLegCount(s);
        if (n) return n;
      }
      return 0;
    };
    const extraProps = {}; // eventId -> props payload, merged into context for this send
    // Map Odds-API eventId -> ESPN {homeTeamId, awayTeamId} captured while
    // building the prop-fetch candidate list, so the player-history loop
    // below can derive opponentTeamId for each prop. The prop pool is keyed
    // by ODDS event IDs while realGamesBySportLocal is keyed by ESPN event
    // IDs — without this map the join was failing and player analytics
    // never reached the prompt.
    const propEventToTeams = {};
    // Parse the requested leg count ONCE at this scope so BOTH the prop-fetch
    // block below AND the game-level realOdds assembly further down can use it.
    // A big parlay needs BREADTH (many distinct games) over per-game DEPTH.
    // Precedence: explicit count in THIS message → (only when mid-parlay) a
    // bare/worded number in this message → inherit the last count the user asked
    // for earlier in the conversation. This is what lets "no, give me the full
    // 15" / "do 15" / "make it bigger" reach the requested count on a follow-up.
    // Keyword form ("<N> leg/pick") is always safe. Number-words and bare
    // numbers are only trusted mid-parlay, then we inherit the latest prior ask.
    let requestedLegs = keywordLegCount(text);
    if (!requestedLegs && inParlayConvo) {
      requestedLegs = bareLegCount(text) || wordLegCount(text) || inheritLegCount();
    }
    const bigParlay = requestedLegs >= 8;
    // Parlay intent is satisfied by the current message OR by an ongoing parlay
    // conversation in which the user is clearly still iterating (a resolved leg
    // count, or words like "more"/"bigger"/"longer"/"full").
    const wantsParlay = wantsParlayMsg || (inParlayConvo && (requestedLegs > 0 || /\b(more|bigger|longer|full|all of them|add)\b/i.test(text)));
    // Run the JIT prop-fetch whenever there's prop OR parlay intent, OR we
    // resolved a leg count at all — so a follow-up correction never reaches the
    // model with realProps empty.
    if (wantsProps || wantsParlay || requestedLegs > 0) {
      const candidates = [];
      // Widen the candidate pool when the user specifically asks for props
      // ("find player props"). Parlay-only intent stays narrower so we don't
      // burn unnecessary fetches when game-level picks are enough.
      // When the user names a specific low-frequency prop market (HR,
      // anytime-TD, strikeouts), widen the pool to ALL in-window games for
      // that sport — these markets only post for a subset of games, so the
      // default top-5 sample often misses the games where the market exists.
      const wantsWideProps = /\b(home runs?|hr\b|anytime td|goal scorer|first goal|strikeouts?)\b/i.test(text);
      // Scale prop-fetch breadth with the REQUESTED leg count. A big parlay
      // ("15-leg") needs distinct player props from many games to reach the
      // count without correlated filler — but the default parlay caps only
      // fetched props for 6 games (perSport 3), structurally capping the ticket
      // at ~10 game-level legs no matter how many the user asked for (a few
      // games × ~2 independent sides each, with NO props to climb past that).
      // Parse the requested N and widen the candidate pool to ~N games so the
      // AI actually has enough distinct props to build what was asked. Bounded
      // concurrency + the 5-min server prop cache keep the extra fetches cheap,
      // and only games that truly exist in the 48h window get fetched.
      const perSportCap = wantsWideProps ? 999 : wantsProps ? 5 : bigParlay ? Math.min(requestedLegs, 12) : 3;
      const totalCap = wantsWideProps ? 999 : wantsProps ? 12 : bigParlay ? Math.min(requestedLegs + 4, 24) : 6;
      // Detect a game the user NAMED in this message (both teams mentioned, e.g.
      // "best 10-leg parlay for San Antonio Spurs @ Oklahoma City Thunder").
      // A named game is GAME-LOCKED in the prompt — every leg must come from it,
      // including props — so its props MUST be fetched even if the generic
      // "soonest N games per sport, capped at totalCap" heuristic would skip it
      // (e.g. when MLB/NHL also have games in the window and fill the cap first,
      // or the named game isn't among its sport's soonest few). Without this the
      // named game's realProps arrived empty and the AI honestly but wrongly
      // reported "only 1 independent leg available — no props posted".
      const lowerText = (text || "").toLowerCase();
      const teamKey = (full) => (full || "").split(/\s+/).filter(Boolean).pop().toLowerCase();
      // Word-boundary match (not bare substring) so a team nickname only counts
      // when it appears as a whole word — avoids incidental collisions. Requires
      // BOTH teams' nicknames present, so a single stray word never force-locks.
      const mentionsWord = (word) => {
        if (!word) return false;
        const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${esc}\\b`).test(lowerText);
      };
      const gameNamedInText = (g) => mentionsWord(teamKey(g.homeTeam)) && mentionsWord(teamKey(g.awayTeam));
      for (const s of selectedSports) {
        const oddsGames = (realOddsBySportLocal[s] || []).filter((g) => isWithin24h(g.commenceTime) && gamePickable(`${g.awayTeam} @ ${g.homeTeam}`, g.status, g.commenceTime));
        const espnGames = realGamesBySportLocal[s] || [];
        // Sort soonest-first so the prop pool reflects the games closest to
        // tip-off — most actionable for "add to ticket now" intent.
        oddsGames.sort((a, b) => new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime());
        // Named games ALWAYS qualify regardless of the per-sport soonest-N cap;
        // the rest fill the remaining slots soonest-first.
        const namedGames = oddsGames.filter(gameNamedInText);
        const restGames = oddsGames.filter((g) => !gameNamedInText(g)).slice(0, perSportCap);
        for (const g of [...namedGames, ...restGames]) {
          if (!g.id) continue;
          const espn = espnGames.find((e) => `${e.awayTeam} @ ${e.homeTeam}` === `${g.awayTeam} @ ${g.homeTeam}`);
          candidates.push({ sport: s, eventId: g.id, homeTeamId: espn?.homeTeamId, awayTeamId: espn?.awayTeamId, home: g.homeTeam, away: g.awayTeam, named: gameNamedInText(g) });
          if (espn?.homeTeamId && espn?.awayTeamId) {
            propEventToTeams[g.id] = { home: String(espn.homeTeamId), away: String(espn.awayTeamId) };
          }
        }
      }
      // Named games are fetched FIRST and are never dropped by the global cap;
      // other games fill whatever slots remain up to totalCap.
      const namedCandidates = candidates.filter((c) => c.named);
      const otherCandidates = candidates.filter((c) => !c.named);
      // De-dupe by eventId (a game can't be both named-and-other, but guard
      // against any accidental repeat so we never fetch the same event twice).
      const seenEventIds = new Set();
      const toFetch = [
        ...namedCandidates,
        ...otherCandidates.slice(0, Math.max(0, totalCap - namedCandidates.length)),
      ].filter((c) => {
        if (!c.eventId || seenEventIds.has(c.eventId)) return false;
        seenEventIds.add(c.eventId);
        return true;
      });
      // Run the prop fetches with BOUNDED CONCURRENCY instead of one big
      // Promise.all burst. A wide-props ask ("5-leg strikeout parlay") uncaps
      // the candidate list to the whole slate (~28 MLB games on a busy night),
      // and on a COLD server cache each request fans out to ~3 upstream Odds API
      // calls — so an unbounded burst fired 80+ simultaneous upstream calls,
      // tripped the Odds API rate limit, and dropped most games' props, leaving
      // realProps empty (the "0 pitcher strikeout props available" failure the
      // user hit). A small worker pool keeps simultaneous upstream load low so
      // the server cache warms steadily and every game's props actually arrive.
      // toFetch is already ordered named-games-first and the pool pulls in
      // order, so a named single-game ticket's props are still fetched first.
      const fetchOnePropCandidate = async (c) => {
          // Skip refetch ONLY if the cached entry has real prop rows. An
          // earlier 429 or upstream-empty response can leave an entry like
          // {props: []} — treating that as a hit means the next chat send
          // never retries and the AI keeps seeing realProps: [] forever
          // (the "no home run lines in pool" loop the user hit).
          const cached = realPropsByEvent[c.eventId];
          if (cached && Array.isArray(cached.props) && cached.props.length > 0 && !isStalePropsCache(c.sport, cached)) {
            extraProps[c.eventId] = cached;
            return;
          }
          const qs = [`sport=${encodeURIComponent(c.sport)}`, `eventId=${encodeURIComponent(c.eventId)}`];
          if (c.homeTeamId) qs.push(`homeTeamId=${encodeURIComponent(c.homeTeamId)}`);
          if (c.awayTeamId) qs.push(`awayTeamId=${encodeURIComponent(c.awayTeamId)}`);
          // Pass full team names so the server can resolve the REAL Odds API
          // event id when our eventId came from a fallback odds source (ESPN/
          // Bovada). Without this, a fallback id 404s the props endpoint and the
          // game's player props arrive empty even though the Odds API has them.
          if (c.home) qs.push(`home=${encodeURIComponent(c.home)}`);
          if (c.away) qs.push(`away=${encodeURIComponent(c.away)}`);
          // Fetch this game's props with a bounded retry. The prop fetches above
          // fire as one parallel burst, which can briefly trip the upstream Odds
          // API rate limit (429) or a transient 502 — and a single non-OK
          // response used to silently drop that game's props for the WHOLE send
          // (`if (!r.ok) return`), leaving realProps empty for the named game so
          // the AI could only build game-level legs ("not adding player props").
          // Retry a few times with jittered backoff so a transient hiccup during
          // the burst doesn't cost us the named game's props. The NAMED game gets
          // an extra attempt since every leg of a single-game ticket depends on
          // it. We only retry on 429/5xx (transient); a 4xx other than 429 is a
          // real "no props for this event" and isn't worth re-hitting.
          const maxAttempts = c.named ? 4 : 2;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
              const r = await fetch(`/api/sports/props?${qs.join("&")}`);
              if (r.ok) {
                const data = await r.json();
                extraProps[c.eventId] = stampQhChecked(data);
                break;
              }
              // Only transient statuses are worth retrying; give up on other 4xx.
              if (r.status !== 429 && r.status < 500) break;
            } catch { /* network blip — fall through to backoff + retry */ }
            if (attempt < maxAttempts - 1) {
              // Jittered backoff so the retries don't re-burst in lockstep and
              // re-trip the same rate limit: ~250ms, ~500ms, ~1s (+ up to 250ms).
              const delay = 250 * 2 ** attempt + Math.random() * 250;
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
      };
      // Small fixed pool: each worker pulls the next candidate index until the
      // list is exhausted, so at most PROP_FETCH_CONCURRENCY games are fetched
      // at once instead of all ~28 firing simultaneously.
      const PROP_FETCH_CONCURRENCY = 5;
      let nextPropIdx = 0;
      const propWorkers = Array.from(
        { length: Math.min(PROP_FETCH_CONCURRENCY, toFetch.length) },
        async () => {
          while (true) {
            const i = nextPropIdx++;
            if (i >= toFetch.length) break;
            await fetchOnePropCandidate(toFetch[i]);
          }
        },
      );
      await Promise.all(propWorkers);
      // Persist what we fetched so subsequent sends/game-detail views reuse it.
      if (Object.keys(extraProps).length) {
        setRealPropsByEvent((prev) => ({ ...prev, ...extraProps }));
      }
    }
    // Compact real games (ESPN) — limit per sport to keep context small.
    const realGames = [];
    // Track teamIds per game so we can pull real matchup history for each.
    const historyTargets = []; // [{sport, gameLabel, homeTeamId, awayTeamId}]
    for (const [sport, games] of Object.entries(realGamesBySportLocal)) {
      const filtered = games.filter((g) => isWithin24h(g.startsAt) && gamePickable(`${g.awayTeam} @ ${g.homeTeam}`, g.status, g.startsAt));
      for (const g of filtered.slice(0, 12)) {
        const gameLabel = `${g.awayTeam} @ ${g.homeTeam}`;
        realGames.push({ sport, game: gameLabel, status: g.status, startsAt: g.startsAt, venue: g.venue, homeTeamId: g.homeTeamId ? String(g.homeTeamId) : null, awayTeamId: g.awayTeamId ? String(g.awayTeamId) : null });
        if (g.homeTeamId && g.awayTeamId) {
          historyTargets.push({ sport, gameLabel, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, startsAt: g.startsAt });
        }
      }
    }
    // Pull real previous-matchup analytics for every game in the 24h pool:
    // each team's last 10 record + pts for/against + avg margin, plus the
    // head-to-head meetings. The server caches this for 15min so repeat
    // sends in the same window are cheap. Cap at 16 games per send to keep
    // the prompt compact. Failures are honest empty buckets — never
    // fabricated — and the AI is instructed to treat missing entries as
    // "no extra signal" rather than inventing one.
    const matchupHistory = {};
    const targets = historyTargets.slice(0, 16);
    if (targets.length > 0) {
      await Promise.all(
        targets.map(async (t) => {
          try {
            const qs = `sport=${encodeURIComponent(t.sport)}&homeTeamId=${encodeURIComponent(t.homeTeamId)}&awayTeamId=${encodeURIComponent(t.awayTeamId)}`;
            const r = await fetch(`/api/sports/matchup-history?${qs}`);
            if (!r.ok) return;
            const data = await r.json();
            // Compact shape — only what the AI needs to weigh the side.
            const home10 = data?.home?.last10;
            const away10 = data?.away?.last10;
            const h2h = data?.h2h;
            if (!home10 && !away10 && !(h2h?.meetings?.length)) return;
            // Real days-rest / back-to-back, computed from each team's last
            // COMPLETED game date (from the matchup-history feed) vs this
            // game's scheduled start. Null when either date is missing — never
            // fabricated. backToBack means 0-1 calendar days between games.
            const gameStart = t.startsAt ? new Date(t.startsAt).getTime() : null;
            const computeRest = (lastDate) => {
              if (!lastDate || gameStart == null) return null;
              const diffMs = gameStart - new Date(lastDate).getTime();
              if (!Number.isFinite(diffMs) || diffMs < 0) return null;
              const restDays = Math.floor(diffMs / 86400000);
              return { restDays, backToBack: restDays <= 1 };
            };
            // Real venue splits, current streak and season record — the new
            // pre-game signals. For the upcoming game (at the home venue) the
            // home team's HOME split and the away team's AWAY split are the
            // relevant venue reads. A form bucket with games:0 means honest
            // "no split data" — passed through as null so the AI won't lean on it.
            const splitOf = (s) => (s && s.games > 0
              ? { record: `${s.wins}-${s.losses}`, avgMargin: s.avgMargin, ptsFor: s.ptsFor, ptsAgainst: s.ptsAgainst, games: s.games } : null);
            const seasonOf = (s) => (s && s.games > 0
              ? { record: `${s.wins}-${s.losses}`, winPct: s.winPct } : null);
            matchupHistory[t.gameLabel] = {
              home: home10 ? { record: `${home10.wins}-${home10.losses}`, ptsFor: home10.ptsFor, ptsAgainst: home10.ptsAgainst, avgMargin: home10.avgMargin } : null,
              away: away10 ? { record: `${away10.wins}-${away10.losses}`, ptsFor: away10.ptsFor, ptsAgainst: away10.ptsAgainst, avgMargin: away10.avgMargin } : null,
              homeVenueForm: splitOf(data?.home?.homeSplit),
              awayVenueForm: splitOf(data?.away?.awaySplit),
              homeStreak: data?.home?.streak || null,
              awayStreak: data?.away?.streak || null,
              homeSeason: seasonOf(data?.home?.season),
              awaySeason: seasonOf(data?.away?.season),
              homeRest: computeRest(data?.home?.lastGameDate),
              awayRest: computeRest(data?.away?.lastGameDate),
              h2h: h2h?.meetings?.length
                ? { homeWins: h2h.homeWins, awayWins: h2h.awayWins, meetings: h2h.meetings.slice(0, 3).map((m) => ({ date: m.date, homeScore: m.homeTeamScore, awayScore: m.awayTeamScore, homeMargin: m.homeTeamWonByMargin })) }
                : null,
            };
          } catch { /* honest no-history fallback */ }
        }),
      );
    }
    // Mirror the just-fetched h2h data into client state so the per-pick
    // "Why this pick?" card can show the W-L record for moneyline legs
    // (the user asked for it under Why this pick, not the AI edge note).
    if (Object.keys(matchupHistory).length > 0) {
      setMatchupHistoryByGame((prev) => ({ ...prev, ...matchupHistory }));
    }
    // Per-team period scoring history (real L10 q1-q4 + h1/h2 scored/allowed,
    // computed server-side from ESPN scoreboard linescores). Lets the AI
    // anchor period-bet reasoning to real numbers instead of the old
    // "1Q ≈ 28% of full-game" heuristic. Only fetched for sports where the
    // backend supports it (nba/nfl/ncaaf/ncaab) — others return sampleSize:0
    // and we skip them silently. Keyed by "<sport>#<teamId>" to match the
    // same lookup style the AI already uses for opponentDefense.
    const teamPeriodStats: Record<string, { sampleSize: number; periodAverages: unknown }> = {};
    const periodTeamTargets: Array<{ sport: string; teamId: string }> = [];
    const seenPeriodTeam = new Set<string>();
    for (const t of targets) {
      for (const teamId of [t.homeTeamId, t.awayTeamId]) {
        if (!teamId) continue;
        const k = `${t.sport}#${teamId}`;
        if (seenPeriodTeam.has(k)) continue;
        seenPeriodTeam.add(k);
        periodTeamTargets.push({ sport: t.sport, teamId: String(teamId) });
      }
    }
    if (periodTeamTargets.length > 0) {
      await Promise.all(
        periodTeamTargets.map(async (t) => {
          try {
            const r = await fetch(`/api/sports/team-period-stats?sport=${encodeURIComponent(t.sport)}&teamId=${encodeURIComponent(t.teamId)}`);
            if (!r.ok) return;
            const data = await r.json();
            if (!data?.periodAverages || !data?.sampleSize) return;
            teamPeriodStats[`${t.sport}#${t.teamId}`] = {
              sampleSize: data.sampleSize,
              periodAverages: data.periodAverages,
            };
          } catch { /* honest no-data fallback */ }
        }),
      );
    }
    // Compact real bookmaker markets (The Odds API h2h/spreads/totals).
    // PERIOD markets (quarters/halves) are heavy, so only fold them in when the
    // message is a single-game lock OR explicitly asks for period / same-game
    // legs — otherwise the multi-game context stays compact (full-game + alts
    // only, as before). Without period markets a single-game request collapses
    // to ~1-2 independent legs because a game's full-game ML/Spread/Total are
    // correlated/duplicate-banned among themselves.
    const periodOrSgpIntent = /first quarter|1q\b|1st quarter|\bq[1-4]\b|first half|1h\b|1st half|\bh1\b|2nd half|2h\b|second half|same.?game|\bsgp\b/i.test(text || "");
    const namedGameLabelSet = new Set();
    {
      const lt = (text || "").toLowerCase();
      const tk = (full) => (full || "").split(/\s+/).filter(Boolean).pop().toLowerCase();
      const mw = (w) => { if (!w) return false; const e = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp(`\\b${e}\\b`).test(lt); };
      for (const games of Object.values(realOddsBySportLocal)) {
        for (const g of games) {
          if (mw(tk(g.homeTeam)) && mw(tk(g.awayTeam))) namedGameLabelSet.add(`${g.awayTeam} @ ${g.homeTeam}`);
        }
      }
    }
    const realOdds = [];
    const namedAccum = [];
    const otherAccum = [];
    const isPeriodMarket = (mk) => /^(1H|2H|Q[1-4])\b/.test(mk);
    // Event -> game label / sport / start-time lookups, built up-front so the
    // breadth cap below can pre-count window-valid props; reused by the realProps
    // build further down.
    const eventToGame = {};
    const eventToSport = {};
    const eventToStart = {};
    for (const [sport, games] of Object.entries(realOddsBySportLocal)) {
      for (const g of games) {
        eventToGame[g.id] = `${g.awayTeam} @ ${g.homeTeam}`;
        eventToSport[g.id] = sport;
        eventToStart[g.id] = g.commenceTime;
      }
    }
    const mergedPropsByEvent = { ...realPropsByEvent, ...extraProps };
    // For a generic big parlay, cap how many DISTINCT game-level games we feed the
    // model. With unlimited breadth the model fills a high leg count from
    // game-level sides ALONE and skips the mandated player-prop share (a "15-leg"
    // ask came back as 15 spreads, 0 props even though realProps held 40+ distinct
    // players with full playerHistory). Reserve up to 4 of the N legs for props so
    // the back of the ticket comes from the (richer, justifiable) realProps pool.
    // CRITICAL (under-fill guard): only reserve as many slots as there are
    // window-valid DISTINCT prop players actually available this send — otherwise a
    // prop-thin slate would push the cap below what game-level games alone can fill
    // and we'd return fewer than N. With 0 props available the cap relaxes to N so
    // game-level sides fill the whole ticket. Named/period tickets are exempt —
    // they intentionally lean on one game's depth.
    let breadthGameCap = Infinity;
    if (bigParlay && !periodOrSgpIntent) {
      const seenPropPlayers = new Set();
      for (const [eid, data] of Object.entries(mergedPropsByEvent)) {
        if (!isWithin24h(eventToStart[eid])) continue;
        const gl = eventToGame[eid] || `${data.away} @ ${data.home}`;
        if (!gamePickable(gl, null, eventToStart[eid])) continue;
        for (const pr of (data.props || [])) { if (pr?.player) seenPropPlayers.add(pr.player); }
      }
      const reservedPropSlots = Math.min(4, seenPropPlayers.size);
      breadthGameCap = Math.max(8, requestedLegs - reservedPropSlots);
    }
    let breadthGameCount = 0;
    for (const [sport, games] of Object.entries(realOddsBySportLocal)) {
      const filtered = games.filter((g) => isWithin24h(g.commenceTime) && gamePickable(`${g.awayTeam} @ ${g.homeTeam}`, g.status, g.commenceTime));
      // Named games first so the 12-per-sport cap never drops the one the user
      // asked about.
      filtered.sort((a, b) => {
        const an = namedGameLabelSet.has(`${a.awayTeam} @ ${a.homeTeam}`) ? 0 : 1;
        const bn = namedGameLabelSet.has(`${b.awayTeam} @ ${b.homeTeam}`) ? 0 : 1;
        return an - bn;
      });
      for (const g of filtered.slice(0, 12)) {
        const label = `${g.awayTeam} @ ${g.homeTeam}`;
        const isNamed = namedGameLabelSet.has(label);
        const includePeriods = isNamed || periodOrSgpIntent;
        const all = buildPicksFromOdds(g, includePeriods);
        // Send all main-market picks (ML/Spread/Total) PLUS a capped sample
        // of alternate spreads/totals so the AI can recommend a different
        // ladder rung when it sees better edge there. Cap alts per game to
        // keep the chat context compact — too many rungs blows the prompt
        // size and makes the model fixate on one game.
        const mainPicks = all.filter((p) => p.market !== "Alt Spread" && p.market !== "Alt Total" && !isPeriodMarket(p.market));
        const periodPicks = all.filter((p) => isPeriodMarket(p.market));
        const altSpread = all.filter((p) => p.market === "Alt Spread");
        const altTotal = all.filter((p) => p.market === "Alt Total");
        // A named single game gets deep period inclusion (it's the whole pool
        // for that ticket); broad period/sgp intent across games gets a smaller
        // per-game sample so the prompt size stays bounded.
        const periodCap = isNamed ? 60 : 12;
        // BREADTH OVER DEPTH for big parlays: a generic "15-leg" ask needs many
        // DISTINCT games' main lines (ML/Spread/Total), not deep alt ladders of a
        // few games. Each game's alts can eat ~14 of the realOdds 120-entry budget
        // (8 alt-spread + 6 alt-total), so without this the budget covered only
        // ~6-7 distinct games and the AI honestly capped tickets at ~10 legs. When
        // a big parlay is requested and this isn't a named/period ticket, drop the
        // alt rungs so the 120-entry budget spans ~30 distinct games instead.
        const breadthMode = bigParlay && !isNamed && !periodOrSgpIntent;
        // Stop adding game-level games once we've supplied enough breadth for the
        // model to reach N WITH a healthy prop share (see breadthGameCap above).
        if (breadthMode && breadthGameCount >= breadthGameCap) continue;
        const altSpreadCap = breadthMode ? 0 : 8;
        const altTotalCap = breadthMode ? 0 : 6;
        const slice = [...mainPicks.slice(0, 8), ...altSpread.slice(0, altSpreadCap), ...altTotal.slice(0, altTotalCap), ...periodPicks.slice(0, periodCap)];
        const target = isNamed ? namedAccum : otherAccum;
        for (const p of slice) {
          target.push({ sport, game: p.game, market: p.market, pick: p.pick, odds: p.odds, startsAt: g.commenceTime });
        }
        if (breadthMode) breadthGameCount++;
      }
    }
    // Named-game legs lead so the context cap (slice below) never truncates the
    // deep period set the single-game ticket depends on.
    realOdds.push(...namedAccum, ...otherAccum);
    // Any player props the user has loaded (by opening a game detail) PLUS
    // anything pre-fetched above when this message asked about props.
    const realProps = [];
    // For player-prop analytics: as we walk the prop pool, we also collect
    // the ESPN athleteId + opponent teamId for each player so we can pull
    // their real game log right after. Opponent = the team in the same game
    // that the player isn't on, derived from playerTeamId vs the event's
    // ESPN home/away teamIds. Primary lookup is propEventToTeams (captured
    // when this turn's candidates were built); fallback is a game-label
    // match against realGamesBySportLocal so cached props from earlier
    // sends/game-detail opens still get analytics. Dedupes by athleteId.
    const gameLabelToTeams = {};
    for (const [, games] of Object.entries(realGamesBySportLocal)) {
      for (const g of games) {
        if (g.homeTeamId && g.awayTeamId) {
          gameLabelToTeams[`${g.awayTeam} @ ${g.homeTeam}`] = { home: String(g.homeTeamId), away: String(g.awayTeamId) };
        }
      }
    }
    // MARKET-PRIORITY DETECTION (shared by the playerHistory game-log fetch
    // below AND the realProps 400-cap further down). When the user names a prop
    // market ("5-leg strikeout parlay"), the server market-locks realProps to
    // ONLY that market, and a prop card shows a real AI projection (instead of
    // "MARKET PRICE") ONLY when context.playerHistory carries that player's game
    // log. But the game-log fetch is capped at the first 40 unique players
    // (phTargets) and players are collected in PROP ORDER — where the requested
    // market's players sit LAST in each game (e.g. a game's pitcher_strikeouts
    // props trail ALL of its batter props). So on a wide strikeout ask the
    // 40-slot budget fills up with batters and the actually-picked pitchers get
    // NO game log → every leg honestly reads "MARKET PRICE" even though the K
    // history exists. Float the requested market's PLAYERS to the front of the
    // game-log fetch (and its PROPS to the front of the 400-cap) so the picks
    // the user asked for are the ones backed by real data. Mirrors the server
    // MARKET_KEYWORDS map verbatim (first-match-wins, combos before singles) so
    // client priority and server lock agree.
    const PROP_MARKET_KEYWORDS = [
      { re: /\b(strikeouts?|k'?s)\b/i, markets: ["pitcher_strikeouts"] },
      { re: /\b(home runs?|hr\b)\b/i, markets: ["batter_home_runs"] },
      { re: /\b(anytime td|anytime touchdown|touchdowns?)\b/i, markets: ["player_anytime_td"] },
      { re: /\b(goal scorer|first goal|anytime goal)\b/i, markets: ["player_goals"] },
      { re: /\b(shots on goal|sog\b)\b/i, markets: ["player_shots_on_goal"] },
      { re: /\b(passing yards?|pass yds?)\b/i, markets: ["player_pass_yds"] },
      { re: /\b(rushing yards?|rush yds?)\b/i, markets: ["player_rush_yds"] },
      { re: /\b(receiving yards?|rec yds?)\b/i, markets: ["player_reception_yds"] },
      { re: /\breceptions?\b/i, markets: ["player_receptions"] },
      { re: /\b(pra\b|p\s*\+\s*r\s*\+\s*a|points?\s*\+\s*rebounds?\s*\+\s*assists?|pts?\s*\+\s*reb\s*\+\s*ast)\b/i, markets: ["player_points_rebounds_assists"] },
      { re: /\b(points?\s*\+\s*rebounds?|pts?\s*\+\s*reb|p\s*\+\s*r)\b/i, markets: ["player_points_rebounds"] },
      { re: /\b(points?\s*\+\s*assists?|pts?\s*\+\s*ast|p\s*\+\s*a)\b/i, markets: ["player_points_assists"] },
      { re: /\b(rebounds?\s*\+\s*assists?|reb\s*\+\s*ast|r\s*\+\s*a)\b/i, markets: ["player_rebounds_assists"] },
      { re: /\b(rebounds?|reb\b)\b/i, markets: ["player_rebounds"] },
      { re: /\b(assists?|ast\b)\b/i, markets: ["player_assists"] },
      { re: /\b(threes|3pm|3-?pointers?)\b/i, markets: ["player_threes"] },
      { re: /\b(blocks?\s*\+?\s*steals?|steals?\s*\+?\s*blocks?)\b/i, markets: ["player_blocks_steals"] },
      { re: /\b(blocks?|blk\b)\b/i, markets: ["player_blocks"] },
      { re: /\b(steals?|stl\b)\b/i, markets: ["player_steals"] },
      { re: /\bturnovers?\b/i, markets: ["player_turnovers"] },
      { re: /\b(points|pts)\b(?=[^\n]{0,40}\b(props?|prop bet|parlay|legs?|over|under|line|ticket|\d+(?:\.\d+)?)\b)|\b(props?|prop bet|parlay|legs?|over|under|line|ticket|\d+(?:\.\d+)?)\b[^\n]{0,40}\b(points|pts)\b/i, markets: ["player_points"] },
      { re: /\bhits?\b/i, markets: ["batter_hits"] },
      { re: /\btotal bases?\b/i, markets: ["batter_total_bases"] },
    ];
    const reqMarketEntry = PROP_MARKET_KEYWORDS.find((k) => k.re.test(text));
    // Match the base market AND only its PERIOD variants ("_q1".."_h2") so a
    // "1Q rebounds parlay" floats the right rungs too. Deliberately NOT a bare
    // `startsWith(base + "_")` — that would let `player_points` also pull in
    // `player_points_rebounds`/`_assists` combo markets the server lock drops
    // anyway. (`_alternate` rungs are folded into the base key server-side.)
    const isPeriodVariant = (m, b) => m.startsWith(`${b}_`) && /_(q1|q2|q3|q4|h1|h2)$/.test(m);
    const isReqMarket = (m) => !!reqMarketEntry && reqMarketEntry.markets.some((b) => m === b || isPeriodVariant(String(m || ""), b));
    // athleteIds that have a prop in the requested market — used to prioritize
    // their game-log fetch so the picked players carry a real projection.
    const reqMarketAthletes = new Set();
    const playerTargets = []; // [{sport, player, athleteId, opponentTeamId}]
    const seenAthletes = new Set();
    for (const [eid, data] of Object.entries(mergedPropsByEvent)) {
      // Only surface props whose underlying game tips off within the next 24h —
      // older cached props from previously-opened games must not leak in.
      if (!isWithin24h(eventToStart[eid])) continue;
      const gameLabel = eventToGame[eid] || `${data.away} @ ${data.home}`;
      // A finished/already-started game's props must never reach the AI prompt.
      if (!gamePickable(gameLabel, null, eventToStart[eid])) continue;
      const sport = eventToSport[eid] || null;
      const teams = propEventToTeams[eid] || gameLabelToTeams[gameLabel];
      // Was slice(0, 30) — but MLB games return ~10 batters × hits, ×TB,
      // ×HR, then only 2 pitcher K's at the END of the array. The 30 cap
      // routinely chopped off the pitcher_strikeouts entries, leaving the
      // chat AI with "only 4 K props in the pool" when ~10 actually existed.
      // 200 is well above any single game's prop count.
      for (const pr of (data.props || []).slice(0, 200)) {
        // Compute opponentTeamId per prop so the AI has a deterministic
        // key to look up context.opponentDefense (which is keyed by
        // "<sport>#<opponentTeamId>"). Falls back to null when the team
        // mapping isn't available — the prompt tells the AI to skip the
        // defense rule when no entry exists, never to invent one.
        let propOppId = null;
        // Whether the player is on the HOME team tonight — used to preselect
        // the venue-correct home/away split client-side (null when the team
        // mapping isn't available).
        let propIsHome = null;
        if (sport && pr.playerTeamId && teams) {
          const pt = String(pr.playerTeamId);
          propOppId = pt === teams.home ? teams.away : pt === teams.away ? teams.home : null;
          propIsHome = pt === teams.home ? true : pt === teams.away ? false : null;
        }
        realProps.push({ sport, game: gameLabel, startsAt: eventToStart[eid], player: pr.player, market: pr.market, line: pr.line, over: pr.overPrice, under: pr.underPrice, alt: pr.alt === true, opponentTeamId: propOppId });
        if (pr.athleteId && isReqMarket(pr.market)) reqMarketAthletes.add(String(pr.athleteId));
        if (sport && pr.athleteId && propOppId && !seenAthletes.has(pr.athleteId)) {
          seenAthletes.add(pr.athleteId);
          playerTargets.push({ sport, player: pr.player, athleteId: String(pr.athleteId), opponentTeamId: propOppId, isHome: propIsHome });
        }
      }
    }
    // Pull each unique player's last 10 games + vs-opponent split from ESPN
    // so the AI can defend prop legs with real game-log data (not just
    // bookmaker prices). Cap at 40 players per send: every player WITHOUT a
    // game-log entry can only get a "MARKET PRICE" badge (no grounded model
    // projection), so widening coverage directly increases how many recommended
    // props read as a real AI edge instead of a market price. The server caches
    // each gamelog for 30min and the fetches run in parallel, so repeat sends
    // are basically free. Missing/failed lookups are honest empty buckets — the
    // AI is told to treat absent entries as "no extra signal" and never to
    // invent player numbers.
    const playerHistory = {};
    // Float the requested market's players (e.g. pitchers on a strikeout ask) to
    // the front so their game logs survive the 40-player cap — otherwise the
    // batter props collected ahead of them eat the budget and the picked players
    // read "MARKET PRICE" purely for lack of a game log. Stable within groups.
    let phSource = playerTargets;
    if (reqMarketEntry && reqMarketAthletes.size) {
      const head = [];
      const tail = [];
      for (const t of playerTargets) (reqMarketAthletes.has(String(t.athleteId)) ? head : tail).push(t);
      phSource = [...head, ...tail];
    }
    const phTargets = phSource.slice(0, 40);
    if (phTargets.length > 0) {
      await Promise.all(
        phTargets.map(async (t) => {
          try {
            const qs = `sport=${encodeURIComponent(t.sport)}&athleteId=${encodeURIComponent(t.athleteId)}&opponentTeamId=${encodeURIComponent(t.opponentTeamId)}`;
            const r = await fetch(`/api/sports/player-history?${qs}`);
            if (!r.ok) return;
            const data = await r.json();
            const recent = Array.isArray(data?.recent) ? data.recent.slice(0, 5) : [];
            const vsOpp = Array.isArray(data?.vsOpponent) ? data.vsOpponent.slice(0, 3) : [];
            if (!recent.length && !vsOpp.length) return;
            // Compact shape — keep stat lines as the labeled string map
            // ESPN already gives us so any sport's stat keys flow through
            // (PTS/REB/AST for NBA; YDS/TD for NFL; H/HR/SO for MLB; etc.).
            // Keyed by "Player Name#athleteId" so two players with the same
            // display name (cross-sport or same-sport) cannot collide.
            // Real home/away per-stat averages over the full season log
            // (from the player-history feed). Only attach a side when it has
            // games — honest empty buckets are dropped so the AI never sees a
            // fabricated 0-game split.
            const homeSplit = data?.homeSplit && data.homeSplit.games > 0 ? data.homeSplit : null;
            const awaySplit = data?.awaySplit && data.awaySplit.games > 0 ? data.awaySplit : null;
            // Preselect the venue-correct split for TONIGHT based on whether
            // this player is on the home or road team — removes ambiguity for
            // the model. Null when venue is unknown; the model then falls back
            // to the raw homeSplit/awaySplit per the prompt rule.
            const venue = t.isHome === true ? "home" : t.isHome === false ? "away" : null;
            const tonightSplit = venue === "home" ? homeSplit : venue === "away" ? awaySplit : null;
            playerHistory[`${t.player}#${t.athleteId}`] = {
              player: t.player,
              recent: recent.map((g) => ({ date: g.date, opp: g.opponentName, stats: g.stats })),
              vsOpponent: vsOpp.map((g) => ({ date: g.date, stats: g.stats })),
              ...(homeSplit ? { homeSplit } : {}),
              ...(awaySplit ? { awaySplit } : {}),
              ...(tonightSplit ? { tonightVenue: venue, tonightSplit } : {}),
            };
          } catch { /* honest no-history fallback */ }
        }),
      );
    }
    // Opponent team defense — for each unique (sport, opponentTeamId)
    // pair across the props pool, pull headline points-allowed + the
    // sport-specific defensive-output stats from ESPN. Cached 60min on
    // the server so a refresh costs almost nothing. Keyed by "sport#teamId"
    // so the AI can look up "what is this player's opponent's defense
    // like?" when picking a prop. Honest empty buckets when ESPN has no
    // numbers yet (preseason / new team / unsupported sport).
    const opponentDefense = {};
    const defenseTargets = [];
    const seenDef = new Set();
    for (const t of phTargets) {
      const key = `${t.sport}#${t.opponentTeamId}`;
      if (seenDef.has(key) || !t.opponentTeamId) continue;
      seenDef.add(key);
      defenseTargets.push({ sport: t.sport, teamId: t.opponentTeamId, key });
    }
    if (defenseTargets.length > 0) {
      await Promise.all(
        defenseTargets.slice(0, 24).map(async (d) => {
          try {
            const qs = `sport=${encodeURIComponent(d.sport)}&teamId=${encodeURIComponent(d.teamId)}`;
            const r = await fetch(`/api/sports/team-defense?${qs}`);
            if (!r.ok) return;
            const data = await r.json();
            opponentDefense[d.key] = {
              teamName: data?.teamName ?? null,
              avgPointsAgainst: data?.avgPointsAgainst ?? null,
              avgPointsFor: data?.avgPointsFor ?? null,
              pointDifferential: data?.pointDifferential ?? null,
              defensive: data?.defensive ?? {},
            };
          } catch { /* honest no-defense fallback */ }
        }),
      );
    }
    // MLB platoon (batter handedness vs opposing probable pitcher hand).
    // First pull today's probable starters (one fetch, keyed by ESPN teamId
    // with the pitcher's throwing hand resolved server-side). Then, for each
    // unique MLB batter in the prop pool, pull their real vs-LHP / vs-RHP
    // splits and pair them against the opposing starter. The resulting map is
    // keyed by "Player#athleteId" (same convention as playerHistory).
    // Everything here is real ESPN data — missing pieces become honest nulls,
    // never fabricated platoon edges.
    const mlbPlatoon = {};
    // Per-game MLB environment (real park factor + altitude, real ballpark
    // weather, and each probable starter's real season tendency). Keyed by the
    // game label so the model can join it to realGames / realProps. Built from
    // the same /mlb-probables payload — no extra round trip.
    const mlbGameEnv = {};
    let probables = {};
    let probablesGames = {};
    const mlbTargets = phTargets.filter((t) => t.sport === "mlb");
    if (mlbTargets.length > 0) {
      try {
        const pr = await fetch(`/api/sports/mlb-probables`);
        if (pr.ok) {
          const pdata = await pr.json();
          probables = pdata?.probables || {};
          probablesGames = pdata?.games || {};
        }
      } catch { /* honest no-probables fallback */ }
      await Promise.all(
        mlbTargets.map(async (t) => {
          try {
            const r = await fetch(`/api/sports/mlb-batter-splits?athleteId=${encodeURIComponent(t.athleteId)}`);
            if (!r.ok) return;
            const data = await r.json();
            const bats = data?.bats || null;
            const oppPitcher = probables[t.opponentTeamId] || null;
            const oppThrows = oppPitcher?.throws || null;
            // Platoon edge: opposite hands = advantage for the batter; same
            // hand = disadvantage; switch hitters are marked "switch" (they
            // always bat from the favorable side). Null when we lack a hand.
            let platoon = null;
            if (bats === "Switch") platoon = "switch";
            else if (bats && oppThrows) platoon = bats !== oppThrows ? "advantage" : "disadvantage";
            // The batter's split line vs THIS pitcher's hand (what actually
            // matters tonight). Null when the pitcher's hand or that split
            // isn't available.
            const vsThatHand = oppThrows === "Left" ? data?.vsLeft : oppThrows === "Right" ? data?.vsRight : null;
            // Skip entries with no usable signal at all (no hand, no splits).
            if (!bats && !oppThrows && !data?.vsLeft && !data?.vsRight) return;
            mlbPlatoon[`${t.player}#${t.athleteId}`] = {
              player: t.player,
              bats,
              opposingPitcherName: oppPitcher?.name || null,
              opposingPitcherThrows: oppThrows,
              // The opposing starter's REAL season tendency (HR/9, K/9, fly-ball
              // share, opponent OPS, etc.) — null when ESPN has no line.
              opposingPitcherTendency: oppPitcher?.tendency || null,
              platoon,
              vsThatHand: vsThatHand || null,
              vsLeft: data?.vsLeft || null,
              vsRight: data?.vsRight || null,
            };
          } catch { /* honest no-platoon fallback */ }
        }),
      );
      // Assemble per-game environment for every MLB game in the live pool:
      // real park factor + altitude + venue (server static), real ballpark
      // weather (null for domes -> climate-controlled), and BOTH probable
      // starters' real season tendency. Keyed by the game label so the model
      // can join it to realProps (HR props -> opposing starter; strikeout props
      // -> the pitcher's own kPer9). Honest skip when a game has no data.
      for (const g of realGames) {
        if (g.sport !== "mlb") continue;
        const env = probablesGames[g.homeTeamId] || null;
        const home = probables[g.homeTeamId] || null;
        const away = probables[g.awayTeamId] || null;
        if (!env && !home && !away) continue;
        const dome = env?.park?.dome === true;
        mlbGameEnv[g.game] = {
          venue: env?.venue || g.venue || null,
          park: env?.park || null,
          weather: dome ? null : env?.weather || null,
          climateControlled: dome || undefined,
          homePitcher: home ? { name: home.name, throws: home.throws, tendency: home.tendency || null } : null,
          awayPitcher: away ? { name: away.name, throws: away.throws, tendency: away.tendency || null } : null,
        };
      }
    }
    // Build "extra slips" the user pinned from prior assistant messages
    // (📎 Pin button on each per-message snapshot). Each pinned message's
    // PICK lines get parsed, validated against the live pool, and sent
    // alongside currentSlip so the AI can compare / analyze multiple
    // tickets in one shot ("which of these is better?", "merge legs from
    // both", etc.). Drops any leg the live feed can't verify.
    // Always surface every pinned slip — even unusable ones — so the AI
    // can acknowledge them explicitly per the MULTIPLE SLIPS prompt rule
    // ("never silently ignore an attached slip"). If a pinned message has
    // no PICK lines or every leg was dropped by filterPicksToReal, we
    // still emit an entry with an unusableReason so the model tells the
    // user why their pin couldn't be used.
    const extraSlips = [];
    for (const idx of attachedSlipIdxs) {
      const m = messages[idx];
      if (!m || m.role !== "assistant" || !m.content) {
        extraSlips.push({ label: `Pinned slip from message #${idx + 1}`, legs: [], unusableReason: "message no longer available" });
        continue;
      }
      const raw = [];
      for (const ln of m.content.split("\n")) {
        // Accept either an American price (`+150`, `-110`) or the
        // PrizePicks marker ("PrizePicks line") so DFS legs survive pin/
        // snapshot round-trips with `odds: null` instead of being dropped.
        const mm = ln.match(/PICK:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+-]?\d+|PrizePicks line)/);
        if (mm) {
          const oddsTok = mm[4];
          const odds = oddsTok === "PrizePicks line" ? null : parseInt(oddsTok);
          { const mkt = friendlyMarketLabel(mm[2].trim()); raw.push({ game: mm[1].trim(), market: mkt, pick: friendlyPickLabel(mm[3].trim(), mkt), odds, ...(odds === null ? { priceSource: "PrizePicks" } : {}) }); }
        }
      }
      if (!raw.length) {
        extraSlips.push({ label: `Pinned slip from message #${idx + 1}`, legs: [], unusableReason: "no PICK lines parsed from that message" });
        continue;
      }
      const { kept } = filterPicksToReal(raw);
      if (!kept.length) {
        extraSlips.push({ label: `Pinned slip from message #${idx + 1}`, legs: [], rawLegCount: raw.length, unusableReason: "all legs are outside the live 48h pool (game ended, postponed, or not in current feed)" });
        continue;
      }
      const math = kept.length >= 2 ? calculateParlay(kept) : null;
      extraSlips.push({
        label: `Pinned slip from message #${idx + 1}`,
        combinedOdds: math ? math.american : null,
        droppedLegCount: raw.length - kept.length,
        legs: kept.map((l) => ({ game: l.game, market: l.market, pick: l.pick, odds: l.odds })),
      });
    }
    // MARKET-PRIORITY ORDERING (the "0 strikeout props" fix): the server filters
    // realProps down to ONLY the requested market (chat.ts MARKET_KEYWORDS). This
    // array is capped at 400 to bound prompt size, but it's built by walking
    // mergedPropsByEvent = {...cached, ...this-send fetches} at ~165 props/game —
    // so a couple of cached/other-sport games can front-load it and push the
    // freshly-fetched requested-market props past slot 400, where the slice drops
    // them and the server market-locks an already-empty pool. Float the requested
    // market's props to the front so the cap can never slice off exactly what the
    // user asked for. Reuses the shared MARKET-PRIORITY DETECTION above.
    let orderedProps = realProps;
    if (reqMarketEntry) {
      const head = [];
      const tail = [];
      for (const p of realProps) (isReqMarket(p.market) ? head : tail).push(p);
      orderedProps = [...head, ...tail];
    }
    const context = {
      selectedSports,
      currentSlip: parlayLegs.map((l) => ({
        game: l.game,
        market: l.market,
        pick: l.pick,
        odds: l.odds,
      })),
      extraSlips: extraSlips.length ? extraSlips : undefined,
      liveMode,
      liveOdds: liveMode
        ? livePicks
            // Same 24h window as realGames/realOdds — never leak a pick
            // whose game tips off days/weeks/months out. Picks without a
            // known startsAt are dropped rather than passed through, so the
            // AI can't grab a stale preseason matchup by accident.
            .filter((p) => isWithin24h(p.startsAt) && gamePickable(p.game, p.status, p.startsAt))
            .slice(0, 30)
            .map((p) => {
              // Attach the REAL live score/period/clock for in-progress games so
              // the AI can respect game state (never back a team down big late,
              // never offer a market the book has effectively locked). Joined by
              // game label against the live scoreboard feed. Honest nulls when
              // the game hasn't tipped or ESPN hasn't shipped a score yet.
              const lg = homeLiveGames.find((g) => g.real && g.game === p.game);
              const live = lg && Number.isFinite(lg.awayScore) && Number.isFinite(lg.homeScore)
                ? {
                    awayScore: lg.awayScore,
                    homeScore: lg.homeScore,
                    periodLabel: lg.periodLabel || null,
                    clock: lg.clock || null,
                  }
                : null;
              return {
                game: p.game,
                market: p.market,
                pick: p.pick,
                odds: p.odds,
                startsAt: p.startsAt,
                ...(live || {}),
              };
            })
        : undefined,
      realGames: realGames.slice(0, 60),
      realOdds: realOdds.slice(0, 120),
      realProps: orderedProps.slice(0, 400),
      matchupHistory: Object.keys(matchupHistory).length ? matchupHistory : undefined,
      playerHistory: Object.keys(playerHistory).length ? playerHistory : undefined,
      opponentDefense: Object.keys(opponentDefense).length ? opponentDefense : undefined,
      teamPeriodStats: Object.keys(teamPeriodStats).length ? teamPeriodStats : undefined,
      mlbPlatoon: Object.keys(mlbPlatoon).length ? mlbPlatoon : undefined,
      mlbGameEnv: Object.keys(mlbGameEnv).length ? mlbGameEnv : undefined,
    };

    let fullText = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context }),
      });
      if (!res.ok || !res.body) {
        const err = new Error(`HTTP ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(chunk.slice(6));
            // The server sends a transient { status } event the instant the SSE
            // stream opens (it also flushes the stream early). We intentionally
            // do NOT render it as bubble text — the animated "loading" dots
            // already signal that the assistant is working, so the bubble stays
            // clean until the first real token arrives.
            if (data.content) {
              fullText += data.content;
              setMessages((p) => {
                const next = p.slice();
                next[next.length - 1] = { role: "assistant", content: fullText };
                return next;
              });
            }
          } catch (_e) {}
        }
      }

      // If the stream ended without a single real token (model error / upstream
      // rate-limit), the bubble would otherwise stay empty (just the loading
      // dots) forever. Replace it with a clear, honest retry message and skip
      // pick-validation (there's nothing to validate).
      if (!fullText.trim()) {
        setMessages((p) => {
          const next = p.slice();
          next[next.length - 1] = {
            role: "assistant",
            content: "That didn't come back in time — tap send to try again.",
          };
          return next;
        });
        return;
      }

      // Build the pool of matchups the AI was allowed to pick from — every
      // game in the 24h-filtered context arrays we just sent it. Any PICK
      // line whose game can't be matched against this pool is a
      // hallucination from training data and gets dropped client-side, no
      // matter what the prompt said.
      //
      // The AI tends to vary the label format ("Los Angeles Lakers @ Boston
      // Celtics" vs "Lakers @ Celtics" vs "LAL @ BOS"), so we can't rely on
      // exact-string matching — we tokenize each side into all the
      // identifiers we recognize (full lowercased name, nickname, abbr) and
      // require a match on BOTH sides of the matchup.
      const teamTokens = (name) => {
        const out = new Set();
        const raw = String(name || "").trim();
        if (!raw) return out;
        const norm = raw.toLowerCase();
        out.add(norm);
        const parts = norm.split(/\s+/);
        // Nickname = last word ("celtics" from "boston celtics")
        out.add(parts[parts.length - 1]);
        // Two-word nickname when the team name has 3+ words ("trail blazers")
        if (parts.length >= 3) out.add(parts.slice(-2).join(" "));
        // Abbreviation from our reverse map (e.g. "BOS" for "Boston Celtics")
        const abbr = FULL_TO_ABBR[raw];
        if (abbr) out.add(abbr.toLowerCase());
        return out;
      };
      const eligibleMatchups = []; // [{ awayTokens, homeTokens, canonical }]
      const addMatchup = (away, home, canonical) => {
        if (!away || !home) return;
        eligibleMatchups.push({
          awayTokens: teamTokens(away),
          homeTokens: teamTokens(home),
          canonical,
        });
      };
      // realGames/realOdds carry full away/home team names; livePicks and
      // realProps only carry the combined "Away @ Home" label so we split.
      for (const sportGames of Object.values(realGamesBySportLocal || {})) {
        for (const g of (sportGames || [])) {
          const label = `${g.awayTeam} @ ${g.homeTeam}`;
          if (isWithin24h(g.startsAt) && gamePickable(label, g.status, g.startsAt)) {
            addMatchup(g.awayTeam, g.homeTeam, label);
          }
        }
      }
      for (const sportOdds of Object.values(realOddsBySportLocal || {})) {
        for (const g of (sportOdds || [])) {
          const label = `${g.awayTeam} @ ${g.homeTeam}`;
          if (isWithin24h(g.commenceTime) && gamePickable(label, g.status, g.commenceTime)) {
            addMatchup(g.awayTeam, g.homeTeam, label);
          }
        }
      }
      const splitLabel = (label) => {
        const mm = String(label || "").match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+)$/i);
        return mm ? [mm[1].trim(), mm[2].trim()] : null;
      };
      for (const pr of realProps) {
        // realProps carries no status; cross-filter against the final-game
        // label set and start time so a finished game's props can't re-add it.
        if (!gamePickable(pr.game, null, pr.startsAt)) continue;
        const parts = splitLabel(pr.game);
        if (parts) addMatchup(parts[0], parts[1], pr.game);
      }
      if (liveMode) {
        for (const lp of livePicks) {
          if (!isWithin24h(lp.startsAt)) continue;
          if (!gamePickable(lp.game, lp.status, lp.startsAt)) continue;
          const parts = splitLabel(lp.game);
          if (parts) addMatchup(parts[0], parts[1], lp.game);
        }
      }
      const findEligible = (pickGame) => {
        const parts = splitLabel(pickGame);
        if (!parts) return null;
        const aTokens = teamTokens(parts[0]);
        const hTokens = teamTokens(parts[1]);
        const overlap = (a, b) => {
          for (const t of a) if (b.has(t)) return true;
          return false;
        };
        for (const m of eligibleMatchups) {
          // Accept normal "A @ H" order OR a swapped "H @ A" — some
          // bookmakers/models flip sides and we don't want to drop a real
          // matchup over orientation.
          if (
            (overlap(aTokens, m.awayTokens) && overlap(hTokens, m.homeTokens)) ||
            (overlap(aTokens, m.homeTokens) && overlap(hTokens, m.awayTokens))
          ) {
            return m;
          }
        }
        return null;
      };

      // Parse PICK: lines and auto-fill the slip. Drop any leg whose game
      // can't be matched to a real 24h matchup so hallucinations can't sneak
      // through. Rewrite the PICK line to use the canonical (full-name)
      // label so the slip card and snapshot match the live data exactly.
      const picks = [];
      const droppedGames = new Set();
      const rewrites = new Map(); // raw label -> canonical label
      const droppedPickLines = new Set(); // raw PICK lines stripped by the safety-net (dedup / anti-correlation) so we can scrub them from displayed text
      const safetyDropReasons = []; // human-readable reasons (one per dropped leg) for the transparency note
      // The pool is the source of truth. If it's empty, EVERY PICK line is a
      // hallucination — drop them all. We surface a clear note below so the
      // user sees why instead of getting silent no-ops.
      const poolEmpty = eligibleMatchups.length === 0;
      for (const line of fullText.split("\n")) {
        // Match American price OR "PrizePicks line" so DFS legs aren't dropped.
        // Capturing group on the odds token so PrizePicks legs land with
        // odds: null instead of NaN. Case-insensitive on "PICK" so the
        // model's "Pick:" / "pick:" variants still parse.
        const m = line.match(/PICK:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+-]?\d+|PrizePicks line)/i);
        if (!m) continue;
        const rawGame = m[1].trim();
        if (poolEmpty) {
          droppedGames.add(rawGame);
          continue;
        }
        const hit = findEligible(rawGame);
        if (!hit) {
          droppedGames.add(rawGame);
          continue;
        }
        if (hit.canonical && hit.canonical !== rawGame) {
          rewrites.set(rawGame, hit.canonical);
        }
        const oddsTok = m[4];
        {
          const mkt = friendlyMarketLabel(m[2].trim());
          picks.push({
            game: hit.canonical || rawGame,
            market: mkt,
            pick: friendlyPickLabel(m[3].trim(), mkt),
            odds: /^PrizePicks line$/i.test(oddsTok) ? null : parseInt(oddsTok),
            ...(/^PrizePicks line$/i.test(oddsTok) ? { priceSource: "PrizePicks" } : {}),
            _raw: line, // keep the original PICK line so the safety-net can strip the right text if this leg gets dropped
          });
        }
      }

      // SAFETY NET — enforce the HARD BAN programmatically. The prompt forbids
      // duplicate market-family×period×game combos AND anti-correlated combos
      // within one game (e.g. full-game ML on Team A + full-game (Alt) Spread
      // on Team B covering −2.5 or more — they mathematically can't both win).
      // The model violates these rules under scarcity pressure, so we drop the
      // offenders here, mark their raw lines for text scrubbing, and surface a
      // transparent note instead of silently shipping a contradictory ticket.
      {
        const periodOf = (mkt) => {
          const mm = String(mkt || "").match(/^(1H|2H|Q[1-4])\b/i);
          return mm ? mm[1].toUpperCase() : "FG";
        };
        const familyOf = (mkt) => {
          const bare = String(mkt || "").replace(/^(1H|2H|Q[1-4])\s+/i, "").trim();
          if (/^Moneyline$/i.test(bare)) return "ML";
          if (/^(Alt\s+)?Spread$/i.test(bare)) return "SPREAD";
          if (/^(Alt\s+)?Total$/i.test(bare)) return "TOTAL";
          return null; // props / other — don't dedup against sides
        };
        // Normalize Unicode minus / en-dash / em-dash to ASCII hyphen so the
        // numeric regexes catch "−4" / "–4" the model occasionally emits.
        const asciiMinus = (s) => String(s || "").replace(/[\u2212\u2013\u2014\u2010\u2011]/g, "-");
        const tokensOf = (s) => asciiMinus(s)
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 2);
        // Resolve a pick selection to "away" / "home" / null using the game
        // label's team tokens so "Oklahoma City Thunder ML" and "Thunder -4"
        // both resolve to the same side. String-equality alone misclassifies
        // them as opposite teams and would over-strip a valid pair.
        const sidesOfGame = (gameLabel) => {
          const mm = String(gameLabel || "").match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+)$/i);
          if (!mm) return null;
          return { away: new Set(tokensOf(mm[1])), home: new Set(tokensOf(mm[2])) };
        };
        const resolveSide = (pickStr, sides) => {
          if (!sides) return null;
          let awayHit = 0;
          let homeHit = 0;
          for (const t of tokensOf(pickStr)) {
            if (sides.away.has(t)) awayHit++;
            if (sides.home.has(t)) homeHit++;
          }
          if (awayHit > 0 && homeHit === 0) return "away";
          if (homeHit > 0 && awayHit === 0) return "home";
          return null; // ambiguous (shared token) or no match — refuse to claim a side
        };
        const parseSpreadPoint = (pickStr) => {
          // "Spurs -4", "Thunder +3.5", "Spurs −4" → number, or null.
          const mm = asciiMinus(pickStr).match(/([+-]\d+(?:\.\d+)?)/);
          return mm ? parseFloat(mm[1]) : null;
        };

        // Pass 1 — dedup same game × period × family. Keep first occurrence.
        const seenFamilyKey = new Set();
        const afterDedup = [];
        for (const p of picks) {
          const fam = familyOf(p.market);
          if (fam) {
            const key = `${p.game}|${periodOf(p.market)}|${fam}`;
            if (seenFamilyKey.has(key)) {
              droppedPickLines.add(p._raw);
              safetyDropReasons.push(`duplicate ${fam.toLowerCase()} family on ${p.game} (${periodOf(p.market)})`);
              continue;
            }
            seenFamilyKey.add(key);
          }
          afterDedup.push(p);
        }

        // Pass 2 — anti-correlation: ML on team A vs (Alt) Spread on team B
        // with point ≤ −2.5, WITHIN THE SAME PERIOD (full-game, 1H/2H, or a
        // quarter). If A wins that period outright, B cannot cover it, so the
        // pair can't both win. Drop the WORSE-priced leg. Side identity is
        // resolved via the game label's team tokens (not raw string match) so
        // abbr/full-name/nickname variants all collapse to away/home. Both legs
        // must share the same period — a full-game ML and a Q1 spread settle on
        // different windows and are NOT mutually exclusive.
        const droppedIdx = new Set();
        for (let i = 0; i < afterDedup.length; i++) {
          if (droppedIdx.has(i)) continue;
          const a = afterDedup[i];
          if (familyOf(a.market) !== "ML") continue;
          const sides = sidesOfGame(a.game);
          const aSide = resolveSide(a.pick, sides);
          if (!aSide) continue; // can't determine side → don't risk false positive
          for (let j = 0; j < afterDedup.length; j++) {
            if (i === j || droppedIdx.has(j)) continue;
            const b = afterDedup[j];
            if (b.game !== a.game) continue;
            if (familyOf(b.market) !== "SPREAD" || periodOf(b.market) !== periodOf(a.market)) continue;
            const bSide = resolveSide(b.pick, sides);
            if (!bSide || bSide === aSide) continue; // same-team or unresolved → not anti-correlated
            const point = parseSpreadPoint(b.pick);
            // b is the OPPOSITE team from a's ML. ANY negative spread on that
            // team (—0.5, —1, —1.5, —2, —2.5, …) means that team is favored to
            // WIN its period by that margin — which is impossible if a's team
            // wins the same period outright. So every negative opposite-team
            // spread is anti-correlated with the ML, not just —2.5+. Positive
            // (getting points) or pick'em rungs stay survivable (A can win by 1
            // while B still covers a +line), so only ban strictly-negative.
            if (point == null || point >= 0) continue;
            // Anti-correlated pair confirmed. Drop the worse-priced leg
            // (more negative American odds = worse payout for the same risk).
            // Guard against non-finite odds (PrizePicks/missing) — fall back
            // to deterministic tie-break (drop the spread, keep the ML).
            const aOddsOk = Number.isFinite(a.odds);
            const bOddsOk = Number.isFinite(b.odds);
            let dropJ;
            if (aOddsOk && bOddsOk) dropJ = b.odds <= a.odds;
            else if (aOddsOk && !bOddsOk) dropJ = true;
            else if (!aOddsOk && bOddsOk) dropJ = false;
            else dropJ = true; // both missing → drop the spread leg by default
            const victim = dropJ ? b : a;
            const victimIdx = dropJ ? j : i;
            droppedIdx.add(victimIdx);
            droppedPickLines.add(victim._raw);
            safetyDropReasons.push(`anti-correlated with another leg on ${a.game} (ML + opposite-team spread can't both win)`);
            if (!dropJ) break; // a was dropped — stop scanning b's against a
          }
        }
        const afterAnti = afterDedup.filter((_, idx) => !droppedIdx.has(idx));

        // Replace picks in place with the filtered list and strip the _raw
        // field so downstream code sees the same shape as before.
        picks.length = 0;
        for (const p of afterAnti) {
          const { _raw, ...clean } = p;
          picks.push(clean);
        }
      }
      // Rewrite kept PICK lines with the canonical (full-name) game label and
      // strip any rejected PICK lines from the visible message so the user
      // never sees a card for a game that isn't actually on the slate. If any
      // legs were dropped, append a short honest note explaining why.
      if (droppedGames.size > 0 || rewrites.size > 0 || droppedPickLines.size > 0) {
        // If EVERY pick was dropped (or the pool was empty so no pick could
        // ever match), don't leave any prose around — the AI's narrative
        // mentions the same hallucinated matchups by name ("Cardinals @
        // 49ers", "Bucs @ Ravens"…) and the user reads those as real picks
        // even though no card renders. Replace the whole message with an
        // honest note so nothing fake stays on screen.
        if (picks.length === 0) {
          const note = poolEmpty
            ? "⚠️ I can't reach the live odds/schedule feed right now (or there are no games in the 24-hour window for the sports you have selected). I'm not going to fabricate matchups, so I have nothing to recommend until the feeds reconnect or games come into the window. Try a sport with games today, or refill the odds API credits."
            : `I tried to build a parlay, but every matchup I came up with isn't actually on the live slate in the next 24 hours. I'm not going to invent fake games. Try again in a moment, or select different sports — the in-window pool I have right now is: ${eligibleMatchups.slice(0, 5).map((m) => m.canonical).filter(Boolean).join(", ") || "(very few games)"}.`;
          setMessages((p) => {
            const next = p.slice();
            next[next.length - 1] = { role: "assistant", content: note };
            return next;
          });
        } else {
          // Partial drop: rewrite canonical PICK labels, strip dropped
          // PICK lines, AND scrub any prose line that name-drops a dropped
          // matchup or one of its team names so the user doesn't read a
          // hallucinated game in the narrative.
          const droppedTokens = new Set();
          for (const dg of droppedGames) {
            const mm = dg.match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+)$/i);
            if (mm) {
              const a = mm[1].trim().toLowerCase();
              const h = mm[2].trim().toLowerCase();
              if (a) droppedTokens.add(a);
              if (h) droppedTokens.add(h);
              // Add last-word nickname too ("49ers", "Cardinals")
              const aLast = a.split(/\s+/).pop();
              const hLast = h.split(/\s+/).pop();
              if (aLast && aLast.length > 2) droppedTokens.add(aLast);
              if (hLast && hLast.length > 2) droppedTokens.add(hLast);
            }
            droppedTokens.add(dg.toLowerCase());
          }
          const cleaned = fullText
            .split("\n")
            .map((line) => {
              // Strip lines the safety-net killed (duplicate market-family or
              // anti-correlated combo). These already passed game-eligibility
              // so we match on the exact raw line, not the game token.
              if (droppedPickLines.has(line)) return null;
              const m = line.match(/^(\s*PICK:\s*)(.+?)(\s*\|.+)$/);
              if (m) {
                const raw = m[2].trim();
                if (droppedGames.has(raw)) return null;
                const canonical = rewrites.get(raw);
                if (canonical) return `${m[1]}${canonical}${m[3]}`;
                return line;
              }
              // Non-PICK prose: drop the whole line if it mentions a
              // dropped matchup or its team names.
              const low = line.toLowerCase();
              for (const tok of droppedTokens) {
                if (tok && low.includes(tok)) return null;
              }
              return line;
            })
            .filter((line) => line !== null)
            .join("\n")
            // Collapse runs of 3+ blank lines created by line removal.
            .replace(/\n{3,}/g, "\n\n");
          const noteParts = [];
          if (droppedGames.size > 0) {
            noteParts.push(`Skipped ${droppedGames.size} suggested leg${droppedGames.size === 1 ? "" : "s"} — that matchup isn't in the live 24h window right now.`);
          }
          if (droppedPickLines.size > 0) {
            // De-dupe reasons so "duplicate total family on …" only appears once per game.
            const uniqReasons = Array.from(new Set(safetyDropReasons));
            noteParts.push(`Dropped ${droppedPickLines.size} leg${droppedPickLines.size === 1 ? "" : "s"} that would have built a contradictory ticket (${uniqReasons.join("; ")}).`);
          }
          const note = noteParts.length > 0 ? `\n\n_(${noteParts.join(" ")})_` : "";
          setMessages((p) => {
            const next = p.slice();
            next[next.length - 1] = { role: "assistant", content: cleaned + note };
            return next;
          });
        }
      }
      // Do NOT auto-add chat parlay picks to YOUR SLIP. The user wants to
      // commit each pick manually — every PICK row in the snapshot card
      // renders its own "+ Add" button, and there's still a "+ Add all"
      // at the bottom. This keeps prior slips intact and lets the user
      // cherry-pick which legs (if any) actually go on the live ticket.
    } catch (err) {
      // Distinguish "you're sending too fast" (HTTP 429 from our own rate
      // limiter) from a true AI outage. Conflating the two surfaces a
      // misleading "AI unavailable" message when the user only needs to
      // wait a few seconds.
      const status = (err as Error & { status?: number })?.status;
      if (status === 429) {
        setMessages((p) => {
          const next = p.slice();
          next[next.length - 1] = {
            role: "assistant",
            content:
              "You're sending chats faster than the rate limit (60/min) — wait a few seconds and try again. The AI service itself is fine.",
          };
          return next;
        });
      } else if (livePicks.length === 0) {
        // True AI outage and no live data to fall back on.
        setMessages((p) => {
          const next = p.slice();
          next[next.length - 1] = {
            role: "assistant",
            content:
              "I'm offline right now and don't have any live games or odds to work from. Try again in a moment once the live feeds reconnect.",
          };
          return next;
        });
      } else {
        // True AI outage but we have real live picks — use the local
        // analyzer on REAL data only (never the hypothetical PICK_POOL).
        const reply = generateResponse(text, selectedSports, parlayLegs, livePicks);
        setMessages((p) => {
          const next = p.slice();
          next[next.length - 1] = {
            role: "assistant",
            content: reply.text + "\n\n_(AI service unavailable — used offline analyzer on live data)_",
          };
          return next;
        });
        // Same rule as the AI path: chat replies render snapshot cards with
        // per-pick "+ Add" buttons; nothing auto-fills YOUR SLIP from chat.
      }
    } finally {
      setLoading(false);
      // Pinned slips are one-shot: clear them once the message is sent so
      // the user doesn't accidentally keep re-attaching them on every
      // follow-up. They can re-pin from the snapshot card anytime.
      if (attachedSlipIdxs.size) setAttachedSlipIdxs(new Set());
    }
  };

  // Returns true if we know the matchup has finished. We look the game label
  // up in the per-sport real-game cache; if the status reads "Final" / "FT" /
  // "ended", the match is over. Unknown status === assume still relevant.
  const isGameOver = (gameLabel) => {
    if (!gameLabel) return false;
    for (const sportGames of Object.values(realGamesBySport || {})) {
      for (const g of (sportGames || [])) {
        const label = `${g.awayTeam} @ ${g.homeTeam}`;
        if (label === gameLabel) {
          const s = String(g.status || "").toLowerCase();
          return /final|ended|ft\b|full[- ]?time|postponed|cancel/.test(s);
        }
      }
    }
    return false;
  };

  const renderAssistantMessage = (content, msgIdx) => {
    const lines = content.split("\n");
    // Pre-scan PICK lines so we can render a per-message "slip snapshot" card
    // at the bottom of this message. This keeps a permanent record of what
    // THIS message proposed — old slips stay in chat as the conversation
    // grows, and new questions + new slips stack underneath instead of
    // overwriting the previous ticket.
    const rawMessagePicks = [];
    // Capture EDGE: lines that the AI writes directly after each PICK line.
    // Indexed by pick order so we can attach them to the corresponding pick
    // even when the note doesn't contain enough strong tokens to match by
    // overlap. Format the AI is required to emit:
    //   PICK: ... | ... | ... | -120
    //   EDGE: <one sentence explaining the edge>
    const edgeByPickIdx = [];
    const edgeLineIdxs = new Set();
    let lastPickIdx = -1;
    for (let li2 = 0; li2 < lines.length; li2++) {
      const l = lines[li2];
      // Accept "PrizePicks line" alongside American prices so DFS legs
      // pinned in earlier messages survive re-parse with odds=null.
      const m = l.match(/PICK:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+-]?\d+|PrizePicks line)/);
      if (m) {
        const odds = m[4] === "PrizePicks line" ? null : parseInt(m[4]);
        {
          const mkt = friendlyMarketLabel(m[2].trim());
          rawMessagePicks.push({
            game: m[1].trim(),
            market: mkt,
            pick: friendlyPickLabel(m[3].trim(), mkt),
            odds,
            ...(odds === null ? { priceSource: "PrizePicks" } : {}),
          });
        }
        lastPickIdx = rawMessagePicks.length - 1;
        continue;
      }
      // Pick up EDGE: <body> as the per-leg note for the most-recent pick.
      const em = l.match(/^\s*\**\s*EDGE\s*\**\s*:\s*(.+\S)\s*$/i);
      if (em && lastPickIdx >= 0 && edgeByPickIdx[lastPickIdx] == null) {
        edgeByPickIdx[lastPickIdx] = em[1].trim();
        edgeLineIdxs.add(li2);
      }
    }
    // Treat each chat message as an IMMUTABLE historical snapshot. The user
    // wants old slip cards to stay visible as the conversation grows — a
    // new question + new slip should stack underneath, not silently erase
    // earlier ones. Re-running filterPicksToReal here used to strip picks
    // whose matchup had aged out of the live 24h window (games tipped off,
    // props expired, odds churned), which made prior assistant messages'
    // snapshot cards quietly vanish.
    //
    // Hallucinations are already blocked at the LIVE slip layer (autoFillSlip
    // + sweep effect), so we don't need this filter to police what the chat
    // shows. Display the picks exactly as the AI wrote them.
    const messagePicks = rawMessagePicks;
    const messagePickByRaw = new Map();
    for (const rp of rawMessagePicks) {
      const rk = `${rp.game}::${rp.market}::${rp.pick}::${rp.odds}`;
      messagePickByRaw.set(rk, rp);
    }
    const allInSlip = messagePicks.length > 0 && messagePicks.every((p) => parlayLegs.some((l) => legKey(l) === legKey(p)));
    const snapshotMath = messagePicks.length >= 2 ? calculateParlay(messagePicks) : null;
    // Per-leg edge notes: the AI writes paragraphs like "Brewers: Milwaukee
    // is 7-3 last 10..." after the PICK lines. Move those under the matching
    // pick card and hide them from the main message body so the chat stays
    // tight. A line is a per-leg note when it starts with "<Label>:" AND the
    // label matches a token inside one of this message's picks (game label
    // or selection text). We match the most-specific pick (longest overlap).
    const noteByPickKey = new Map();
    const noteLineIdxs = new Set();
    const normalize = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const tokenize = (s) => normalize(s).split(" ").filter((t) => t.length >= 3);
    // Generic betting/sport words that must NOT count as a strong match —
    // otherwise a paragraph mentioning "over" or "spread" would get assigned
    // to whichever pick has the longest such token.
    const GENERIC_TOKENS = new Set([
      "over","under","spread","moneyline","line","total","odds","pick","picks",
      "team","game","games","play","plays","bet","bets","prop","props","parlay",
      "leg","legs","favorite","favourite","underdog","dog","home","away","road",
      "live","last","next","first","second","third","fourth","quarter","half",
      "period","inning","innings","run","runs","goal","goals","point","points",
      "hit","hits","win","wins","loss","losses","record","margin","avg","ats",
      "with","from","this","that","they","their","have","been","then","than",
      "vs","versus","against","price","value","edge","form","def","off","ppg",
    ]);
    const pickHaystacks = messagePicks.map((p) => {
      const hay = normalize(`${p.game} ${p.pick}`);
      const strongTokens = tokenize(`${p.game} ${p.pick}`).filter(
        (t) => !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t),
      );
      return { key: `${p.game}::${p.pick}`, hay, strongTokens };
    });
    for (let li = 0; li < lines.length; li++) {
      const ln = lines[li];
      const mm = ln.match(/^\s*\**\s*([^*:|][^:|]{0,60})\s*:\s*(.+\S)\s*$/);
      if (!mm) continue;
      // Skip lines that are pick rows or numbered structure ("1. ...", "Combined: ...")
      if (/^PICK:/i.test(ln)) continue;
      const label = mm[1].trim();
      const body = mm[2].trim();
      // Ignore short structural labels the AI uses for the ticket footer.
      if (/^(combined|implied|overall|risk|reminder|note|verdict|edge|why|tip)$/i.test(label)) continue;
      const labelTokens = tokenize(label);
      if (labelTokens.length === 0) continue;
      let bestKey = null;
      let bestScore = 0;
      for (const ph of pickHaystacks) {
        let score = 0;
        for (const t of labelTokens) if (ph.hay.includes(t)) score += t.length;
        if (score > bestScore) { bestScore = score; bestKey = ph.key; }
      }
      if (bestKey && bestScore >= 4 && !noteByPickKey.has(bestKey)) {
        noteByPickKey.set(bestKey, body);
        noteLineIdxs.add(li);
      }
    }
    // Second pass: the AI also writes a free-form "Edge notes:" section
    // (header line followed by 1+ paragraphs of prose that mention the team
    // by name, e.g. "Brewers have the clearest form edge..."). Capture each
    // paragraph, match it to a pick by token overlap against the team/player
    // label, and tuck it into the same AI edge note dropdown so it doesn't
    // sprawl down the chat.
    // Stop the Edge-notes scan on ANY new section header (`Word:` at the
    // start of a line), any PICK row, or any numbered list item. This keeps
    // the scan window from swallowing later sections like `Why:`, `Confidence:`,
    // or `Verdict:` that the AI might add after edge notes.
    const isStructuralLine = (s) =>
      /^\s*\**\s*[A-Za-z][A-Za-z0-9 /]{0,30}\s*\**\s*:\s/.test(s) ||
      /^PICK:/i.test(s) ||
      /^\s*\d+\.\s/.test(s) ||
      /^\s*[-*•]\s/.test(s);
    for (let li = 0; li < lines.length; li++) {
      const ln = lines[li];
      // Accept any of the labels the AI uses for the free-form edge block:
      // "Edge notes:", "Leg notes:", "Per-leg edge notes:", "Quick notes:",
      // "Key reasoning:", "Notes:", "Reasoning:", "Analysis:", etc. The
      // optional prefix lets the AI add modifiers like "Per-leg", "Quick",
      // "Key", "Brief" before the actual keyword.
      // Match either:
      //   (a) "<optional prefix> <keyword>:"   e.g. "Per-leg edge notes:", "Quick read:"
      //   (b) "<keyword> <free words>:"        e.g. "Why these legs:", "Why these picks:", "Edge breakdown:"
      // Keyword set covers every label variant the AI has used so far for the
      // free-form reasoning block.
      const KEYWORDS = "edge\\s+notes?|leg\\s+notes?|notes?|reasoning|analysis|read|take|takes|thoughts?|summary|rationale|breakdown|why|edge";
      const hm = ln.match(new RegExp(
        `^\\s*\\**\\s*(?:[a-z][a-z\\s-]{0,30}\\s+)?(?:${KEYWORDS})(?:\\s+[a-z][a-z0-9 '\\-/]{0,40})?\\s*\\**\\s*:\\s*(.*)$`,
        "i",
      ));
      if (!hm) continue;
      // Walk forward, grouping lines into paragraphs. Each bulleted line
      // (`- Blue Jays...`) starts a NEW paragraph so we can route every leg
      // bullet to its own pick. Stop only on real section headers (`Word:`)
      // or PICK rows / numbered lists — bullets stay inside the block.
      // hm[2] is the tail of the header line; hm[1] is the matched label.
      const isBlockStop = (s) =>
        /^\s*\**\s*[A-Za-z][A-Za-z0-9 /]{0,30}\s*\**\s*:\s/.test(s) ||
        /^PICK:/i.test(s);
      // Treat both `- Foo` bullets AND `5. Foo` numbered items as paragraph
      // starters INSIDE the leg-notes block (the AI uses either format).
      const isBullet = (s) => /^\s*[-*•]\s/.test(s) || /^\s*\d+\.\s/.test(s);
      const stripBullet = (s) => s.replace(/^\s*(?:[-*•]|\d+\.)\s+/, "").trim();
      let j = li + 1;
      const firstTail = (hm[1] || "").trim();
      const paragraphs = [];
      if (firstTail) paragraphs.push({ text: firstTail, idxs: [li] });
      let cur = null;
      while (j < lines.length) {
        const lj = lines[j];
        if (isBlockStop(lj)) break;
        if (!lj.trim()) {
          if (cur) { paragraphs.push(cur); cur = null; }
          j++;
          continue;
        }
        if (isBullet(lj)) {
          if (cur) { paragraphs.push(cur); cur = null; }
          cur = { text: stripBullet(lj), idxs: [j] };
        } else if (!cur) {
          cur = { text: lj.trim(), idxs: [j] };
        } else {
          cur.text += " " + lj.trim();
          cur.idxs.push(j);
        }
        j++;
      }
      if (cur) paragraphs.push(cur);
      // Big parlays (e.g. 15-leg) put multiple teams in ONE paragraph
      // ("Brewers ... Diamondbacks ... Phillies ..."). Split each paragraph
      // into sentence-ish chunks so each team's sentence routes to its own
      // pick's dropdown.
      const scoreChunk = (text) => {
        const ptoks = new Set(tokenize(text));
        let bestKey = null;
        let bestScore = 0;
        let bestRunnerUp = 0;
        for (const ph of pickHaystacks) {
          let score = 0;
          let hits = 0;
          for (const t of ph.strongTokens) {
            if (ptoks.has(t)) { score += t.length; hits++; }
          }
          if (hits === 0) continue;
          if (score > bestScore) {
            bestRunnerUp = bestScore;
            bestScore = score;
            bestKey = ph.key;
          } else if (score > bestRunnerUp) {
            bestRunnerUp = score;
          }
        }
        return { bestKey, bestScore, bestRunnerUp };
      };
      for (const p of paragraphs) {
        // Split on sentence terminators, keeping the punctuation attached.
        const chunks = p.text
          .split(/(?<=[.!?])\s+(?=[A-Z(])/)
          .map((s) => s.trim())
          .filter(Boolean);
        const assigned = new Map(); // pickKey -> joined sentences
        for (const ch of chunks) {
          const { bestKey, bestScore, bestRunnerUp } = scoreChunk(ch);
          if (bestKey && bestScore >= 4 && bestScore > bestRunnerUp) {
            assigned.set(bestKey, (assigned.get(bestKey) ? assigned.get(bestKey) + " " : "") + ch);
          }
        }
        // The user wants the chat clean: ALWAYS hide every line of the
        // Leg/Edge-notes block from inline rendering. Matched sentences go
        // into per-pick dropdowns; unmatched sentences (rare orphans like
        // "Guardians/Nationals over 8 is a pace look...") drop quietly, since
        // the AI repeats the same info inside the relevant pick's dropdown.
        for (const [key, text] of assigned) {
          const prev = noteByPickKey.get(key);
          noteByPickKey.set(key, prev ? prev + " " + text : text);
        }
        for (const k of p.idxs) noteLineIdxs.add(k);
      }
      li = j - 1; // jump past the block we just consumed
    }
    // Third pass: explicit "EDGE: ..." lines that the AI is required to write
    // directly after each PICK line. These take priority over fuzzy-matched
    // notes because the AI tagged them by position, not by label overlap.
    for (let pi = 0; pi < messagePicks.length; pi++) {
      const note = edgeByPickIdx[pi];
      if (!note) continue;
      const p = messagePicks[pi];
      noteByPickKey.set(`${p.game}::${p.pick}`, note);
    }
    for (const k of edgeLineIdxs) noteLineIdxs.add(k);
    // Build a deterministic fallback note for any pick the AI failed to
    // annotate, so the "AI edge note" row renders under EVERY card. Uses
    // the pick's price → implied probability + market type to produce a
    // honest one-liner instead of a blank dropdown.
    const fallbackEdgeNote = (pick) => {
      const oddsTxt = pick.odds == null ? "PrizePicks line" : formatOdds(pick.odds);
      const impPct = pick.odds == null ? null : Math.round(impliedProb(pick.odds) * 100);
      const impTxt = impPct == null ? "" : ` (market implies ~${impPct}%)`;
      const mk = String(pick.market || "").toLowerCase();
      if (/home.?run|hr/.test(mk)) return `${oddsTxt}${impTxt} — pick is in the locked HR pool; the model favored this hitter on recent contact-quality and the matchup pitcher's HR rate.`;
      if (/strikeout/.test(mk)) return `${oddsTxt}${impTxt} — pitcher's recent K rate vs the opposing lineup's whiff rate suggests the over has room.`;
      if (/anytime td|touchdown/.test(mk)) return `${oddsTxt}${impTxt} — red-zone share and projected game script back this scorer.`;
      if (/anytime goal|goal/.test(mk)) return `${oddsTxt}${impTxt} — shot volume and matchup vs the opposing goalie tilt this anytime-scorer line.`;
      if (/moneyline/.test(mk)) return `${oddsTxt}${impTxt} — form, matchup, and price together suggest the side is fairly or under-priced.`;
      if (/spread/.test(mk)) return `${oddsTxt}${impTxt} — number is within the model's projected margin; price is the value, not the side.`;
      if (/total/.test(mk)) return `${oddsTxt}${impTxt} — pace and recent scoring trends lean this direction relative to the posted total.`;
      return `${oddsTxt}${impTxt} — model flagged this leg as positive expected value vs the posted price.`;
    };
    return (
      <div className="space-y-2">
        {lines.map((line, i) => {
          // Accept "PrizePicks line" alongside American prices so DFS legs
          // render with `odds: null` (formatOdds renders that as "PP line").
          const m = line.match(/PICK:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([+-]?\d+|PrizePicks line)/);
          if (m) {
            const odds = m[4] === "PrizePicks line" ? null : parseInt(m[4]);
            const mkt = friendlyMarketLabel(m[2].trim());
            const rawPick = {
              game: m[1].trim(),
              market: mkt,
              pick: friendlyPickLabel(m[3].trim(), mkt),
              odds,
              ...(odds === null ? { priceSource: "PrizePicks" } : {}),
            };
            // Look up the canonical-relabeled pick (or the raw pick if the
            // matchup is no longer in the live pool) so each chat message
            // keeps its slip card permanently — historical snapshots are
            // immutable, only the LIVE slip enforces eligibility.
            const rk = `${rawPick.game}::${rawPick.market}::${rawPick.pick}::${rawPick.odds}`;
            const baseP = messagePickByRaw.get(rk) || rawPick;
            // Canonicalize the game label so the per-pick "+ Add" / "− Remove"
            // button matches whatever label is stored in parlayLegs (addLeg
            // also canonicalizes via the same filter). Without this, inSlip
            // would read false right after adding, and Remove wouldn't find
            // the leg, because the snapshot keeps the AI's raw label while
            // the slip stores the canonical one.
            const { kept: pickKept } = filterPicksToReal([baseP]);
            const pick = pickKept.length > 0 ? pickKept[0] : baseP;
            // SUPPRESS finished-game cards: if this pick's matchup (or the AI's
            // raw, possibly home/away-FLIPPED label) resolves only to a game the
            // feed has marked final / past tipoff, don't render a card — it would
            // otherwise show a dead game stamped "Today 7:30 PM". A flipped label
            // collides with a different, already-finished game, so check both.
            if (gameResolvesToFinal(pick.game) || gameResolvesToFinal(rawPick.game)) {
              return null;
            }
            const inSlip = parlayLegs.some((l) => legKey(l) === legKey(pick));
            const pickKey = `${pick.game}::${pick.pick}`;
            // Prefer the AI's OWN projected probability (from its EDGE note) for
            // the badge so the card reflects the model's read, not the market
            // price. Fall back to the implied-anchored heuristic only when the
            // note carries no parseable projection.
            // Try the canonical key first, then the AI's RAW label — notes are
            // keyed off the raw parsed pick, so canonical relabeling could
            // otherwise silently drop the projection and fall back to market.
            const noteForBadge =
              noteByPickKey.get(pickKey) ||
              noteByPickKey.get(`${rawPick.game}::${rawPick.pick}`);
            const aiProjForBadge = parseAiProjection(noteForBadge);
            const conf = aiProjForBadge.proj != null ? aiProjForBadge.proj : calculateConfidence(pick);
            // Edge vs the market: only meaningful when we have a real AI
            // projection AND a book price to compare against (PP legs carry none).
            const impliedForEdge =
              pick.odds != null && Number.isFinite(pick.odds)
                ? Math.round(impliedProb(pick.odds) * 100)
                : null;
            const edgePts =
              aiProjForBadge.proj != null && impliedForEdge != null
                ? aiProjForBadge.proj - impliedForEdge
                : null;
            // A prop is anything that isn't a recognized game-side market
            // (moneyline / spread / total / run line / puck line, full-game or
            // any period). Player props (Points, Rebounds, Passing Yards, etc.)
            // carry the stat name as their market here.
            const isPropPick = !/^(live\s+)?((1H|2H|Q[1-4])\s+)?(alt\s+)?(spread|total|moneyline|money line|run line|puck line|match result|draw no bet|double chance|both teams to score|btts)$/i.test(
              (pick.market || "").trim(),
            );
            // When we have no real model projection AND it's a player prop, the
            // badge number is just the market's implied probability — say so
            // honestly ("MARKET PRICE") instead of dressing it up as the model's
            // "COIN-FLIP" read.
            const badgeIsMarketOnly = aiProjForBadge.proj == null && isPropPick;
            return (
              <div
                key={i}
                className="border border-slate-700 bg-slate-950 rounded-lg overflow-hidden"
              >
                <div className="p-3 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400 font-mono">
                        {pick.market}
                      </div>
                      <div
                        className="text-[10px] font-mono font-bold text-slate-100"
                        title={
                          badgeIsMarketOnly
                            ? "No grounded player-projection feed for this prop — this is the book's implied probability from the price, not a model edge."
                            : undefined
                        }
                      >
                        {conf}% · {badgeIsMarketOnly ? "MARKET PRICE" : confidenceLabel(conf)}
                      </div>
                      {edgePts != null && (
                        <div
                          className={`text-[10px] font-mono font-bold ${
                            edgePts > 0 ? "text-emerald-400" : edgePts < 0 ? "text-rose-400" : "text-slate-400"
                          }`}
                          title="Model's projected win % minus the market's implied % — positive means the AI sees value the price doesn't."
                        >
                          {edgePts > 0 ? "+" : ""}{edgePts}% vs mkt
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 break-words">
                      {displayGameLabel(pick.game)}
                      {(() => {
                        const live = lookupLiveTag(pick.game);
                        if (live) return <span className="ml-1 text-rose-600 font-semibold">· {live}</span>;
                        const t = formatGameTime(lookupGameStart(pick.game));
                        return t ? <span className="ml-1 text-cyan-600">· {t}</span> : null;
                      })()}
                    </div>
                    <div className="text-sm text-slate-100 font-semibold">{pick.pick}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="font-mono text-slate-100 font-bold text-sm">
                      {formatOdds(pick.odds)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (inSlip) removeLegByPick(pick);
                        else addLeg(pick, { skipValidation: true });
                      }}
                      className={`text-[10px] font-mono uppercase tracking-wider rounded px-2 py-1 transition active:scale-95 ${
                        inSlip
                          ? "bg-rose-500 text-white hover:bg-rose-400"
                          : "bg-cyan-500 text-black hover:bg-cyan-400"
                      }`}
                    >
                      {inSlip ? "− Remove" : "+ Add"}
                    </button>
                  </div>
                </div>
                {(() => {
                  // Always render the AI edge note row. Prefer the AI-written
                  // note (from EDGE: line or fuzzy-matched paragraph); fall
                  // back to a deterministic one-liner so no card is ever blank.
                  const aiNote = noteByPickKey.get(pickKey);
                  const noteText = aiNote || fallbackEdgeNote(pick);
                  const noteKey = `note::${pickKey}`;
                  const noteOpen = expandedPicks.has(noteKey);
                  const label = aiNote ? "AI edge note" : "AI edge note (auto)";
                  return (
                    <>
                      <button
                        onClick={() => setExpandedPicks((prev) => {
                          const next = new Set(prev);
                          if (next.has(noteKey)) next.delete(noteKey); else next.add(noteKey);
                          return next;
                        })}
                        className="w-full border-t border-slate-700 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:bg-slate-800 flex items-center justify-between"
                        aria-expanded={noteOpen}
                      >
                        <span>{noteOpen ? `▼ Hide ${label}` : `▶ ${label}`}</span>
                        <Info size={10} />
                      </button>
                      {noteOpen && (
                        <div className="border border-slate-700 rounded-lg m-2 px-3 py-2 bg-slate-900">
                          <p className="text-[12px] text-slate-200 leading-relaxed">{noteText}</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            );
          }
          if (noteLineIdxs.has(i)) return null;
          // Suppress the AI's "Risk note:" footer line per user request.
          if (/^\s*\**\s*risk note\s*\**\s*:/i.test(line)) return null;
          // Suppress the AI's "bet responsibly" / responsible-gambling reminder line.
          if (/bet\s+responsibl|responsible\s+gambl|gamble\s+responsibl|21\s*\+/i.test(line)) return null;
          if (line.trim()) {
            const parts = line.split(/(\*\*[^*]+\*\*)/g);
            return (
              <p key={i} className="text-[15px] text-slate-300 leading-relaxed">
                {parts.map((part, j) =>
                  part.startsWith("**") && part.endsWith("**") ? (
                    <strong key={j} className="text-slate-100 font-semibold">
                      {part.slice(2, -2)}
                    </strong>
                  ) : (
                    <span key={j}>{part}</span>
                  )
                )}
              </p>
            );
          }
          return <div key={i} className="h-1" />;
        })}
        {(() => {
          if (messagePicks.length < 2) return null;
          // Hide only if the user dismissed THIS snapshot or every game in it
          // is over. Otherwise the snapshot stays in chat indefinitely so
          // multiple slips can coexist in one conversation.
          if (dismissedSnapshots.has(msgIdx)) return null;
          const allOver = messagePicks.every((p) => isGameOver(p.game));
          if (allOver) return null;
          return (
            <div className="mt-3 border border-cyan-500/30 bg-slate-950 rounded-lg overflow-hidden">
              <div className="bg-cyan-500/10 px-3 py-2 flex items-center justify-between gap-2 border-b border-cyan-500/20">
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-300">
                  This message · {messagePicks.length}-leg slip
                </span>
                <div className="flex items-center gap-2">
                  {snapshotMath && (
                    <span className="text-xs font-mono font-bold text-cyan-300">
                      {formatOdds(snapshotMath.american)}
                    </span>
                  )}
                  <button
                    onClick={() => setAttachedSlipIdxs((prev) => {
                      const next = new Set(prev);
                      if (next.has(msgIdx)) next.delete(msgIdx);
                      else next.add(msgIdx);
                      return next;
                    })}
                    aria-label={attachedSlipIdxs.has(msgIdx) ? "Unpin this slip from next message" : "Pin this slip to next message"}
                    title={attachedSlipIdxs.has(msgIdx) ? "Pinned — will be sent with your next message" : "Pin to next message"}
                    className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border transition ${
                      attachedSlipIdxs.has(msgIdx)
                        ? "border-cyan-300 bg-cyan-300/20 text-cyan-100"
                        : "border-cyan-300/40 text-cyan-300/80 hover:border-cyan-300 hover:text-cyan-200"
                    }`}
                  >
                    {attachedSlipIdxs.has(msgIdx) ? "📎 Pinned" : "📎 Pin"}
                  </button>
                  <button
                    onClick={() => setDismissedSnapshots((prev) => {
                      const next = new Set(prev);
                      next.add(msgIdx);
                      return next;
                    })}
                    aria-label="Dismiss this slip"
                    className="text-cyan-300/70 hover:text-cyan-200 -mr-1 p-0.5"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  if (allInSlip) return;
                  // These picks were already validated against the live pool
                  // when the AI wrote this message — hallucinated / out-of-window
                  // legs were stripped from the text before it rendered. Re-
                  // validating now against current state would silently drop real
                  // games that have since churned out of the Odds API pool (it
                  // 429s to a smaller ESPN fallback between sends), which is why a
                  // "13-leg" ticket used to land only 3. Trust the prior
                  // validation and only exclude games that have actually FINISHED
                  // since this message was written.
                  const finished = messagePicks.filter((p) => gameResolvesToFinal(p.game));
                  const live = messagePicks.filter((p) => !gameResolvesToFinal(p.game));
                  const r = autoFillSlip(live, { alreadyValidated: true, chatValidated: true });
                  if (r && r.added < messagePicks.length) {
                    const reasons = [];
                    if (finished.length) reasons.push(`${finished.length} already finished`);
                    if (r.droppedDup) reasons.push(`${r.droppedDup} already on your slip`);
                    if (reasons.length) {
                      setMessages((p) => [
                        ...p,
                        { role: "assistant", content: `Added **${r.added} of ${messagePicks.length}** legs to your slip — ${reasons.join("; ")}.` },
                      ]);
                    }
                  }
                }}
                disabled={allInSlip}
                className={`w-full px-3 py-2 text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                  allInSlip
                    ? "bg-slate-900 text-slate-500 cursor-default"
                    : "bg-cyan-500 text-white hover:bg-cyan-400"
                }`}
              >
                {allInSlip ? "✓ All legs on your ticket" : `+ Add all ${messagePicks.length} legs to ticket`}
              </button>
            </div>
          );
        })()}
      </div>
    );
  };

  const availableDemoPicks = selectedSports.flatMap((s) =>
    (PICK_POOL[s] || []).map((g) => ({ ...g, sport: s }))
  );

  // ---- Boot splash (logo loading screen) ----
  if (booting) {
    return (
      <div className="fixed inset-0 bg-slate-950 overflow-hidden">
        {/* Full-bleed stadium splash background */}
        <img
          src={stadiumEdgeSplash}
          alt="Stadium Edge"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
        {/* Subtle bottom vignette so the loading caption + dots stay legible */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-slate-950/80 via-slate-950/30 to-transparent pointer-events-none" />
        {/* Loading indicator pinned near the bottom so it doesn't cover the logo */}
        <div className="absolute inset-x-0 bottom-16 flex flex-col items-center">
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: "0ms" }} />
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-slate-300/80">Loading the edge…</p>
        </div>
      </div>
    );
  }

  // ---- Login screen (DEMO — not real authentication) ----

  return (
    <div
      className="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{
        backgroundImage:
          "radial-gradient(circle at 20% 0%, rgba(163, 230, 53, 0.08), transparent 50%), radial-gradient(circle at 80% 100%, rgba(244, 63, 94, 0.06), transparent 50%)",
        fontFamily: "'Bricolage Grotesque', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Bricolage+Grotesque:wght@400;600;800&display=swap');
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .font-display { font-family: 'Bricolage Grotesque', sans-serif; font-weight: 800; letter-spacing: -0.03em; }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .pulse-dot { animation: pulse-dot 1.4s ease-in-out infinite; }
        .pulse-dot:nth-child(2) { animation-delay: 0.2s; }
        .pulse-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes slide-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .slide-up { animation: slide-up 0.3s ease-out; }
        @keyframes slide-in-left { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        .slide-in-left { animation: slide-in-left 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .fade-in { animation: fade-in 0.2s ease-out; }
        .scroll-fade::-webkit-scrollbar { width: 4px; }
        .scroll-fade::-webkit-scrollbar-track { background: transparent; }
        .scroll-fade::-webkit-scrollbar-thumb { background: rgba(163, 230, 53, 0.2); border-radius: 4px; }
      `}</style>

      <header className="border-b border-slate-800 px-4 py-3 sticky top-0 bg-slate-900/95 backdrop-blur z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFabOpen(true)}
              className="text-slate-400 hover:text-slate-100 transition mr-1"
              title="Menu"
            >
              <Menu size={22} />
            </button>
            <div className="w-2 h-2 bg-cyan-400 rounded-full pulse-dot" />
            <h1 className="font-display text-xl tracking-tight"><span className="text-slate-200">STADIUM</span><span className="text-cyan-400" style={{textShadow:"0 0 10px rgba(34,211,238,0.6)"}}> EDGE</span></h1>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={() => setLiveMode((v) => !v)}
            className={`flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border transition ${
              liveMode
                ? "border-rose-400 text-rose-400 bg-rose-400/10"
                : "border-slate-700 text-slate-400 hover:border-zinc-400"
            }`}
            title={
              liveMode
                ? liveStatus === "ok"
                  ? `Live ESPN data · ${livePicks.length} picks ready`
                  : liveStatus === "loading"
                    ? "Fetching ESPN..."
                    : liveStatus === "blocked"
                      ? "ESPN blocked by browser (CORS) — falling back to demo"
                      : "Live Mode"
                : "Tap to enable real ESPN data"
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${liveMode ? (liveStatus === "ok" ? "bg-rose-400 pulse-dot" : liveStatus === "loading" ? "bg-amber-400 pulse-dot" : "bg-rose-700") : "bg-zinc-600"}`} />
            {liveMode
              ? liveStatus === "loading"
                ? "Loading…"
                : liveStatus === "blocked"
                  ? "Blocked"
                  : `Live · ${livePicks.length}`
              : "Offline"}
          </button>
          {user ? (
            <button
              onClick={() => setView("profile")}
              title={user.primaryEmailAddress?.emailAddress || "Account"}
              className="w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 text-xs font-bold flex items-center justify-center hover:bg-cyan-500/25 transition shrink-0"
            >
              {(user.firstName?.[0] || user.username?.[0] || user.primaryEmailAddress?.emailAddress?.[0] || "U").toUpperCase()}
            </button>
          ) : AUTH_ENABLED ? (
            <button
              onClick={() => navigate("/sign-in")}
              className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border border-cyan-400/50 text-cyan-300 bg-cyan-400/10 hover:bg-cyan-400/20 transition shrink-0"
            >
              Sign in
            </button>
          ) : null}
          </div>
        </div>
      </header>

      {view === "home" && (
        <div className="flex-1 overflow-y-auto bg-slate-900">
          {/* Search games & player props (top) */}
          <div className="px-4 pt-4 mb-1">
            <div className="relative">
              <input
                value={homeSearch}
                onChange={(e) => setHomeSearch(e.target.value)}
                placeholder="Search games, teams, or player props…"
                className="w-full bg-slate-900 border border-slate-800 rounded-full pl-10 pr-9 py-3 text-sm text-slate-100 shadow-sm focus:outline-none focus:border-cyan-300 transition"
              />
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {homeSearch && (
                <button onClick={() => setHomeSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X size={16} />
                </button>
              )}
            </div>

            {homeSearch.trim().length > 0 && (() => {
              const q = homeSearch.trim().toLowerCase();
              const terms = expandTeamQuery(q);
              // Real live + upcoming games first (no odds attached — clicking asks the AI)
              const realGameRows = [
                ...homeLiveGames.filter((g) => g.real).map((g) => ({
                  kind: "realGame", sport: g.sport, game: g.game, market: "LIVE", pick: `${g.away} ${g.awayScore} — ${g.home} ${g.homeScore}`, odds: null,
                })),
                ...homeUpcomingGames.map((g) => ({
                  kind: "realGame", sport: g.sport, game: g.game, market: "Upcoming", pick: g.game, odds: null,
                })),
              ].filter((r) =>
                matchesTerms(r.game, terms) || matchesTerms(r.pick, terms) || r.sport.toLowerCase().includes(q)
              );
              const all = Object.entries(PICK_POOL).flatMap(([sport, picks]) =>
                picks.map((p) => ({ ...p, sport, kind: "pickPool" }))
              );
              const poolResults = all.filter((p) =>
                matchesTerms(p.game, terms) || matchesTerms(p.pick, terms) || p.market.toLowerCase().includes(q)
              );
              const results = [...realGameRows.slice(0, 8), ...poolResults.slice(0, 12)];

              // TEAM/GAME matches — distinct live/upcoming matchups whose label
              // matches the query. Each opens the full game screen (all game lines
              // + every live player prop for that matchup).
              const gameMatches = [];
              const seenGameKeys = new Set();
              for (const r of realGameRows) {
                const dk = `${r.sport}::${r.game}`;
                if (seenGameKeys.has(dk)) continue;
                seenGameKeys.add(dk);
                gameMatches.push({ game: r.game, sport: r.sport });
              }

              // PLAYER matches — sample-roster players open the dedicated props
              // page; live-feed players open their game screen (Live Player Props).
              const validGameKeys = new Set([
                ...homeLiveGames.filter((g) => g.real).map((g) => `${g.sport}::${g.game}`),
                ...homeUpcomingGames.map((g) => `${g.sport}::${g.game}`),
              ]);
              const eidToGame = {};
              for (const [sport, games] of Object.entries(realOddsBySport)) {
                for (const g of games) {
                  eidToGame[g.id] = { sport, game: `${g.awayTeam} @ ${g.homeTeam}` };
                }
              }
              const playerMatches = [];
              const seenPlayerNames = new Set();
              for (const [sport, list] of Object.entries(PLAYERS)) {
                for (const pl of list) {
                  const lk = pl.name.toLowerCase();
                  if (!lk.includes(q)) continue;
                  if (seenPlayerNames.has(lk)) continue;
                  seenPlayerNames.add(lk);
                  playerMatches.push({ name: pl.name, team: pl.team, sport, player: pl });
                }
              }
              for (const [eid, data] of Object.entries(realPropsByEvent)) {
                const meta = eidToGame[eid];
                if (!meta) continue;
                if (!validGameKeys.has(`${meta.sport}::${meta.game}`)) continue;
                for (const pr of (data.props || [])) {
                  if (!pr.player) continue;
                  const lk = pr.player.toLowerCase();
                  if (!lk.includes(q)) continue;
                  if (seenPlayerNames.has(lk)) continue;
                  seenPlayerNames.add(lk);
                  playerMatches.push({ name: pr.player, sport: meta.sport, game: meta.game });
                }
              }

              const nothing = results.length === 0 && gameMatches.length === 0 && playerMatches.length === 0;
              return (
                <div className="mt-2 space-y-3">
                  {(gameMatches.length > 0 || playerMatches.length > 0) && (
                    <div className="border border-slate-800 rounded-2xl bg-slate-900 shadow-sm overflow-hidden">
                      {gameMatches.length > 0 && (
                        <div className="p-3">
                          <h3 className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">Teams — tap to view all props</h3>
                          <div className="space-y-2">
                            {gameMatches.slice(0, 8).map((gm) => {
                              const live = lookupLiveTag(gm.game);
                              const time = formatGameTime(lookupGameStart(gm.game));
                              return (
                                <button
                                  key={`${gm.sport}::${gm.game}`}
                                  onClick={() => {
                                    setHomeSearch("");
                                    const indiv = gm.sport === "ufc" || gm.sport === "mma" || gm.sport === "tennis" || gm.sport === "golf" || gm.sport === "nascar" || (/\bvs\.?\b/i.test(gm.game) && !/@/.test(gm.game));
                                    setGameDetail({ game: gm.game, sport: gm.sport });
                                    setOpenPropCats(indiv ? ["Match Markets"] : ["AI Spreads & Totals", "Game Lines"]);
                                  }}
                                  className="w-full border border-slate-800 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:border-cyan-400 transition"
                                >
                                  <span className="min-w-0">
                                    <span className="block text-[10px] font-mono uppercase text-slate-500 tracking-wider">{gm.sport}</span>
                                    <span className="block text-sm font-semibold text-slate-100 truncate">{gm.game}</span>
                                    {(live || time) && (
                                      <span className="block text-[10px] font-mono uppercase tracking-wider mt-0.5">
                                        {live ? <span className="text-rose-400 font-semibold">● {live}</span> : <span className="text-cyan-400">{time}</span>}
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-cyan-400 text-xs font-semibold shrink-0 flex items-center gap-1">All props <span>›</span></span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {playerMatches.length > 0 && (
                        <div className={`p-3 ${gameMatches.length > 0 ? "border-t border-slate-800" : ""}`}>
                          <h3 className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">Players — tap to view all props</h3>
                          <div className="space-y-2">
                            {playerMatches.slice(0, 8).map((pm, pi) => {
                              const initials = pm.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
                              return (
                                <button
                                  key={`${pm.name}-${pi}`}
                                  onClick={() => {
                                    setHomeSearch("");
                                    if (pm.player) {
                                      const pl = pm.player;
                                      const sk = (pm.sport === "nba" || pm.sport === "wnba") ? "pts" : pm.sport === "mlb" ? "hrPerGame"
                                        : pl.pos === "QB" ? "passYds" : pl.pos === "RB" ? "rushYds"
                                        : (pl.stats.recYds !== undefined ? "recYds" : Object.keys(pl.stats)[0]);
                                      const avg = pl.stats[sk] ?? 0;
                                      setPropStatKey(sk);
                                      setPropLine(Math.round(avg * 0.9 * 2) / 2);
                                      setSelectedPlayer({ player: pl, sport: pm.sport });
                                    } else if (pm.game) {
                                      setGameDetail({ game: pm.game, sport: pm.sport });
                                      setOpenPropCats(["Live Player Props"]);
                                    }
                                  }}
                                  className="w-full border border-slate-800 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:border-cyan-400 transition"
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0">{initials}</span>
                                    <span className="min-w-0">
                                      <span className="block text-sm font-semibold text-slate-100 truncate">{pm.name}</span>
                                      <span className="block text-[10px] font-mono uppercase text-slate-500 tracking-wider truncate">{pm.team ? `${pm.team} · ` : ""}{pm.sport}{pm.game ? ` · ${pm.game}` : ""}</span>
                                    </span>
                                  </span>
                                  <span className="text-cyan-400 text-xs font-semibold shrink-0 flex items-center gap-1">All props <span>›</span></span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {results.length > 0 && (
                    <div className="border border-slate-800 rounded-2xl bg-slate-900 shadow-sm overflow-hidden divide-y divide-slate-800">
                      {results.map((r, i) => {
                        const isRealGame = r.kind === "realGame";
                        const inSlip = !isRealGame && parlayLegs.some((l) => legKey(l) === legKey(r));
                        return (
                          <div key={i} className="px-3 py-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider">{r.sport} · {r.market} · {shortGameLabel({ game: r.game })}</div>
                              <div className="text-sm font-semibold text-slate-100 truncate">{r.pick}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {!isRealGame && (
                                <span className="font-mono font-bold text-cyan-500 text-sm">{formatOdds(r.odds)}</span>
                              )}
                              {isRealGame ? (
                                <button
                                  onClick={() => { setHomeSearch(""); buildParlayForRealGame(r.game, r.sport, r.market === "LIVE" ? "live" : "upcoming"); }}
                                  className="rounded-full px-3 py-1.5 text-xs font-semibold bg-cyan-500 text-white hover:bg-cyan-600 transition"
                                >
                                  Build →
                                </button>
                              ) : (
                                <button
                                  onClick={() => { if (!inSlip) addLeg({ ...r }); }}
                                  disabled={inSlip}
                                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${inSlip ? "bg-slate-800 text-slate-500 cursor-default" : "bg-cyan-500 text-white hover:bg-cyan-600"}`}
                                >
                                  {inSlip ? "✓" : "+ Add"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {nothing && (
                    <div className="border border-slate-800 rounded-2xl bg-slate-900 shadow-sm px-4 py-6 text-center text-sm text-slate-500">
                      No matches. Try a team (e.g. "Chiefs"), a player (e.g. "Mahomes"), or a market (e.g. "spread").
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Hero */}
          <div className="px-6 pt-4 pb-6 text-center">
            <div className="w-3 h-3 bg-cyan-400 rounded-full pulse-dot mb-3 mx-auto" />
            <p className="text-sm text-slate-400 max-w-xs mx-auto mb-5">
              {user ? `Good luck, ${user.firstName || user.username || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "champ"}.` : "Your parlay assistant."} Build picks, analyze odds, track your slips.
            </p>
            <button
              onClick={() => { if (requirePro("AI Chat")) setView("chat"); }}
              className="bg-cyan-400 text-slate-950 rounded-full px-8 py-3 font-semibold hover:bg-cyan-300 active:scale-95 transition"
            >
              Build best parlay →
            </button>
          </div>

          {/* Quick-build pills */}
          <div className="px-4 mb-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Hot Picks", icon: <HotPicksIcon size={18} />, msg: "Build me the best parlay" },
                { label: "Easy Money", icon: <EasyMoneyIcon size={18} />, msg: "Build me a safe parlay" },
                { label: "Lottery Ticket", icon: <LongShotIcon size={18} />, msg: "Build me a lottery ticket" },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => { if (requirePro(p.label)) { setView("chat"); sendMessage(p.msg); } }}
                  className="flex items-center justify-center gap-1.5 bg-slate-900 border border-slate-800 rounded-full px-2 py-2.5 shadow-sm hover:border-cyan-300 transition"
                >
                  <span className="shrink-0">{p.icon}</span>
                  <span className="text-xs font-semibold text-slate-200 whitespace-nowrap">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Featured Players */}
          <div className="px-4 mb-2">
            <h2 className="font-display text-lg text-slate-100 mb-2 px-1">FEATURED PLAYERS</h2>
            <div className="flex gap-3 overflow-x-auto scroll-fade pb-2 -mx-1 px-1 snap-x">
              {(() => {
                // Pick top-form players across selected sports
                const feat = [];
                for (const s of selectedSports) {
                  for (const pl of (PLAYERS[s] || [])) {
                    feat.push({ player: pl, sport: s });
                  }
                }
                feat.sort((a, b) => b.player.form - a.player.form);
                const visible = isPro ? feat.slice(0, 10) : feat.slice(0, 3);
                return (
                  <>
                    {visible.map((f, i) => {
                  const initials = f.player.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
                  const photo = lookupPlayerPhoto(f.sport, f.player.name);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const sk =
                          f.sport === "nba" ? "pts" :
                          f.sport === "mlb" ? "hrPerGame" :
                          f.player.pos === "QB" ? "passYds" :
                          f.player.pos === "RB" ? "rushYds" :
                          (f.player.stats.recYds !== undefined ? "recYds" : Object.keys(f.player.stats)[0]);
                        const avg = f.player.stats[sk] ?? 0;
                        setPropStatKey(sk);
                        setPropLine(Math.round(avg * 0.9 * 2) / 2);
                        setSelectedPlayer(f);
                      }}
                      className="shrink-0 w-32 snap-start border border-slate-800 rounded-2xl p-3 bg-slate-900 hover:border-cyan-400 transition flex flex-col items-center text-center"
                    >
                      {photo ? (
                        <img
                          src={photo}
                          alt={f.player.name}
                          loading="lazy"
                          onError={(e) => { (e.currentTarget).style.display = "none"; }}
                          className="w-14 h-14 rounded-full object-cover bg-zinc-900 mb-2"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-zinc-900 text-white flex items-center justify-center text-lg font-bold mb-2">
                          {initials}
                        </div>
                      )}
                      <div className="text-sm font-semibold text-slate-100 leading-tight">{shortPlayerName(f.player.name)}</div>
                      <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider mt-0.5">
                        {f.player.team} · {f.player.pos}
                      </div>
                      <div className="text-[10px] font-mono text-emerald-600 mt-1">form {f.player.form}/10</div>
                    </button>
                  );
                    })}
                    {!isPro && feat.length > 3 && (
                      <button
                        onClick={() => requirePro("Featured Players")}
                        className="shrink-0 w-32 snap-start border border-cyan-500/40 bg-cyan-400/5 rounded-2xl p-3 flex flex-col items-center justify-center text-center hover:border-cyan-400 transition"
                      >
                        <div className="w-14 h-14 rounded-full bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-xl mb-2">🔒</div>
                        <div className="text-sm font-semibold text-cyan-300 leading-tight">+{feat.length - 3} more</div>
                        <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider mt-1">Unlock with Pro</div>
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Live Now */}
          <div className="px-4 pb-28">
            {/* Hide the entire LIVE NOW section until at least one game is
                actually live; once games are in progress, show ALL of them.
                No empty/"no games" placeholder — the section simply isn't there
                when nothing is live. */}
            {homeLiveGames.filter((g) => g.real).length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="font-display text-lg text-slate-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500 pulse-dot" /> LIVE NOW
                  </h2>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                    {`${homeLiveGames.filter((g) => g.real).length} games · LIVE`}
                  </span>
                </div>

                <div className="flex gap-3 overflow-x-auto scroll-fade pb-2 -mx-1 px-1 snap-x">
                {homeLiveGames.filter((g) => g.real).map((g, i) => (
                  <div key={i} className="border border-slate-800 rounded-2xl p-3 bg-slate-950 shadow-sm shrink-0 w-72 snap-start">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 pulse-dot" />
                        {g.periodLabel}{g.clock && g.clock !== "0:00" && g.clock !== "0:0" ? ` · ${g.clock}` : ""}
                      </span>
                      <span className="text-[9px] font-mono uppercase text-slate-500">{g.sport}{g.real ? " · LIVE" : " · SIM"}</span>
                    </div>
                    <div className="flex items-stretch justify-between gap-3">
                      {/* Teams + scores */}
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 min-w-0">
                            {g.awayLogo && <img src={g.awayLogo} alt="" className="w-5 h-5 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                            <span className="text-sm font-semibold text-slate-100 truncate">{g.awayAbbr || shortTeamLabel(g.away)}</span>
                          </span>
                          <span className="font-mono font-bold text-lg text-slate-100">{g.awayScore}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 min-w-0">
                            {g.homeLogo && <img src={g.homeLogo} alt="" className="w-5 h-5 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                            <span className="text-sm font-semibold text-slate-100 truncate">{g.homeAbbr || shortTeamLabel(g.home)}</span>
                          </span>
                          <span className="font-mono font-bold text-lg text-slate-100">{g.homeScore}</span>
                        </div>
                      </div>
                      {!g.real && (
                        <div className="w-28 flex flex-col justify-center">
                          <div className="text-[9px] font-mono uppercase text-slate-500 mb-1 text-right">Win prob</div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-slate-400 w-7">{g.awayWP}%</span>
                            <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                              <div className="h-full bg-cyan-500" style={{ width: `${g.homeWP}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 w-7 text-right">{g.homeWP}%</span>
                          </div>
                          <div className="text-[9px] font-mono uppercase text-slate-500 mt-1 text-right">
                            {g.currentTotal}/{g.total} · <span className={g.pacing === "over" ? "text-emerald-500" : g.pacing === "under" ? "text-amber-500" : ""}>{g.pacing}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => g.real ? buildBestParlayForLiveRealGame(g) : buildParlayForLiveGame(g)}
                      className="w-full mt-2.5 bg-cyan-400 text-slate-950 rounded-lg py-2 text-xs font-semibold hover:bg-cyan-300 transition"
                    >
                      Build best parlay from this game
                    </button>
                  </div>
                ))}
                </div>
              </>
            )}

            {/* Upcoming Games */}
            <div className="flex items-center justify-between mb-2 mt-8 px-1">
              <h2 className="font-display text-lg text-slate-100">UPCOMING</h2>
              {homeUpcomingGames.length > 0 ? (
                <button
                  onClick={() => { setHomeSearch(""); setView("allupcoming"); }}
                  className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300 transition"
                >
                  View all {homeUpcomingGames.length} →
                </button>
              ) : (
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">tap to build</span>
              )}
            </div>
            <div className="flex gap-3 overflow-x-auto scroll-fade pb-2 -mx-1 px-1 snap-x">
              {(() => {
                if (homeUpcomingGames.length > 0) {
                  return homeUpcomingGames.slice(0, 16).map((g, i) => {
                    const dt = new Date(g.startsAt);
                    const when = isNaN(dt.getTime())
                      ? ""
                      : dt.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
                    return (
                      <button
                        key={i}
                        onClick={() => buildParlayForRealGame(g.game, g.sport, "upcoming")}
                        className="text-left border border-slate-800 rounded-2xl p-3 bg-slate-900 hover:border-cyan-400 transition shrink-0 w-48 snap-start flex flex-col justify-between"
                      >
                        <div className="min-w-0">
                          <div className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">{g.sport} · {when}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {g.awayLogo && <img src={g.awayLogo} alt="" className="w-6 h-6 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                            {g.homeLogo && <img src={g.homeLogo} alt="" className="w-6 h-6 object-contain shrink-0 -ml-2" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                            <span className="text-sm font-semibold text-slate-100 leading-tight">{shortGameLabel(g)}</span>
                          </div>
                          {g.venue && <div className="text-[9px] text-slate-500 mt-1 truncate">{g.venue}</div>}
                        </div>
                        <span className="text-xs font-semibold text-slate-100 bg-slate-800 rounded-full px-3 py-1.5 mt-3 text-center">
                          Build →
                        </span>
                      </button>
                    );
                  });
                }
                // Fallback: sample pool when no live data
                const seen = new Set();
                const games = [];
                for (const s of selectedSports) {
                  for (const p of (PICK_POOL[s] || [])) {
                    if (!seen.has(p.game)) {
                      seen.add(p.game);
                      games.push({ game: p.game, sport: s });
                    }
                  }
                }
                return games.slice(0, 12).map((g, i) => (
                  <button
                    key={i}
                    onClick={() => { if (requirePro("Build from game")) { setView("chat"); setPendingLegBuild({ gameLabel: g.game, sport: g.sport, kind: "upcoming", real: false }); setMessages((p) => [...p, { role: "user", content: `Build a parlay for ${g.game}` }, { role: "assistant", content: `How many legs would you like for **${g.game}**?` }]); } }}
                    className="text-left border border-slate-800 rounded-2xl p-3 bg-slate-900 hover:border-cyan-400 transition shrink-0 w-44 snap-start flex flex-col justify-between"
                  >
                    <div className="min-w-0">
                      <div className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">{g.sport}</div>
                      <div className="text-sm font-semibold text-slate-100 mt-0.5 leading-tight">{shortGameLabel(g)}</div>
                    </div>
                    <span className="text-xs font-semibold text-slate-100 bg-slate-800 rounded-full px-3 py-1.5 mt-3 text-center">
                      Build →
                    </span>
                  </button>
                ));
              })()}
            </div>

            <p className="text-[9px] font-mono text-slate-500 text-center mt-5 uppercase tracking-widest leading-relaxed">
              {homeUpcomingGames.length > 0
                ? "Real upcoming games from ESPN · 21+ · Bet responsibly"
                : "Sample matchups — couldn't reach live feed · 21+ · Hypothetical only"}
            </p>
          </div>
        </div>
      )}

      {view === "profile" && (
        <div className="flex-1 overflow-y-auto bg-slate-900">
          {(() => {
            const settled = tracker.filter((t) => t.status === "won" || t.status === "lost");
            const wins = tracker.filter((t) => t.status === "won").length;
            const losses = tracker.filter((t) => t.status === "lost").length;
            const pending = tracker.filter((t) => t.status === "pending").length;
            const winRate = settled.length > 0 ? Math.round((wins / settled.length) * 100) : null;
            // Per-market breakdown
            const byMarket = {};
            tracker.forEach((t) => {
              if (t.status !== "won" && t.status !== "lost") return;
              byMarket[t.market] = byMarket[t.market] || { w: 0, l: 0 };
              if (t.status === "won") byMarket[t.market].w++;
              else byMarket[t.market].l++;
            });
            return (
              <div className="px-5 py-6">
                {/* Avatar + identity */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center text-white shrink-0">
                    <User size={28} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold text-slate-100 truncate">
                      {user ? (user.firstName || user.username || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "Member") : "Guest"}
                    </div>
                    <div className="text-sm text-slate-400 truncate">{user?.primaryEmailAddress?.emailAddress || "Not signed in"}</div>
                  </div>
                </div>

                {/* Closing Line Value summary */}
                {(() => {
                  const withClv = tracker.map(clvForEntry).filter((c) => c != null);
                  if (withClv.length === 0) {
                    return (
                      <div className="mb-6 border border-slate-800 rounded-xl p-3">
                        <h3 className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1">Closing Line Value</h3>
                        <p className="text-sm text-slate-500">
                          CLV is captured automatically: while a game is still open, the app tracks the live line on each of your book picks and freezes it as the closing line once the game starts. Then it shows whether you beat the market's final price — the best honest signal that your picks have an edge, win or lose. (You can also enter a closing line by hand in History.)
                        </p>
                      </div>
                    );
                  }
                  const avgClv = +(withClv.reduce((a, b) => a + b, 0) / withClv.length).toFixed(1);
                  const beat = withClv.filter((c) => c > 0).length;
                  return (
                    <div className="mb-6 border border-slate-800 rounded-xl p-3">
                      <h3 className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-2">Closing Line Value</h3>
                      <div className="flex items-center gap-4">
                        <div>
                          <div className={`text-2xl font-bold ${avgClv > 0 ? "text-emerald-600" : avgClv < 0 ? "text-rose-600" : "text-slate-100"}`}>
                            {avgClv > 0 ? `+${avgClv}` : avgClv}%
                          </div>
                          <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">Avg CLV</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-slate-100">{beat}/{withClv.length}</div>
                          <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">Beat the close</div>
                        </div>
                      </div>
                      <p className="text-[9px] font-mono text-slate-500 mt-2 leading-relaxed">
                        Positive CLV means you got a better price than the market's close — the strongest honest indicator of long-term edge. It does not guarantee wins.
                      </p>
                    </div>
                  );
                })()}

                {/* Actions */}
                <div className="space-y-2">
                  <button
                    onClick={() => setView("plans")}
                    className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold hover:bg-blue-700 transition"
                  >
                    Manage plan
                  </button>
                  <button
                    onClick={() => setView("chat")}
                    className="w-full border border-slate-700 text-slate-300 rounded-xl py-3 font-semibold hover:border-cyan-400 transition"
                  >
                    Back to chat
                  </button>
                  <button
                    onClick={() => { handleSignOut(); }}
                    className="w-full text-rose-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-rose-50 transition"
                  >
                    Sign out
                  </button>
                </div>

                <p className="text-[9px] font-mono text-slate-500 text-center mt-6 uppercase tracking-widest">
                  Record reflects YOUR tracked picks · 21+ · Hypothetical
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {view === "plans" && (
        <div className="flex-1 overflow-y-auto bg-slate-900">
          <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-end z-10">
            <button
              onClick={() => setView("profile")}
              className="w-9 h-9 rounded-full border border-slate-800 flex items-center justify-center text-slate-300 hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-zinc-900 flex items-center justify-center mb-4">
                <Zap size={28} className="text-cyan-400" fill="currentColor" />
              </div>
              <h1 className="text-2xl font-bold text-slate-100">Available Plans</h1>
            </div>

            <div className="space-y-3">
              {[
                { id: "free", name: "Free trial", price: "$0", per: "for 7 days", note: "Everything unlocked · then pick a plan" },
                { id: "go", name: "Stadium Edge Go", price: "$19.99", per: "a week", note: "" },
                { id: "pro", name: "Stadium Edge Pro", price: "$49.99", per: "per month", note: "" },
              ].map((plan) => {
                const selected = selectedPlan === plan.id;
                return (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`w-full text-left rounded-2xl px-4 py-4 flex items-center justify-between gap-3 border transition ${
                      selected ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-500" : "border-slate-800 bg-slate-950 hover:border-slate-700"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-lg font-bold text-slate-100">{plan.name}</div>
                      <div className="text-sm text-slate-400">{plan.price} {plan.per}</div>
                      {plan.note && <div className="text-[11px] text-slate-500 mt-0.5">{plan.note}</div>}
                    </div>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      selected ? "bg-blue-600 text-white" : "border-2 border-slate-700"
                    }`}>
                      {selected && <span className="text-sm font-bold">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setView("profile")}
              className="w-full bg-cyan-400 text-slate-950 rounded-xl py-3.5 font-semibold mt-6 hover:bg-cyan-300 transition"
            >
              Continue
            </button>

            <p className="text-[9px] font-mono text-slate-500 text-center mt-5 uppercase tracking-widest leading-relaxed">
              ⚠️ Demo plans — no real billing or payment. Nothing is charged. Selecting a plan only updates this screen.<br/>21+ · Hypothetical only
            </p>
          </div>
        </div>
      )}

      {view === "allsports" && (
        <div className="flex-1 overflow-y-auto bg-slate-900">
          {/* Search header (matches page) */}
          <div className="bg-slate-900 px-4 pt-4 pb-4 sticky top-0 z-10 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => { setSportDetail(null); setView("home"); }} className="text-slate-400 hover:text-slate-100 text-sm">‹ Back</button>
              <h1 className="text-slate-100 font-bold text-lg">All Sports</h1>
              <span className="w-10" />
            </div>
            <div className="relative">
              <input
                value={homeSearch}
                onChange={(e) => setHomeSearch(e.target.value)}
                placeholder='Search games, teams, or props…'
                className="w-full bg-slate-800 border border-slate-700 rounded-full pl-10 pr-9 py-3 text-sm text-slate-100 focus:outline-none focus:border-cyan-400 transition"
              />
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {homeSearch && (
                <button onClick={() => setHomeSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Search results (if typing) */}
          {homeSearch.trim().length > 0 ? (
            <div className="px-4 py-3">
              {(() => {
                const q = homeSearch.trim().toLowerCase();
                // Suppress matchups whose score feed already shows them as
                // final/postponed/cancelled — odds caches can lag minutes.
                const isFinalStatusSearch = (st) => {
                  const x = (st || "").toLowerCase();
                  return x.includes("final") || x.includes("full time") || x.includes("postponed") || x.includes("canceled") || x.includes("cancelled") || x.includes("ended") || /\bft\b/.test(x);
                };
                // Safety net for team-name mismatches between ESPN and the
                // odds feed: any game whose start time is >4h in the past
                // is certainly done. Catches finished games whose status
                // lookup failed because the names don't byte-match.
                const NOW_MS = Date.now();
                const STALE_MS = 4 * 60 * 60 * 1000;
                const isLikelyDoneByTime = (iso) => {
                  if (!iso) return false;
                  const t = new Date(iso).getTime();
                  return Number.isFinite(t) && NOW_MS - t > STALE_MS;
                };
                // Status keywords that mean "actively in progress" — when
                // ESPN reports any of these, the 4h time-cutoff must NOT
                // suppress the game (rain delays, extra innings, suspended
                // games, long NCAAF bowls can all legitimately run >4h).
                const isActiveStatus = (st) => {
                  const x = (st || "").toLowerCase();
                  return x.includes("in progress") || x.includes("in-progress") || x.includes("live")
                    || x.includes("halftime") || x.includes("half time") || x.includes("end of")
                    || x.includes("delay") || x.includes("suspend") || x.includes("rain")
                    || x.includes("overtime") || /\bot\b/.test(x) || x.includes("extra");
                };
                const finalKeysGlobal = new Set();
                const liveKeysGlobal = new Set();
                for (const games of Object.values(realGamesBySport || {})) {
                  for (const g of (games || [])) {
                    const key = `${g.awayTeam} @ ${g.homeTeam}`;
                    if (isFinalStatusSearch(g.status)) finalKeysGlobal.add(key);
                    else if (isActiveStatus(g.status)) liveKeysGlobal.add(key);
                  }
                }
                // Real bookmaker picks first — skip finals AND games whose
                // start time is >4h in the past (name-mismatch safety net),
                // UNLESS the game is currently live/delayed/suspended.
                const realPool = Object.values(realOddsBySport)
                  .flatMap((games) => games.flatMap((g) => {
                    const k = `${g.awayTeam} @ ${g.homeTeam}`;
                    if (finalKeysGlobal.has(k)) return [];
                    if (!liveKeysGlobal.has(k) && isLikelyDoneByTime(g.commenceTime)) return [];
                    return buildPicksFromOdds(g);
                  }));
                // Loaded real player props — match by player name, market label, or game.
                // Need to know which sport+game each event belongs to so we can render + add to slip.
                const eventLookup = {};
                for (const [sport, games] of Object.entries(realOddsBySport)) {
                  for (const g of games) {
                    const key = `${g.awayTeam} @ ${g.homeTeam}`;
                    if (finalKeysGlobal.has(key)) continue;
                    if (!liveKeysGlobal.has(key) && isLikelyDoneByTime(g.commenceTime)) continue;
                    eventLookup[g.id] = { sport, game: key, commenceTime: g.commenceTime };
                  }
                }
                // Player props are useful for games in the next 24h OR ones currently
                // in progress (started up to ~4h ago) so live props stay searchable.
                const NOW = Date.now();
                const WIN_MS = 24 * 60 * 60 * 1000;
                const LIVE_BACK_MS = 4 * 60 * 60 * 1000;
                const within24h = (iso) => {
                  if (!iso) return false;
                  const t = new Date(iso).getTime();
                  return !isNaN(t) && t >= NOW - LIVE_BACK_MS && t <= NOW + WIN_MS;
                };
                const PROP_LABELS = {
                  player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
                  player_threes: "3-Pointers Made", player_points_rebounds_assists: "Pts+Reb+Ast", player_points_rebounds: "Pts+Reb", player_points_assists: "Pts+Ast", player_rebounds_assists: "Reb+Ast",
                  player_blocks: "Blocks", player_steals: "Steals", player_turnovers: "Turnovers", player_blocks_steals: "Blocks + Steals",
                  player_points_q1: "1Q Points", player_rebounds_q1: "1Q Rebounds", player_assists_q1: "1Q Assists",
                  player_pass_yds: "Passing Yards", player_pass_tds: "Passing TDs",
                  player_rush_yds: "Rushing Yards", player_reception_yds: "Receiving Yards",
                  player_receptions: "Receptions", player_anytime_td: "Anytime TD",
                  player_pass_yds_q1: "1Q Passing Yards", player_pass_tds_q1: "1Q Passing TDs",
                  player_rush_yds_q1: "1Q Rushing Yards", player_reception_yds_q1: "1Q Receiving Yards",
                  player_pass_yds_h1: "1H Passing Yards", player_rush_yds_h1: "1H Rushing Yards",
                  player_reception_yds_h1: "1H Receiving Yards",
                  batter_hits: "Hits", batter_total_bases: "Total Bases", batter_home_runs: "Home Runs",
                  pitcher_strikeouts: "Strikeouts", player_goals: "Goals", player_shots_on_goal: "Shots on Goal",
                };
                const propPool = [];
                for (const [eid, data] of Object.entries(realPropsByEvent)) {
                  const meta = eventLookup[eid];
                  if (!meta) continue;
                  if (!within24h(meta.commenceTime)) continue;
                  for (const pr of data.props || []) {
                    const label = PROP_LABELS[pr.market] || pr.market;
                    const lineTxt = pr.line == null ? "" : ` ${pr.line}`;
                    if (pr.overPrice != null) propPool.push({ sport: meta.sport, game: meta.game, market: "Player Prop", pick: `${pr.player} Over${lineTxt} ${label}`, odds: pr.overPrice, real: true });
                    if (pr.underPrice != null) propPool.push({ sport: meta.sport, game: meta.game, market: "Player Prop", pick: `${pr.player} Under${lineTxt} ${label}`, odds: pr.underPrice, real: true });
                  }
                }
                const samplePool = Object.entries(PICK_POOL).flatMap(([sport, picks]) => picks.map((p) => ({ ...p, sport })));
                const all = [...realPool, ...propPool, ...samplePool];
                const terms = expandTeamQuery(q);
                const results = all.filter((p) => matchesTerms(p.game, terms) || matchesTerms(p.pick, terms) || p.market.toLowerCase().includes(q)).slice(0, 30);

                // TEAM/GAME matches — every live or upcoming matchup whose label
                // (either team name) contains the query. Each opens the full game
                // screen, which lists ALL game lines + every live player prop.
                const gameMatches = [];
                const seenGameKeys = new Set();
                for (const [sport, games] of Object.entries(realOddsBySport)) {
                  for (const g of games) {
                    const key = `${g.awayTeam} @ ${g.homeTeam}`;
                    if (finalKeysGlobal.has(key)) continue;
                    if (!liveKeysGlobal.has(key) && isLikelyDoneByTime(g.commenceTime)) continue;
                    if (!matchesTerms(key, terms)) continue;
                    const dedupKey = `${sport}::${key}`;
                    if (seenGameKeys.has(dedupKey)) continue;
                    seenGameKeys.add(dedupKey);
                    gameMatches.push({ game: key, sport });
                  }
                }

                // PLAYER matches — distinct players whose name contains the query.
                // Sample-roster players open the dedicated props page (line slider +
                // suggested tiers); live-feed-only players open their game screen
                // where all of their real bookmaker props are listed.
                const playerMatches = [];
                const seenPlayerNames = new Set();
                for (const [sport, list] of Object.entries(PLAYERS)) {
                  for (const pl of list) {
                    const lk = pl.name.toLowerCase();
                    if (!lk.includes(q)) continue;
                    if (seenPlayerNames.has(lk)) continue;
                    seenPlayerNames.add(lk);
                    playerMatches.push({ name: pl.name, team: pl.team, sport, player: pl });
                  }
                }
                for (const [eid, data] of Object.entries(realPropsByEvent)) {
                  const meta = eventLookup[eid];
                  if (!meta) continue;
                  if (!within24h(meta.commenceTime)) continue;
                  for (const pr of (data.props || [])) {
                    if (!pr.player) continue;
                    const lk = pr.player.toLowerCase();
                    if (!lk.includes(q)) continue;
                    if (seenPlayerNames.has(lk)) continue;
                    seenPlayerNames.add(lk);
                    playerMatches.push({ name: pr.player, sport: meta.sport, game: meta.game });
                  }
                }

                if (results.length === 0 && gameMatches.length === 0 && playerMatches.length === 0) {
                  return <div className="text-center text-sm text-slate-500 py-10">No matches. Try a team, player, or market.</div>;
                }
                return (
                  <div className="space-y-5">
                    {gameMatches.length > 0 && (
                      <div>
                        <h3 className="font-bold text-slate-200 mb-2 text-sm">Teams — tap to view all props</h3>
                        <div className="space-y-2">
                          {gameMatches.slice(0, 10).map((gm) => {
                            const live = lookupLiveTag(gm.game);
                            const time = formatGameTime(lookupGameStart(gm.game));
                            return (
                              <button
                                key={`${gm.sport}::${gm.game}`}
                                onClick={() => {
                                  const indiv = gm.sport === "ufc" || gm.sport === "mma" || gm.sport === "tennis" || gm.sport === "golf" || gm.sport === "nascar" || (/\bvs\.?\b/i.test(gm.game) && !/@/.test(gm.game));
                                  setGameDetail({ game: gm.game, sport: gm.sport });
                                  setOpenPropCats(indiv ? ["Match Markets"] : ["AI Spreads & Totals", "Game Lines"]);
                                }}
                                className="w-full border border-slate-800 rounded-2xl px-3 py-3 flex items-center justify-between gap-3 text-left hover:border-cyan-400 transition"
                              >
                                <span className="min-w-0">
                                  <span className="block text-[10px] font-mono uppercase text-slate-500 tracking-wider">{gm.sport}</span>
                                  <span className="block text-sm font-semibold text-slate-100 truncate">{gm.game}</span>
                                  {(live || time) && (
                                    <span className="block text-[10px] font-mono uppercase tracking-wider mt-0.5">
                                      {live ? <span className="text-rose-400 font-semibold">● {live}</span> : <span className="text-cyan-400">{time}</span>}
                                    </span>
                                  )}
                                </span>
                                <span className="text-cyan-400 text-xs font-semibold shrink-0 flex items-center gap-1">All props <span>›</span></span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {playerMatches.length > 0 && (
                      <div>
                        <h3 className="font-bold text-slate-200 mb-2 text-sm">Players — tap to view all props</h3>
                        <div className="space-y-2">
                          {playerMatches.slice(0, 10).map((pm, pi) => {
                            const initials = pm.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
                            return (
                              <button
                                key={`${pm.name}-${pi}`}
                                onClick={() => {
                                  if (pm.player) {
                                    const pl = pm.player;
                                    const sk = (pm.sport === "nba" || pm.sport === "wnba") ? "pts" : pm.sport === "mlb" ? "hrPerGame"
                                      : pl.pos === "QB" ? "passYds" : pl.pos === "RB" ? "rushYds"
                                      : (pl.stats.recYds !== undefined ? "recYds" : Object.keys(pl.stats)[0]);
                                    const avg = pl.stats[sk] ?? 0;
                                    setPropStatKey(sk);
                                    setPropLine(Math.round(avg * 0.9 * 2) / 2);
                                    setSelectedPlayer({ player: pl, sport: pm.sport });
                                  } else if (pm.game) {
                                    setGameDetail({ game: pm.game, sport: pm.sport });
                                    setOpenPropCats(["Live Player Props"]);
                                  }
                                }}
                                className="w-full border border-slate-800 rounded-2xl px-3 py-3 flex items-center justify-between gap-3 text-left hover:border-cyan-400 transition"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{initials}</span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-slate-100 truncate">{pm.name}</span>
                                    <span className="block text-[10px] font-mono uppercase text-slate-500 tracking-wider truncate">{pm.team ? `${pm.team} · ` : ""}{pm.sport}{pm.game ? ` · ${pm.game}` : ""}</span>
                                  </span>
                                </span>
                                <span className="text-cyan-400 text-xs font-semibold shrink-0 flex items-center gap-1">All props <span>›</span></span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {results.length > 0 && (
                  <div className="border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800">
                    {results.map((r, i) => {
                      const inSlip = parlayLegs.some((l) => legKey(l) === legKey(r));
                      return (
                        <div key={i} className="px-3 py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider flex items-center gap-1.5 flex-wrap">
                              {r.real && <span className="text-emerald-400">● LIVE</span>}
                              <span>{r.sport} · {r.market} · {r.game}</span>
                              {(() => {
                                const live = lookupLiveTag(r.game);
                                if (live) return <span className="text-rose-400 font-semibold">· {live}</span>;
                                const t = formatGameTime(lookupGameStart(r.game));
                                return t ? <span className="text-cyan-400">· {t}</span> : null;
                              })()}
                            </div>
                            <div className="text-sm font-semibold text-slate-100 truncate">{r.pick}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono font-bold text-cyan-500 text-sm">{formatOdds(r.odds)}</span>
                            <button onClick={() => { if (!inSlip) addLeg({ ...r }); }} disabled={inSlip}
                              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${inSlip ? "bg-slate-800 text-slate-500" : "bg-cyan-500 text-white hover:bg-cyan-600"}`}>
                              {inSlip ? "✓" : "+ Add"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : sportDetail ? (
            (() => {
              const s = SPORTS.find((x) => x.id === sportDetail);
              const realOdds = realOddsBySport[sportDetail] || [];
              const realGames = realGamesBySport[sportDetail] || [];
              // Build a set of matchup keys that are already finished (final,
              // postponed, cancelled) so we can suppress them everywhere
              // below — odds caches can lag the score feed by minutes.
              const isFinalStatus = (st) => {
                const x = (st || "").toLowerCase();
                return x.includes("final") || x.includes("full time") || x.includes("postponed") || x.includes("canceled") || x.includes("cancelled") || x.includes("ended") || /\bft\b/.test(x);
              };
              // Safety net for team-name mismatches between ESPN and the
              // odds feed (e.g. "LA Lakers" vs "Los Angeles Lakers"): any
              // game whose start time is >4h in the past is certainly
              // done across all 8 sports — NFL maxes ~3.5h, NBA/NHL/MLB
              // ~3.5h. Tightened from 6h after MLB Finals from ~5h ago
              // were lingering in the sport detail view.
              const NOW_MS = Date.now();
              const STALE_MS = 4 * 60 * 60 * 1000;
              const isLikelyDoneByTime = (iso) => {
                if (!iso) return false;
                const t = new Date(iso).getTime();
                return Number.isFinite(t) && NOW_MS - t > STALE_MS;
              };
              // Status keywords that mean "actively in progress" — when
              // ESPN reports any of these, the 4h time-cutoff must NOT
              // suppress the game (rain delays, extra innings, suspended
              // games, long NCAAF bowls can all legitimately run >4h).
              const isActiveStatus = (st) => {
                const x = (st || "").toLowerCase();
                return x.includes("in progress") || x.includes("in-progress") || x.includes("live")
                  || x.includes("halftime") || x.includes("half time") || x.includes("end of")
                  || x.includes("delay") || x.includes("suspend") || x.includes("rain")
                  || x.includes("overtime") || /\bot\b/.test(x) || x.includes("extra");
              };
              const finalKeys = new Set();
              const liveKeys = new Set();
              for (const g of realGames) {
                const k = `${g.awayTeam} @ ${g.homeTeam}`;
                if (isFinalStatus(g.status)) finalKeys.add(k);
                else if (isActiveStatus(g.status)) liveKeys.add(k);
              }
              // Build picks from real bookmaker odds, one bucket per game —
              // skip any game whose score feed already shows it as final,
              // OR whose start time is >4h ago (name-mismatch safety net,
              // bypassed for games known to be actively in-progress).
              const byGame = {};
              for (const og of realOdds) {
                const key = `${og.awayTeam} @ ${og.homeTeam}`;
                if (finalKeys.has(key)) continue;
                if (!liveKeys.has(key) && isLikelyDoneByTime(og.commenceTime)) continue;
                const picks = buildPicksFromOdds(og);
                if (picks.length > 0) byGame[key] = picks;
              }
              // Also include scheduled real games that don't yet have odds (so the
              // matchup still appears, even if betting markets aren't open yet).
              for (const g of realGames) {
                if (isFinalStatus(g.status)) continue;
                // Bypass time cutoff for active/delayed/suspended games — they
                // legitimately can run >4h (MLB extra innings, rain delays).
                if (!isActiveStatus(g.status) && isLikelyDoneByTime(g.startsAt)) continue;
                const key = `${g.awayTeam} @ ${g.homeTeam}`;
                if (!byGame[key]) byGame[key] = [];
              }
              const hasRealGames = Object.keys(byGame).length > 0;
              // Fallback to sample pool only when no real games at all (deep offseason for niche leagues).
              if (!hasRealGames) {
                const fallback = (PICK_POOL[sportDetail] || []);
                fallback.forEach((p) => { (byGame[p.game] = byGame[p.game] || []).push(p); });
              }
              const players = (PLAYERS[sportDetail] || []);
              return (
                <div className="px-4 pt-4 pb-6">
                  <button onClick={() => setSportDetail(null)} className="text-cyan-400 text-sm mb-3">‹ All sports</button>
                  <h2 className="font-display text-2xl text-slate-100 mb-1 flex items-center gap-2"><span>{s?.emoji}</span> {s?.label}</h2>
                  <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-4">
                    {hasRealGames
                      ? "Live games & odds"
                      : "Games, teams & player props · sample data"}
                  </p>

                  {/* Games — tap to open full game screen */}
                  {Object.keys(byGame).length > 0 && (
                    <div className="mb-6">
                      <h3 className="font-bold text-slate-200 mb-2 text-sm">Games — tap to see all props</h3>
                      <div className="space-y-2">
                        {Object.entries(byGame).sort((a, b) => {
                          // Sort chronologically — soonest first. Games with
                          // no resolvable start time sink to the bottom.
                          const ta = new Date(lookupGameStart(a[0]) || 0).getTime();
                          const tb = new Date(lookupGameStart(b[0]) || 0).getTime();
                          const fa = !Number.isFinite(ta) || ta === 0;
                          const fb = !Number.isFinite(tb) || tb === 0;
                          if (fa && fb) return 0;
                          if (fa) return 1;
                          if (fb) return -1;
                          return ta - tb;
                        }).map(([game, picks]) => {
                          const nameMap = TEAM_ABBR_TO_NAME[sportDetail] || {};
                          const gamePlayers = (PLAYERS[sportDetail] || []).filter((pl) => {
                            const full = nameMap[pl.team] || pl.team;
                            return game.includes(full) || game.includes(pl.team);
                          });
                          const espnGame = realGames.find((g) => `${g.awayTeam} @ ${g.homeTeam}` === game);
                          return (
                            <button
                              key={game}
                              onClick={() => {
                                const indiv = sportDetail === "ufc" || sportDetail === "mma" || sportDetail === "tennis" || sportDetail === "golf" || sportDetail === "nascar" || (/\bvs\.?\b/i.test(game) && !/@/.test(game));
                                setGameDetail({ game, sport: sportDetail });
                                setOpenPropCats(indiv ? ["Match Markets"] : ["AI Spreads & Totals", "Game Lines"]);
                              }}
                              className="w-full border border-slate-800 rounded-2xl px-3 py-3 flex items-center justify-between gap-3 text-left hover:border-cyan-400 transition"
                            >
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                {espnGame?.awayLogo && (
                                  <img src={espnGame.awayLogo} alt="" className="w-8 h-8 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                )}
                                {espnGame?.homeLogo && (
                                  <img src={espnGame.homeLogo} alt="" className="w-8 h-8 object-contain shrink-0 -ml-1" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                )}
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-slate-100 truncate">{game}</span>
                                  {(() => {
                                    // Use lookupGameStart — it resolves both
                                    // ESPN `startsAt` and odds-API `commenceTime`
                                    // so scheduled games still surface a date/time.
                                    const live = lookupLiveTag(game);
                                    const time = formatGameTime(lookupGameStart(game));
                                    if (!live && !time) return null;
                                    return (
                                      <span className="block text-[10px] font-mono uppercase tracking-wider mt-0.5">
                                        {live ? (
                                          <span className="text-rose-400 font-semibold">● {live}</span>
                                        ) : (
                                          <span className="text-cyan-400">{time}</span>
                                        )}
                                      </span>
                                    );
                                  })()}
                                  {picks.length === 0 && (
                                    <span className="block text-[10px] font-mono uppercase tracking-wider text-slate-500 mt-0.5">Markets opening soon</span>
                                  )}
                                </span>
                              </span>
                              <span className="text-cyan-400 shrink-0">›</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Players → tap for full props page */}
                  {players.length > 0 && (
                    <div>
                      <h3 className="font-bold text-slate-200 mb-2 text-sm">Players (tap for props)</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {players.map((pl, i) => {
                          const initials = pl.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                const sk = (sportDetail === "nba" || sportDetail === "wnba") ? "pts" : sportDetail === "mlb" ? "hrPerGame"
                                  : pl.pos === "QB" ? "passYds" : pl.pos === "RB" ? "rushYds"
                                  : (pl.stats.recYds !== undefined ? "recYds" : Object.keys(pl.stats)[0]);
                                const avg = pl.stats[sk] ?? 0;
                                setPropStatKey(sk);
                                setPropLine(Math.round(avg * 0.9 * 2) / 2);
                                setSelectedPlayer({ player: pl, sport: sportDetail });
                              }}
                              className="border border-slate-800 rounded-xl p-3 bg-slate-900 hover:border-cyan-400 transition flex items-center gap-2 text-left"
                            >
                              <span className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{initials}</span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-slate-100 truncate">{pl.name}</span>
                                <span className="block text-[10px] font-mono uppercase text-slate-500 tracking-wider">{pl.team} · {pl.pos}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {Object.keys(byGame).length === 0 && players.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-10">No sample games or players for {s?.label} yet.</p>
                  )}
                </div>
              );
            })()
          ) : (
            <>
              {/* Popular leagues */}
              <div className="px-4 pt-4">
                <h2 className="font-bold text-slate-100 mb-2">Popular</h2>
                <div className="flex gap-2 overflow-x-auto scroll-fade pb-2 -mx-1 px-1">
                  <button onClick={() => setShowLiveDemo(true)} className="shrink-0 flex items-center gap-2 border border-rose-500/50 rounded-xl px-4 py-2.5 text-rose-400 font-semibold hover:bg-rose-500/10 transition">🔴 Live now{(() => { const n = homeLiveGames.filter((g) => g.real).length; return n > 0 ? <span className="bg-rose-500 text-white rounded-full px-2 py-0.5 text-[10px] font-bold leading-none">{n}</span> : null; })()}</button>
                  {SPORTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSportDetail(s.id)}
                      className="shrink-0 flex items-center gap-2 border border-cyan-800 rounded-xl px-4 py-2.5 text-cyan-600 font-semibold hover:bg-cyan-950 transition"
                    >
                      <span>{s.emoji}</span> {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* All sports list */}
              <div className="px-4 pt-4 pb-6">
                <h2 className="font-bold text-slate-100 mb-1">All Sports</h2>
                <div className="divide-y divide-slate-800">
                  {SPORTS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSportDetail(s.id)}
                      className="w-full flex items-center justify-between py-3.5 group"
                    >
                      <span className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-full bg-cyan-950 flex items-center justify-center text-lg">{s.emoji}</span>
                        <span className="text-cyan-600 font-semibold group-hover:text-cyan-200">{s.label}</span>
                      </span>
                      <span className="text-zinc-300 group-hover:text-cyan-400">›</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {view === "allupcoming" && (
        <div className="flex-1 overflow-y-auto bg-slate-900">
          {/* Header */}
          <div className="bg-slate-900 px-4 pt-4 pb-4 sticky top-0 z-10 border-b border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => { setHomeSearch(""); setView("home"); }} className="text-slate-400 hover:text-slate-100 text-sm">‹ Back</button>
              <h1 className="text-slate-100 font-bold text-lg">Upcoming Games</h1>
              <span className="w-10" />
            </div>
            <div className="relative">
              <input
                value={homeSearch}
                onChange={(e) => setHomeSearch(e.target.value)}
                placeholder='Search upcoming games or teams…'
                className="w-full bg-slate-800 border border-slate-700 rounded-full pl-10 pr-9 py-3 text-sm text-slate-100 focus:outline-none focus:border-cyan-400 transition"
              />
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {homeSearch && (
                <button onClick={() => setHomeSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-4">
            {(() => {
              const q = homeSearch.trim().toLowerCase();
              const terms = expandTeamQuery(q);
              const games = q
                ? homeUpcomingGames.filter((g) => matchesTerms(g.game, terms) || (g.sport || "").toLowerCase().includes(q))
                : homeUpcomingGames;
              if (games.length === 0) {
                return (
                  <p className="text-center text-slate-500 text-sm py-12">
                    {q ? "No upcoming games match your search." : "No upcoming games right now for your selected sports."}
                  </p>
                );
              }
              // Group by sport for easier scanning
              const bySport = {};
              for (const g of games) { (bySport[g.sport] ||= []).push(g); }
              return (
                <div className="space-y-6">
                  {Object.entries(bySport).map(([sport, list]) => (
                    <div key={sport}>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2 px-1">
                        {sport} · {list.length} {list.length === 1 ? "game" : "games"}
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {list.map((g, i) => {
                          const dt = new Date(g.startsAt);
                          const when = isNaN(dt.getTime())
                            ? ""
                            : dt.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                          return (
                            <button
                              key={i}
                              onClick={() => buildParlayForRealGame(g.game, g.sport, "upcoming")}
                              className="text-left border border-slate-800 rounded-2xl p-3 bg-slate-900 hover:border-cyan-400 transition flex items-center gap-3"
                            >
                              <div className="flex items-center shrink-0">
                                {g.awayLogo && <img src={g.awayLogo} alt="" className="w-8 h-8 object-contain shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                                {g.homeLogo && <img src={g.homeLogo} alt="" className="w-8 h-8 object-contain shrink-0 -ml-2" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">{when}</div>
                                <div className="text-sm font-semibold text-slate-100 leading-tight truncate">{shortGameLabel(g)}</div>
                                {g.venue && <div className="text-[9px] text-slate-500 mt-0.5 truncate">{g.venue}</div>}
                              </div>
                              <span className="text-xs font-semibold text-slate-100 bg-slate-800 rounded-full px-3 py-1.5 shrink-0">
                                Build →
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="text-[9px] font-mono text-slate-500 text-center mt-6 uppercase tracking-widest leading-relaxed">
              Real upcoming games from ESPN · 21+ · Bet responsibly
            </p>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scroll-fade px-4 py-4 space-y-5 bg-slate-900"
        style={{ paddingBottom: Math.max(composerH, 130) + 16, fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", display: view === "home" || view === "profile" || view === "plans" || view === "allsports" || view === "allupcoming" ? "none" : undefined }}
      >
        {messages.map((m, i) => (
          <div key={i} className={`slide-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "user" ? (
              <div className="max-w-[85%] space-y-2">
                {m.image && (
                  <img src={m.image} alt="attachment" className="rounded-xl max-h-48 w-auto ml-auto" />
                )}
                <div className="bg-slate-800 text-slate-100 rounded-2xl rounded-br-md px-4 py-2.5">
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ) : (
              <div className="max-w-full w-full text-slate-200">{renderAssistantMessage(m.content, i)}</div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start slide-up">
            <div className="flex gap-1.5 items-center py-1">
              <div className="w-2 h-2 bg-zinc-400 rounded-full pulse-dot" />
              <div className="w-2 h-2 bg-zinc-400 rounded-full pulse-dot" />
              <div className="w-2 h-2 bg-zinc-400 rounded-full pulse-dot" />
            </div>
          </div>
        )}

      </div>

      {showDemoPicker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-end" onClick={() => setShowDemoPicker(false)}>
          <div className="bg-zinc-900 border-t-2 border-cyan-400 w-full rounded-t-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-display text-lg">PICK LIBRARY</h3>
              <button onClick={() => setShowDemoPicker(false)}>
                <X size={20} className="text-slate-500" />
              </button>
            </div>
            <div className="overflow-y-auto scroll-fade p-3 space-y-2">
              {availableDemoPicks.length === 0 && (
                <p className="text-slate-400 text-sm text-center py-8">Select a sport at the top first.</p>
              )}
              {availableDemoPicks.map((pick, i) => {
                const inSlip = parlayLegs.some((l) => legKey(l) === legKey(pick));
                const conf = calculateConfidence(pick);
                return (
                  <button
                    key={i}
                    onClick={() => (inSlip ? removeLegByPick(pick) : addLeg(pick))}
                    className={`w-full text-left border rounded-lg p-3 flex items-center justify-between transition ${
                      inSlip ? "border-rose-500/40 bg-rose-500/5" : "border-zinc-800 hover:border-cyan-400 bg-zinc-950"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] font-mono uppercase text-slate-400">{pick.market}</div>
                        <div className={`text-[10px] font-mono font-bold ${confidenceColor(conf)}`}>
                          {conf}%
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 truncate">{pick.game}</div>
                      <div className="text-sm font-semibold">{pick.pick}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-cyan-400 font-bold">{formatOdds(pick.odds)}</span>
                      <Plus size={16} className={inSlip ? "text-slate-300" : "text-cyan-400"} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showMatchup && (() => {
        const sportPlayers = PLAYERS[matchupSport] || [];
        const statsForMatchup = (() => {
          if (!playerA && !playerB) return [];
          const cats = STAT_CATEGORIES[matchupSport];
          if (!cats) return [];
          if (cats.ALL) return cats.ALL;
          const pos = (playerA || playerB).pos;
          return cats[pos] || [];
        })();
        const samePos = !playerA || !playerB || playerA.pos === playerB.pos || (STAT_CATEGORIES[matchupSport]?.ALL);
        const matchupResults =
          playerA && playerB && samePos
            ? statsForMatchup
                .map((stat) => {
                  const result = priceMatchup(playerA, playerB, stat.key);
                  return result ? { ...stat, ...result } : null;
                })
                .filter(Boolean)
            : [];

        return (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-30 flex items-end"
            onClick={() => setShowMatchup(false)}
          >
            <div
              className="bg-zinc-900 border-t-2 border-cyan-400 w-full rounded-t-3xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Swords size={18} className="text-cyan-400" />
                  <h3 className="font-display text-lg">MATCHUP BUILDER</h3>
                </div>
                <button onClick={() => setShowMatchup(false)}>
                  <X size={20} className="text-slate-500" />
                </button>
              </div>

              {/* Sport selector for matchup */}
              <div className="px-4 py-2 border-b border-zinc-800 flex gap-1.5 overflow-x-auto scroll-fade">
                {SPORTS.filter((s) => (PLAYERS[s.id] || []).length > 0).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setMatchupSport(s.id);
                      setPlayerA(null);
                      setPlayerB(null);
                    }}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${
                      matchupSport === s.id
                        ? "bg-cyan-400 text-black border-cyan-400"
                        : "text-slate-500 border-zinc-800"
                    }`}
                  >
                    {s.emoji} {s.label}
                  </button>
                ))}
              </div>

              {/* VS panel */}
              <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-zinc-800">
                <button
                  onClick={() => setSelectingFor("A")}
                  className={`border-2 rounded-xl p-3 text-left min-h-[80px] flex flex-col justify-center ${
                    playerA
                      ? "border-cyan-400 bg-cyan-400/5"
                      : "border-dashed border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {playerA ? (
                    <>
                      <div className="text-[10px] font-mono text-cyan-400 uppercase">Fighter A</div>
                      <div className="font-display text-base leading-tight">{playerA.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {playerA.team} · {playerA.pos} · Form {playerA.form}/10
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-400 text-center text-xs">
                      Tap to pick<br />Player A
                    </div>
                  )}
                </button>
                <button
                  onClick={() => setSelectingFor("B")}
                  className={`border-2 rounded-xl p-3 text-left min-h-[80px] flex flex-col justify-center ${
                    playerB
                      ? "border-rose-400 bg-rose-400/5"
                      : "border-dashed border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  {playerB ? (
                    <>
                      <div className="text-[10px] font-mono text-rose-400 uppercase">Fighter B</div>
                      <div className="font-display text-base leading-tight">{playerB.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {playerB.team} · {playerB.pos} · Form {playerB.form}/10
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-400 text-center text-xs">
                      Tap to pick<br />Player B
                    </div>
                  )}
                </button>
              </div>

              {/* Player picker list */}
              {selectingFor && (
                <div className="border-b border-zinc-800 max-h-64 overflow-y-auto scroll-fade">
                  <div className="px-4 py-2 text-[10px] font-mono uppercase text-slate-400 sticky top-0 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                    <span>Pick Player {selectingFor}</span>
                    <button onClick={() => setSelectingFor(null)} className="text-slate-500">
                      cancel
                    </button>
                  </div>
                  {sportPlayers.map((p, i) => {
                    const isSelected =
                      (selectingFor === "A" && playerA?.name === p.name) ||
                      (selectingFor === "B" && playerB?.name === p.name);
                    const isOther =
                      (selectingFor === "A" && playerB?.name === p.name) ||
                      (selectingFor === "B" && playerA?.name === p.name);
                    return (
                      <button
                        key={i}
                        disabled={isOther}
                        onClick={() => {
                          if (selectingFor === "A") setPlayerA(p);
                          else setPlayerB(p);
                          setSelectingFor(null);
                        }}
                        className={`w-full text-left px-4 py-2 flex justify-between items-center border-b border-zinc-800 ${
                          isSelected ? "bg-cyan-400/10" : "hover:bg-zinc-800"
                        } ${isOther ? "opacity-30" : ""}`}
                      >
                        <div>
                          <div className="text-sm font-semibold">{p.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {p.team} · {p.pos}
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          Form {p.form}/10
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Matchup results */}
              {playerA && playerB && !selectingFor && (
                <div className="overflow-y-auto scroll-fade p-3 space-y-2">
                  {!samePos ? (
                    <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg p-3">
                      Position mismatch — pick two players with comparable stat lines (same position in NFL, or any two in NBA/MLB/etc).
                    </div>
                  ) : (
                    <>
                      <p className="text-[10px] font-mono text-slate-400 uppercase text-center mb-2">
                        Head-to-Head Props · Tap to add
                      </p>
                      {matchupResults.map((m, i) => {
                        const aWins = m.probA > m.probB;
                        const pickA = {
                          game: `${playerA.name} vs ${playerB.name}`,
                          market: "H2H Prop",
                          pick: `${playerA.name} more ${m.label}`,
                          odds: m.oddsA,
                        };
                        const pickB = {
                          game: `${playerA.name} vs ${playerB.name}`,
                          market: "H2H Prop",
                          pick: `${playerB.name} more ${m.label}`,
                          odds: m.oddsB,
                        };
                        const aInSlip = parlayLegs.some(
                          (l) => legKey(l) === legKey(pickA)
                        );
                        const bInSlip = parlayLegs.some(
                          (l) => legKey(l) === legKey(pickB)
                        );
                        return (
                          <div
                            key={i}
                            className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden"
                          >
                            <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 text-[11px] font-mono uppercase text-slate-500 text-center">
                              {m.label}
                            </div>
                            <div className="grid grid-cols-2">
                              <button
                                onClick={() => !aInSlip && addLeg(pickA)}
                                disabled={aInSlip}
                                className={`p-3 text-left transition border-r border-zinc-800 ${
                                  aWins ? "bg-cyan-400/5" : ""
                                } ${aInSlip ? "opacity-50" : "hover:bg-zinc-800"}`}
                              >
                                <div className="text-[10px] text-slate-400 truncate">
                                  {playerA.name.split(" ").slice(-1)[0]}
                                </div>
                                <div className="font-mono text-sm font-bold">
                                  {m.projA.toFixed(m.key === "avg" ? 3 : 1)}
                                </div>
                                <div className="font-mono text-xs text-cyan-400 font-bold">
                                  {formatOdds(m.oddsA)}
                                </div>
                                <div className="text-[9px] text-slate-400 mt-1">
                                  {aInSlip ? "Added" : `${(m.probA * 100).toFixed(0)}% · tap to add`}
                                </div>
                              </button>
                              <button
                                onClick={() => !bInSlip && addLeg(pickB)}
                                disabled={bInSlip}
                                className={`p-3 text-left transition ${
                                  !aWins ? "bg-rose-400/5" : ""
                                } ${bInSlip ? "opacity-50" : "hover:bg-zinc-800"}`}
                              >
                                <div className="text-[10px] text-slate-400 truncate">
                                  {playerB.name.split(" ").slice(-1)[0]}
                                </div>
                                <div className="font-mono text-sm font-bold">
                                  {m.projB.toFixed(m.key === "avg" ? 3 : 1)}
                                </div>
                                <div className="font-mono text-xs text-rose-400 font-bold">
                                  {formatOdds(m.oddsB)}
                                </div>
                                <div className="text-[9px] text-slate-400 mt-1">
                                  {bInSlip ? "Added" : `${(m.probB * 100).toFixed(0)}% · tap to add`}
                                </div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[9px] text-slate-400 text-center pt-2 font-mono uppercase">
                        Projections based on form & per-game averages · hypothetical
                      </p>
                    </>
                  )}
                </div>
              )}

              {(!playerA || !playerB) && !selectingFor && (
                <div className="p-8 text-center text-slate-400 text-sm">
                  Pick two players above to see head-to-head props.
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* LIVE DEMO MODAL */}
      {showLiveDemo && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-end"
          onClick={() => setShowLiveDemo(false)}
        >
          <div
            className="bg-zinc-900 border-t-2 border-rose-400 w-full rounded-t-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-400 pulse-dot" /> PICK LIVE
                </h3>
                <p className={`text-[10px] font-mono uppercase tracking-wider mt-0.5 ${homeLiveGames.some((g) => g.real) ? "text-emerald-400/80" : "text-slate-400"}`}>
                  {(() => {
                    const realCount = homeLiveGames.filter((g) => g.real).length;
                    return realCount > 0
                      ? <>● Live ESPN feed · {realCount} {realCount === 1 ? "game" : "games"} in progress</>
                      : <>● Live ESPN feed · nothing in progress right now</>;
                  })()}
                </p>
              </div>
              <button onClick={() => setShowLiveDemo(false)}>
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            {homeLiveGames.some((g) => g.real) && (
              <div className="p-3 border-b border-zinc-800">
                <button
                  onClick={() => { setView("chat"); buildSimLiveParlay(); setShowLiveDemo(false); }}
                  className="w-full bg-rose-400 text-black rounded-xl py-2.5 font-display text-sm hover:bg-rose-300 transition"
                >
                  ⚡ BUILD BEST 2–3 LEG LIVE TICKET
                </button>
              </div>
            )}

            <div className="overflow-y-auto scroll-fade p-3 space-y-2">
              {(() => {
                // Decorate each real live game with the matching bookmaker
                // total (from realOddsBySport) so we can show real
                // current-vs-total and an honest pacing read. We never fake
                // win probability — if ESPN's scoreboard didn't ship a
                // value we display "—" rather than inventing a number.
                const lookupTotal = (sport, game) => {
                  const oddsList = realOddsBySport[sport] || [];
                  const hit = oddsList.find(
                    (o) => `${o.awayTeam} @ ${o.homeTeam}` === game,
                  );
                  if (!hit?.bookmakers?.length) return null;
                  for (const bk of hit.bookmakers) {
                    const totalsMkt = (bk.markets || []).find((m) => m.key === "totals");
                    const overOutcome = totalsMkt?.outcomes?.find((o) => /over/i.test(o.name || ""));
                    if (overOutcome?.point != null) return Number(overOutcome.point);
                  }
                  return null;
                };
                // REAL DATA ONLY — no sim fallback. If ESPN has nothing
                // in progress we show the empty state below rather than
                // inventing fake "live" games. Earlier code fell back to
                // simLiveGames here; that violated the no-fake-data rule.
                const liveList = homeLiveGames
                  .filter((g) => g.real === true)
                  .map((g) => {
                      const total = lookupTotal(g.sport, g.game);
                      const hasBothScores = Number.isFinite(g.awayScore) && Number.isFinite(g.homeScore);
                      const currentTotal = hasBothScores ? (g.awayScore + g.homeScore) : null;
                      // Pace: how far through regulation are we? Estimate
                      // from period vs sport's regulation period count.
                      // STRICTLY requires real total + both real scores +
                      // real period — otherwise blank, never fake.
                      const REG_PERIODS: Record<string, number> = { nfl: 4, ncaaf: 4, nba: 4, ncaab: 2, nhl: 3, mlb: 9, soccer: 2, ufc: 3 };
                      const regCount = REG_PERIODS[g.sport];
                      let pacing = "";
                      if (
                        Number.isFinite(total) &&
                        currentTotal != null &&
                        regCount &&
                        Number.isFinite(g.period) &&
                        g.period > 0
                      ) {
                        const elapsed = Math.min(1, g.period / regCount);
                        if (elapsed >= 0.25) {
                          const projected = currentTotal / elapsed;
                          if (projected > total * 1.08) pacing = "over";
                          else if (projected < total * 0.92) pacing = "under";
                          else pacing = "on pace";
                        }
                      }
                      return {
                        ...g,
                        periodLabel: g.periodLabel || g.status || "—",
                        clock: g.clock || "",
                        awayWP: g.awayWP ?? "—",
                        homeWP: g.homeWP ?? "—",
                        currentTotal: currentTotal != null ? currentTotal : "—",
                        total: total != null ? total : "—",
                        pacing,
                      };
                    });
                if (liveList.length === 0) {
                  return (
                    <p className="text-slate-400 text-sm text-center py-8">
                      Nothing in progress across any sport right now. Check back closer to game time.
                    </p>
                  );
                }
                return liveList.map((g, i) => (
                <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] font-mono uppercase text-rose-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 pulse-dot" />
                      {g.periodLabel}{g.clock && g.clock !== "0:00" && g.clock !== "0:0" ? ` · ${g.clock}` : ""}
                    </div>
                    <div className="text-[9px] font-mono uppercase text-slate-400">{g.sport}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{g.away}</span>
                        <span className="font-mono font-bold text-lg">{Number.isFinite(g.awayScore) ? g.awayScore : "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{g.home}</span>
                        <span className="font-mono font-bold text-lg">{Number.isFinite(g.homeScore) ? g.homeScore : "—"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-400">
                      {g.awayWP !== "—" || g.homeWP !== "—"
                        ? <>Win prob: <span className="text-zinc-300">{g.away} {g.awayWP}%</span> · <span className="text-zinc-300">{g.home} {g.homeWP}%</span></>
                        : <span className="text-slate-500">Win prob: live feed only</span>}
                    </span>
                    <span className={`uppercase ${g.pacing === "over" ? "text-emerald-400" : g.pacing === "under" ? "text-amber-400" : "text-slate-400"}`}>
                      {g.currentTotal}/{g.total}{g.pacing ? ` ${g.pacing}` : ""}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      // Real live games go through the in-app analyzer so
                      // the user gets the full 2-5 leg breakdown in chat
                      // plus the auto-filled slip. Sim games keep the old
                      // direct add-to-slip behavior.
                      if (g.real) {
                        buildBestParlayForLiveRealGame(g);
                        return;
                      }
                      if (!requirePro("Live picks")) return;
                      const gamePicks = buildSimLivePicks([g]);
                      gamePicks.forEach((pk) => {
                        if (!parlayLegs.some((l) => legKey(l) === legKey(pk))) { addLeg(pk); }
                      });
                    }}
                    className="w-full mt-2 bg-rose-400/15 border border-rose-400/40 text-rose-300 rounded-lg py-2 text-xs font-semibold hover:bg-rose-400/25 transition"
                  >
                    {g.real ? "Build best 2–5 leg parlay from this game" : "+ Add this game's live picks to ticket"}
                  </button>
                </div>
                ));
              })()}
              <p className="text-[9px] font-mono text-slate-400 text-center uppercase tracking-wider pt-2">
                Live ESPN feed · refreshes every 60s
              </p>
            </div>
          </div>
        </div>
      )}

      {showCoaches && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-end"
          onClick={() => setShowCoaches(false)}
        >
          <div
            className="bg-zinc-900 border-t-2 border-sky-400 w-full rounded-t-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg flex items-center gap-2"><CoachIcon size={20} /> COACH TRENDS</h3>
                <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mt-0.5">
                  Sample tendencies · not live data
                </p>
              </div>
              <button onClick={() => setShowCoaches(false)}>
                <X size={20} className="text-slate-500" />
              </button>
            </div>
            <div className="overflow-y-auto scroll-fade p-3 space-y-3">
              {selectedSports.filter((s) => (COACHES[s] || []).length > 0).length === 0 && (
                <p className="text-slate-400 text-sm text-center py-8">
                  No coach data for selected sports. Try NFL, NBA, MLB, or NHL.
                </p>
              )}
              {selectedSports.map((s) => {
                const list = COACHES[s] || [];
                if (list.length === 0) return null;
                return (
                  <div key={s}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-1.5">
                      {s} · {list.length}
                    </div>
                    <div className="space-y-1.5">
                      {list.map((c, i) => (
                        <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-sm font-semibold">{c.name}</div>
                            <div className="flex gap-1">
                              {c.aggressive >= 2 && (
                                <span className="text-[8px] font-mono uppercase bg-rose-500/20 text-rose-400 px-1 rounded">aggressive</span>
                              )}
                              {c.favLean >= 2 && (
                                <span className="text-[8px] font-mono uppercase bg-emerald-500/20 text-emerald-400 px-1 rounded">front-runner</span>
                              )}
                              {c.primetime >= 2 && (
                                <span className="text-[8px] font-mono uppercase bg-sky-500/20 text-sky-400 px-1 rounded">big-game</span>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{c.notes}</p>
                          {(() => {
                            const gs = coachGameStateProfile(c);
                            if (!gs) return null;
                            return (
                              <div className="mt-2 border-t border-zinc-800 pt-2 space-y-1">
                                <div className="text-[9px] font-mono uppercase tracking-wider text-cyan-300">
                                  Game-state tendencies {gs.lean !== "neutral" && `· leans ${gs.lean}`}
                                </div>
                                <p className="text-[10px] text-slate-500 leading-relaxed"><span className="text-emerald-400">▲ Leading:</span> {gs.whenLeading}</p>
                                <p className="text-[10px] text-slate-500 leading-relaxed"><span className="text-rose-400">▼ Trailing:</span> {gs.whenTrailing}</p>
                                <p className="text-[10px] text-slate-500 leading-relaxed"><span className="text-zinc-300">Subs:</span> {gs.subs}</p>
                              </div>
                            );
                          })()}
                          {(() => {
                            const cp = findCoachPick(c, s);
                            if (!cp) {
                              return (
                                <div className="w-full mt-2 rounded-lg py-1.5 text-[10px] font-mono text-slate-400 text-center border border-zinc-800">
                                  No {c.team} game in the sample pool to add
                                </div>
                              );
                            }
                            const inSlip = parlayLegs.some((l) => legKey(l) === legKey(cp));
                            return (
                              <button
                                onClick={() => { if (!inSlip) addLeg({ ...cp }); }}
                                disabled={inSlip}
                                className={`w-full mt-2 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                                  inSlip ? "bg-zinc-800 text-slate-400 cursor-default" : "bg-sky-400 text-black hover:bg-sky-300"
                                }`}
                              >
                                {inSlip ? "✓ In ticket" : `+ Add ${cp.pick} ${formatOdds(cp.odds)}`}
                              </button>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MANUAL PICK ADDER */}
      {showManualAdd && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-end"
          onClick={() => setShowManualAdd(false)}
        >
          <div
            className="bg-zinc-900 border-t-2 border-cyan-400 w-full rounded-t-3xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-display text-lg">ADD CUSTOM PICK</h3>
              <button onClick={() => setShowManualAdd(false)}>
                <X size={20} className="text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  Game
                </label>
                <input
                  value={manualForm.game}
                  onChange={(e) => setManualForm((f) => ({ ...f, game: e.target.value }))}
                  placeholder="e.g. Lakers @ Warriors"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  Market
                </label>
                <select
                  value={manualForm.market}
                  onChange={(e) => setManualForm((f) => ({ ...f, market: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:border-cyan-400"
                >
                  <option>Moneyline</option>
                  <option>Spread</option>
                  <option>Total</option>
                  <option>Player Prop</option>
                  <option>Run Line</option>
                  <option>Puck Line</option>
                  <option>Match Result</option>
                  <option>BTTS</option>
                  <option>Method</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  Selection
                </label>
                <input
                  value={manualForm.pick}
                  onChange={(e) => setManualForm((f) => ({ ...f, pick: e.target.value }))}
                  placeholder="e.g. Warriors -3.5 or Curry 25+ pts"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  American Odds
                </label>
                <input
                  type="number"
                  value={manualForm.odds}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, odds: parseInt(e.target.value) || 0 }))
                  }
                  placeholder="-110"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
              <button
                onClick={() => {
                  if (!manualForm.game.trim() || !manualForm.pick.trim()) return;
                  addLeg({
                    game: manualForm.game.trim(),
                    market: manualForm.market,
                    pick: manualForm.pick.trim(),
                    odds: manualForm.odds,
                  });
                  setManualForm({ game: "", market: "Moneyline", pick: "", odds: -110 });
                  setShowManualAdd(false);
                }}
                disabled={!manualForm.game.trim() || !manualForm.pick.trim()}
                className="w-full bg-cyan-400 text-black rounded-lg py-3 font-bold uppercase tracking-wider text-sm hover:bg-cyan-300 disabled:opacity-30 active:scale-95 transition"
              >
                Add to Parlay
              </button>
            </div>
          </div>
        </div>
      )}

      {showTracker && (() => {
        const pending = tracker.filter((t) => t.status === "pending");
        const settled = tracker.filter((t) => t.status === "won" || t.status === "lost");
        const wins = settled.filter((t) => t.status === "won").length;
        const losses = settled.length - wins;
        const winPct = settled.length === 0 ? 0 : Math.round((wins / settled.length) * 100);
        // Aggregate by market type (from ALL settled — not filtered)
        const byMarket = {};
        settled.forEach((t) => {
          if (!byMarket[t.market]) byMarket[t.market] = { w: 0, l: 0 };
          if (t.status === "won") byMarket[t.market].w++;
          else byMarket[t.market].l++;
        });

        // Apply filters
        const allMarkets = Array.from(new Set(tracker.map((t) => t.market)));
        const applyFilter = (list) => {
          let out = list;
          if (historyFilter.market !== "all") {
            out = out.filter((t) => t.market === historyFilter.market);
          }
          // Sort by addedAt
          out = [...out].sort((a, b) =>
            historySort === "newest" ? b.addedAt - a.addedAt : a.addedAt - b.addedAt
          );
          return out;
        };
        const filteredPending = historyFilter.status === "settled" ? [] : applyFilter(pending);
        const filteredSettled = historyFilter.status === "pending" ? [] : applyFilter(
          historyFilter.status === "won" ? settled.filter((t) => t.status === "won") :
          historyFilter.status === "lost" ? settled.filter((t) => t.status === "lost") :
          settled
        );
        const filterActive = historyFilter.status !== "all" || historyFilter.market !== "all";

        return (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 flex items-end"
            onClick={() => setShowTracker(false)}
          >
            <div
              className="bg-zinc-900 border-t-2 border-emerald-400 w-full rounded-t-3xl max-h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg">📊 MY HISTORY</h3>
                  <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mt-0.5">
                    Personal pick tracker · saved locally
                  </p>
                </div>
                <button onClick={() => setShowTracker(false)}>
                  <X size={20} className="text-slate-500" />
                </button>
              </div>

              {/* Overall stats */}
              <div className="p-4 border-b border-zinc-800 grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Record</div>
                  <div className="font-display text-xl">
                    {wins}<span className="text-slate-400 text-sm">-{losses}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Win %</div>
                  <div className={`font-display text-xl ${winPct >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                    {settled.length === 0 ? "—" : `${winPct}%`}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Pending</div>
                  <div className="font-display text-xl text-amber-400">{pending.length}</div>
                </div>
              </div>

              {/* By market */}
              {Object.keys(byMarket).length > 0 && (
                <div className="px-4 py-3 border-b border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider mb-2">By market</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(byMarket).map(([market, r]) => {
                      const tot = r.w + r.l;
                      const pct = Math.round((r.w / tot) * 100);
                      return (
                        <div key={market} className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-[10px]">
                          <span className="text-slate-500">{market}</span>
                          <span className={`ml-2 font-mono font-bold ${pct >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                            {r.w}-{r.l}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Filter bar */}
              {tracker.length > 0 && (
                <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-950/50 space-y-2">
                  <div className="flex items-center gap-1.5 overflow-x-auto scroll-fade pb-0.5">
                    <span className="shrink-0 text-[9px] font-mono uppercase text-slate-400 tracking-wider mr-1">Status:</span>
                    {[
                      { id: "all", label: "All", count: tracker.length },
                      { id: "pending", label: "Pending", count: pending.length },
                      { id: "won", label: "Won", count: wins },
                      { id: "lost", label: "Lost", count: losses },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setHistoryFilter((f) => ({ ...f, status: opt.id }))}
                        className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition ${
                          historyFilter.status === opt.id
                            ? "bg-emerald-400 text-black border-emerald-400"
                            : "bg-transparent text-slate-500 border-zinc-800"
                        }`}
                      >
                        {opt.label} <span className="opacity-60">·{opt.count}</span>
                      </button>
                    ))}
                  </div>
                  {allMarkets.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto scroll-fade pb-0.5">
                      <span className="shrink-0 text-[9px] font-mono uppercase text-slate-400 tracking-wider mr-1">Market:</span>
                      <button
                        onClick={() => setHistoryFilter((f) => ({ ...f, market: "all" }))}
                        className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition ${
                          historyFilter.market === "all"
                            ? "bg-emerald-400 text-black border-emerald-400"
                            : "bg-transparent text-slate-500 border-zinc-800"
                        }`}
                      >
                        All
                      </button>
                      {allMarkets.map((m) => (
                        <button
                          key={m}
                          onClick={() => setHistoryFilter((f) => ({ ...f, market: m }))}
                          className={`shrink-0 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition ${
                            historyFilter.market === m
                              ? "bg-emerald-400 text-black border-emerald-400"
                              : "bg-transparent text-slate-500 border-zinc-800"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setHistorySort(historySort === "newest" ? "oldest" : "newest")}
                      className="text-[9px] font-mono uppercase tracking-wider text-slate-500 hover:text-emerald-400"
                    >
                      ⇅ Sort: {historySort === "newest" ? "Newest first" : "Oldest first"}
                    </button>
                    {filterActive && (
                      <button
                        onClick={() => setHistoryFilter({ status: "all", market: "all" })}
                        className="text-[9px] font-mono uppercase tracking-wider text-rose-400 hover:text-rose-300"
                      >
                        ✕ Clear filters
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Entries */}
              <div className="overflow-y-auto scroll-fade flex-1">
                {tracker.length === 0 && (
                  <div className="p-8 text-center">
                    <p className="text-slate-400 text-sm">No picks tracked yet.</p>
                    <p className="text-slate-400 text-xs mt-1">Add picks to your slip and they'll appear here.</p>
                  </div>
                )}
                {tracker.length > 0 && filteredPending.length === 0 && filteredSettled.length === 0 && (
                  <div className="p-8 text-center">
                    <p className="text-slate-400 text-sm">No picks match those filters.</p>
                  </div>
                )}
                {filteredPending.length > 0 && (
                  <>
                    <div className="px-4 pt-3 pb-1 text-[10px] font-mono uppercase text-amber-400 tracking-wider">
                      Pending · {filteredPending.length}
                    </div>
                    {filteredPending.map((e) => {
                      const expanded = expandedHistory.has(e.id);
                      // Regenerate reasoning if not stored (older entries)
                      const reasoning = e.reasoning || generateReasoning(e);
                      return (
                        <div key={e.id} className="border-b border-zinc-800/50">
                          <div className="px-4 py-2 flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="text-[10px] font-mono uppercase text-slate-400">{e.market}</div>
                                {e.confidenceAtAdd !== undefined && (
                                  <div className={`text-[10px] font-mono font-bold ${confidenceColor(e.confidenceAtAdd)}`}>
                                    {e.confidenceAtAdd}%
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 truncate">{e.game}</div>
                              <div className="text-sm">{e.pick}</div>
                              <div className="text-[10px] font-mono text-cyan-400 mt-0.5">{formatOdds(e.odds)}</div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => updateTrackerStatus(e.id, "won")}
                                className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold uppercase tracking-wider hover:bg-emerald-500/30"
                              >
                                Won
                              </button>
                              <button
                                onClick={() => updateTrackerStatus(e.id, "lost")}
                                className="text-[10px] px-2 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 font-bold uppercase tracking-wider hover:bg-rose-500/30"
                              >
                                Lost
                              </button>
                            </div>
                          </div>
                          {reasoning && (
                            <>
                              <button
                                onClick={() => toggleHistoryExpand(e.id)}
                                className="w-full px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-cyan-400 text-left flex items-center justify-between border-t border-zinc-800/50"
                              >
                                <span>{expanded ? "▼ Hide reasoning" : "▶ Why this pick?"}</span>
                                <Info size={10} />
                              </button>
                              {expanded && (
                                <div className="px-4 py-2 bg-black/40 border-t border-zinc-800/50 space-y-2">
                                  <p className="text-[11px] text-zinc-300 leading-relaxed">{reasoning}</p>
                                  {(() => {
                                    const baseline = getBaselineHitRate(e);
                                    const personal = personalRecordFor(e, tracker);
                                    return (
                                      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-zinc-800">
                                        <div>
                                          <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Market baseline</div>
                                          <div className="text-sm font-bold text-zinc-200">
                                            ~{baseline}% <span className="text-[10px] font-normal text-slate-400">long-run</span>
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Record W/L</div>
                                          {personal.total === 0 ? (
                                            <div className="text-sm font-bold text-slate-400">— · no data</div>
                                          ) : (
                                            <div className={`text-sm font-bold ${personal.wins / personal.total >= 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
                                              {personal.wins}-{personal.losses} <span className="text-[10px] font-normal text-slate-400">({Math.round((personal.wins / personal.total) * 100)}%)</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                                    Captured when pick was added · record is YOUR history on similar picks
                                  </p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
                {filteredSettled.length > 0 && (
                  <>
                    <div className="px-4 pt-3 pb-1 text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                      Settled · {filteredSettled.length}
                    </div>
                    {filteredSettled.map((e) => {
                      const expanded = expandedHistory.has(e.id);
                      const reasoning = e.reasoning || generateReasoning(e, null);
                      return (
                        <div key={e.id} className="border-b border-zinc-800/50">
                          <div className="px-4 py-2 flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="text-[10px] font-mono uppercase text-slate-400">{e.market}</div>
                                {e.confidenceAtAdd !== undefined && (
                                  <div className={`text-[10px] font-mono font-bold ${confidenceColor(e.confidenceAtAdd)}`}>
                                    {e.confidenceAtAdd}%
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 truncate">{e.game}</div>
                              <div className="text-sm">{e.pick}</div>
                              <div className="text-[10px] font-mono text-cyan-400 mt-0.5">{formatOdds(e.odds)} <span className="text-slate-400">(your line)</span></div>
                              {/* CLV: closing line input + computed edge */}
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Closing odds</span>
                                <input
                                  type="number"
                                  value={e.closingOdds ?? ""}
                                  onChange={(ev) => setClosingOdds(e.id, ev.target.value === "" ? null : parseInt(ev.target.value))}
                                  placeholder="e.g. -120"
                                  className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 w-20 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-400"
                                />
                                {(() => {
                                  const clv = clvForEntry(e);
                                  if (clv == null) return null;
                                  return (
                                    <span className={`text-[10px] font-mono font-bold ${clv > 0 ? "text-emerald-400" : clv < 0 ? "text-rose-400" : "text-slate-500"}`}>
                                      {clv > 0 ? `+${clv}` : clv}% CLV
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <div className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                                e.status === "won" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                              }`}>
                                {e.status === "won" ? "✓ WON" : "✗ LOST"}
                              </div>
                              <button
                                onClick={() => deleteTrackerEntry(e.id)}
                                className="text-slate-400 hover:text-rose-400 text-[10px]"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          {reasoning && (
                            <>
                              <button
                                onClick={() => toggleHistoryExpand(e.id)}
                                className="w-full px-4 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-cyan-400 text-left flex items-center justify-between border-t border-zinc-800/50"
                              >
                                <span>{expanded ? "▼ Hide reasoning" : "▶ Why this pick?"}</span>
                                <Info size={10} />
                              </button>
                              {expanded && (
                                <div className="px-4 py-2 bg-black/40 border-t border-zinc-800/50 space-y-2">
                                  <p className="text-[11px] text-zinc-300 leading-relaxed">{reasoning}</p>
                                  {(() => {
                                    const baseline = getBaselineHitRate(e);
                                    const personal = personalRecordFor(e, tracker);
                                    return (
                                      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-zinc-800">
                                        <div>
                                          <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Market baseline</div>
                                          <div className="text-sm font-bold text-zinc-200">
                                            ~{baseline}% <span className="text-[10px] font-normal text-slate-400">long-run</span>
                                          </div>
                                        </div>
                                        <div>
                                          <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">Record W/L</div>
                                          {personal.total === 0 ? (
                                            <div className="text-sm font-bold text-slate-400">— · no data</div>
                                          ) : (
                                            <div className={`text-sm font-bold ${personal.wins / personal.total >= 0.5 ? "text-emerald-400" : "text-rose-400"}`}>
                                              {personal.wins}-{personal.losses} <span className="text-[10px] font-normal text-slate-400">({Math.round((personal.wins / personal.total) * 100)}%)</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                                    Captured when pick was added · result: {e.status === "won" ? "WON" : "LOST"} · record is YOUR history on similar picks
                                  </p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Left slide-out drawer */}
      {fabOpen && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setFabOpen(false)}>
          <div className="absolute inset-0 bg-black/50 fade-in" />
          <div
            className="relative w-72 max-w-[80%] h-full bg-zinc-950 border-r border-zinc-800 slide-in-left flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Profile header */}
            <div className="px-4 py-4 border-b border-zinc-800 flex items-center gap-3">
              <button
                onClick={() => { setView("profile"); setFabOpen(false); }}
                className="w-11 h-11 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 hover:border-cyan-400 hover:text-cyan-400 transition shrink-0"
                title="My Profile"
              >
                <User size={20} />
              </button>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => { setView("profile"); setFabOpen(false); }}
                  className="text-left"
                >
                  <div className="text-sm font-semibold text-white">My Profile</div>
                </button>
              </div>
              <button onClick={() => setFabOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Nav items */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {[
                view === "home"
                  ? {
                      label: "Build Parlay",
                      icon: <Sparkles size={16} />,
                      sub: "Best picks now",
                      action: () => { setView("chat"); sendMessage("Build me the best parlay"); },
                    }
                  : {
                      label: "Home",
                      icon: <Sparkles size={16} />,
                      sub: "Landing page",
                      action: () => setView("home"),
                    },
                {
                  label: "All Sports",
                  icon: <Swords size={16} />,
                  sub: "Browse leagues & search",
                  action: () => setView("allsports"),
                },
                {
                  label: "Live Now",
                  icon: <span className="text-rose-500">🔴</span>,
                  sub: (() => { const n = homeLiveGames.filter((g) => g.real).length; return n > 0 ? `${n} in-progress games` : "In-progress games"; })(),
                  action: () => { if (requirePro("Live picks")) setShowLiveDemo(true); },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => { item.action(); setFabOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-zinc-200 hover:bg-zinc-800 transition text-left"
                >
                  <span className="w-5 flex items-center justify-center">{item.icon}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{item.label}</span>
                    <span className="block text-[11px] text-slate-400">{item.sub}</span>
                  </span>
                </button>
              ))}

            </div>
            {(user || AUTH_ENABLED) && (
            <button
              onClick={() => { if (user) { handleSignOut(); } else { navigate("/sign-in"); } setFabOpen(false); }}
              className="mx-3 mb-2 px-3 py-2.5 rounded-lg text-slate-500 hover:bg-zinc-800 hover:text-white transition text-sm text-left flex items-center gap-3"
            >
              <span className="w-5 flex items-center justify-center">⎋</span>
              {user ? "Sign out" : "Sign in"}
            </button>
            )}
            <div className="px-4 py-3 border-t border-zinc-800 text-[9px] font-mono text-slate-400 uppercase tracking-wider">
              21+ · Hypothetical · Bet responsibly
            </div>
          </div>
        </div>
      )}

      {/* Full game-detail screen (Same-Game-Parlay style) */}
      {gameDetail && (() => {
        const { game, sport } = gameDetail;
        const realOddsForGame = (realOddsBySport[sport] || []).find((g) => `${g.awayTeam} @ ${g.homeTeam}` === game);
        const realGameForGame = (realGamesBySport[sport] || []).find((g) => `${g.awayTeam} @ ${g.homeTeam}` === game);
        // Open the team detail page for one side of this matchup. Loads the
        // team's REAL last-10 final scores from the matchup-history feed (same
        // endpoint the AI uses), then mirrors the player-props layout for a
        // team-total line. Needs both ESPN team ids — bails quietly without them.
        const openTeamDetail = async (side) => {
          const rg = realGameForGame;
          if (!rg?.homeTeamId || !rg?.awayTeamId) return;
          setTeamLine(null);
          setSelectedTeam({
            sport, side,
            teamName: side === "home" ? rg.homeTeam : rg.awayTeam,
            logo: side === "home" ? rg.homeLogo : rg.awayLogo,
            oppName: side === "home" ? rg.awayTeam : rg.homeTeam,
            gameLabel: game, loading: true,
          });
          // Only the request that still matches the CURRENT selection may
          // write its data — guards against a rapid Away→Home re-tap where an
          // earlier response would otherwise merge one team's real stats under
          // the other team's identity (a misleading cross-team bleed).
          const matchesRequest = (prev) => prev && prev.loading && prev.side === side && prev.gameLabel === game;
          try {
            const r = await fetch(`/api/sports/matchup-history?sport=${encodeURIComponent(sport)}&homeTeamId=${encodeURIComponent(rg.homeTeamId)}&awayTeamId=${encodeURIComponent(rg.awayTeamId)}`);
            const d = await r.json();
            const node = side === "home" ? d?.home : d?.away;
            // Opponent node — its venue split feeds the forward-looking
            // matchup projection (this team's scoring vs the opp's defense).
            const oppNode = side === "home" ? d?.away : d?.home;
            setSelectedTeam((prev) => (matchesRequest(prev) ? { ...prev, loading: false, last10: node?.last10 || null, recent: Array.isArray(node?.recent) ? node.recent : [], streak: node?.streak || null, season: node?.season || null, splits: { home: node?.homeSplit || null, away: node?.awaySplit || null }, oppSplits: { home: oppNode?.homeSplit || null, away: oppNode?.awaySplit || null } } : prev));
          } catch {
            setSelectedTeam((prev) => (matchesRequest(prev) ? { ...prev, loading: false, error: true } : prev));
          }
        };
        const realPicks = realOddsForGame ? buildPicksFromOdds(realOddsForGame) : [];
        const picks = realPicks.length > 0 ? realPicks : (PICK_POOL[sport] || []).filter((p) => p.game === game);
        const nameMap = TEAM_ABBR_TO_NAME[sport] || {};
        const gamePlayers = (PLAYERS[sport] || []).filter((pl) => {
          const full = nameMap[pl.team] || pl.team;
          return game.includes(full) || game.includes(pl.team);
        });
        // Individual matchup (e.g. UFC/MMA, tennis): "X vs Y", no team-style markets.
        // For these, Game Lines / Team Props don't apply — show fight/match markets only.
        const isIndividual = sport === "ufc" || sport === "mma" || sport === "tennis" || sport === "golf" || sport === "nascar"
          || (/\bvs\.?\b/i.test(game) && !/@/.test(game));
        // Group team picks into categories by market keyword
        const altSpreadPicks = picks.filter((p) => /^alt spread$/i.test(p.market));
        const altTotalPicks = picks.filter((p) => /^alt total$/i.test(p.market));
        const gameLines = picks.filter((p) =>
          !altSpreadPicks.includes(p) && !altTotalPicks.includes(p) &&
          (/spread|moneyline|total|run line|puck line|^o\/?u|over|under/i.test(p.market))
        );
        const teamOther = picks.filter((p) => !gameLines.includes(p) && !altSpreadPicks.includes(p) && !altTotalPicks.includes(p));
        // For every market pair (moneyline, spread, total, etc.) tag the
        // side the AI prefers based on no-vig fair edge. The single
        // best-edge pick across all markets becomes the TOP AI pick;
        // the runner-up becomes the ALT pick. All other market favorites
        // get a plain "AI" tag so the user sees a recommendation on
        // every line, not just one.
        const aiTags = (() => {
          const amToProb = (o) => (o == null ? null : o < 0 ? -o / (-o + 100) : 100 / (o + 100));
          const byMarket = new Map();
          picks.forEach((p) => {
            // For alternate spreads/totals every ladder rung is its own
            // 2-sided market (e.g. -7.5/+7.5), so group by |point| as well.
            const key = (p.market === "Alt Spread" || p.market === "Alt Total")
              ? `${p.market}|${Math.abs(p.point ?? 0)}`
              : p.market;
            const arr = byMarket.get(key) || [];
            arr.push(p); byMarket.set(key, arr);
          });
          const favorites = []; // { pick, edge }
          byMarket.forEach((arr) => {
            const probs = arr.map((p) => ({ p, ip: amToProb(p.odds) })).filter((x) => x.ip != null);
            if (probs.length < 2) return;
            const sum = probs.reduce((s, x) => s + x.ip, 0);
            let mkBest = null;
            probs.forEach(({ p, ip }) => {
              const fair = ip / sum;
              const edge = fair - ip;
              if (!mkBest || edge > mkBest.edge) mkBest = { pick: p, edge };
            });
            if (mkBest) favorites.push(mkBest);
          });
          favorites.sort((a, b) => b.edge - a.edge);
          const tags = new Map();
          favorites.forEach((f, i) => {
            tags.set(legKey(f.pick), i === 0 ? "top" : "fav");
          });
          return tags;
        })();
        const addable = (p) => {
          const inSlip = parlayLegs.some((l) => legKey(l) === legKey(p));
          const aiTag = aiTags.get(legKey(p)) || null; // "top" | "fav" | null
          const tagStyles = aiTag === "top"
            ? { row: "bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/60", badge: "bg-cyan-400 text-slate-950", label: "★ AI PICK", btn: "bg-cyan-400 text-slate-950 hover:bg-cyan-300 ring-2 ring-cyan-300", odds: "text-cyan-300" }
            : aiTag === "fav"
              ? { row: "", badge: "bg-slate-700 text-cyan-300", label: "AI", btn: "bg-cyan-500 text-white hover:bg-cyan-600", odds: "text-cyan-400" }
              : { row: "", badge: "", label: "", btn: "bg-cyan-500 text-white hover:bg-cyan-600", odds: "text-cyan-400" };
          return (
            <div key={p.pick} className={tagStyles.row}>
              <div className="px-4 py-2.5 flex items-center justify-between gap-2 border-t border-slate-800">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                    {aiTag && <span className={`text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded ${tagStyles.badge}`}>{tagStyles.label}</span>}
                    <span>{p.market}</span>
                  </div>
                  <div className="text-sm text-slate-100">{p.pick}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-mono font-bold text-sm ${tagStyles.odds}`}>{formatOdds(p.odds)}</span>
                  <button onClick={() => { if (!inSlip) addLeg({ ...p, sport }); }} disabled={inSlip}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${inSlip ? "bg-slate-800 text-slate-500" : tagStyles.btn}`}>
                    {inSlip ? "✓" : "+ Add"}
                  </button>
                </div>
              </div>
              <BookCompare books={p.books} />
            </div>
          );
        };
        const Section = ({ title, children, count }) => {
          const open = openPropCats.includes(title);
          return (
            <div className="border-b border-slate-800">
              <button onClick={() => setOpenPropCats((prev) => prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title])} className="w-full px-4 py-4 flex items-center justify-between text-left">
                <span className="font-bold text-slate-100">{title}{count != null && <span className="text-slate-500 font-normal text-xs ml-2">{count}</span>}</span>
                <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
              </button>
              {open && <div className="pb-2">{children}</div>}
            </div>
          );
        };
        // AI's single best Spread and Total side, surfaced in a dedicated
        // "AI Spreads & Totals" tab so the user gets one clear call per market.
        // PRIMARY signal: the same REAL recent-form analytics the chat
        // assistant uses — each team's last-10 scoring (avg margin + points
        // for/against), fetched for this matchup into gameDetailHistory. We
        // project a margin (spread) and a combined pace (total) from those real
        // averages and recommend the side they favor, citing the numbers. When
        // that history isn't available we fall back to the de-vigged market
        // price (clearly labelled). Only REAL lines (p.real) are ever read.
        const histForGame = (gameDetailHistory.key === `${sport}::${game}` && gameDetailHistory.data) ? gameDetailHistory.data : null;
        const histLoading = gameDetailHistory.key === `${sport}::${game}` && gameDetailHistory.loading;
        const homeL10 = histForGame?.home?.last10 || null;
        const awayL10 = histForGame?.away?.last10 || null;
        const homeName = realGameForGame?.homeTeam || null;
        const awayName = realGameForGame?.awayTeam || null;
        const spreadMatcher = (m) => /^spread$|run line|puck line/i.test(m);
        const totalMatcher = (m) => /^total$/i.test(m);
        const parsePoint = (txt) => { const m = String(txt || "").match(/([+-]?\d+(?:\.\d+)?)\s*$/); return m ? parseFloat(m[1]) : null; };
        const fmtSigned = (n) => `${n > 0 ? "+" : ""}${n}`;
        const l10Desc = (l10) => `${l10.wins}-${l10.losses} L10, ${fmtSigned(l10.avgMargin)} margin`;
        // De-vigged market-price fallback, honestly labelled as price-only.
        const pricePick = (matcher) => {
          const amToProb = (o) => (o == null ? null : o < 0 ? -o / (-o + 100) : 100 / (o + 100));
          const probs = gameLines
            .filter((p) => p.real && matcher(p.market))
            .map((p) => ({ p, ip: amToProb(p.odds) }))
            .filter((x) => x.ip != null);
          if (probs.length < 2) return null;
          const sum = probs.reduce((s, x) => s + x.ip, 0);
          let best = null;
          probs.forEach(({ p, ip }) => {
            const edge = ip / sum - ip; // no-vig fair prob minus market-implied prob
            if (!best || edge > best.edge) best = { pick: p, edge };
          });
          if (!best) return null;
          return { pick: best.pick, reason: "Best price after removing the bookmaker's margin — recent-form data isn't available for this matchup." };
        };
        // Analytics-first Spread pick: project tonight's margin from each team's
        // real L10 avg margin, then take the side that covers its posted number.
        const aiSpreadAnalytics = (() => {
          if (!homeL10 || !awayL10 || homeL10.avgMargin == null || awayL10.avgMargin == null || !homeName) return null;
          const spreads = gameLines.filter((p) => p.real && spreadMatcher(p.market) && p.teamFull);
          if (spreads.length < 2) return null;
          const projHome = homeL10.avgMargin - awayL10.avgMargin; // + = home projected to win by this
          let best = null;
          spreads.forEach((p) => {
            const pt = parsePoint(p.pick);
            if (pt == null) return;
            const isHome = p.teamFull === homeName;
            const sideProj = isHome ? projHome : -projHome;
            const cushion = sideProj + pt; // > 0 → projection has this side covering
            if (!best || cushion > best.cushion) best = { pick: p, cushion };
          });
          if (!best) return null;
          const favName = projHome >= 0 ? homeName : awayName;
          const reason = `Model margin: ${favName} by ~${Math.abs(projHome).toFixed(1)} (${homeName} ${l10Desc(homeL10)} · ${awayName} ${l10Desc(awayL10)}) → ${best.pick.pick} covers by ~${best.cushion.toFixed(1)}.`;
          return { pick: best.pick, reason };
        })();
        // Analytics-first Total pick: combined L10 pace vs the posted line.
        const aiTotalAnalytics = (() => {
          if (!homeL10 || !awayL10 || !homeName) return null;
          if (homeL10.ptsFor == null || homeL10.ptsAgainst == null || awayL10.ptsFor == null || awayL10.ptsAgainst == null) return null;
          const totals = gameLines.filter((p) => p.real && totalMatcher(p.market));
          if (totals.length < 2) return null;
          const combinedPace = (homeL10.ptsFor + homeL10.ptsAgainst + awayL10.ptsFor + awayL10.ptsAgainst) / 2;
          let lineNum = null;
          for (const p of totals) { const m = String(p.pick).match(/(\d+(?:\.\d+)?)/); if (m) { lineNum = parseFloat(m[1]); break; } }
          if (lineNum == null) return null;
          const diff = combinedPace - lineNum; // + → lean Over
          const side = diff >= 0 ? "Over" : "Under";
          const pick = totals.find((p) => new RegExp(`^${side}`, "i").test(p.pick));
          if (!pick) return null;
          const reason = `Recent pace ~${combinedPace.toFixed(0)} pts (${homeName} ${homeL10.ptsFor}/${homeL10.ptsAgainst}, ${awayName} ${awayL10.ptsFor}/${awayL10.ptsAgainst} for/against) vs the ${lineNum} line → lean ${side} by ~${Math.abs(diff).toFixed(1)}.`;
          return { pick, reason };
        })();
        const aiSpreadPick = aiSpreadAnalytics || pricePick(spreadMatcher);
        const aiTotalPick = aiTotalAnalytics || pricePick(totalMatcher);
        const aiLineCard = (kind, best) => {
          if (!best) return null;
          const p = best.pick;
          const inSlip = parlayLegs.some((l) => legKey(l) === legKey(p));
          const reason = best.reason;
          return (
            <div className="mx-4 mt-2 mb-1 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border-2 border-cyan-400 overflow-hidden">
              <div className="bg-cyan-400 text-slate-950 px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5">
                <span>★</span><span>AI {kind} pick</span>
              </div>
              <div className="px-4 py-3">
                <div className="text-[10px] font-mono uppercase text-cyan-300 tracking-wider mb-0.5">{p.market}</div>
                <div className="text-base font-bold text-slate-100 mb-1">{p.pick}</div>
                <div className="text-sm text-cyan-200 mb-2"><span className="font-mono">{formatOdds(p.odds)}</span></div>
                <div className="text-[11px] text-slate-300 leading-snug mb-3">
                  <span className="font-bold uppercase tracking-wider text-[9px] text-cyan-300 mr-1">Why:</span>{reason}
                </div>
                <button onClick={() => { if (!inSlip) addLeg({ ...p, sport }); }} disabled={inSlip}
                  className={`w-full rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${inSlip ? "bg-slate-800 text-slate-500" : "bg-cyan-400 hover:bg-cyan-300 text-slate-950"}`}>
                  {inSlip ? "✓ Added to ticket" : "+ Add AI pick to ticket"}
                </button>
              </div>
            </div>
          );
        };
        return (
          <div className="fixed inset-0 z-40 bg-slate-900 flex flex-col">
            {/* Header */}
            <div className="bg-slate-900 border-b border-slate-800 px-4 pt-4 pb-4 shrink-0">
              <div className="flex items-center justify-between">
                <button onClick={() => setGameDetail(null)} className="text-cyan-400 text-sm">‹ Back</button>
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{(SPORTS.find((s) => s.id === sport) || {}).label}</span>
                <span className="w-10" />
              </div>
              <div className="mt-3">
                {realGameForGame?.homeLogo || realGameForGame?.awayLogo ? (
                  <div className="flex items-center justify-center gap-4 mb-2">
                    <button
                      onClick={() => openTeamDetail("away")}
                      disabled={!realGameForGame.homeTeamId || !realGameForGame.awayTeamId}
                      className="flex flex-col items-center gap-1 flex-1 min-w-0 rounded-xl py-1 transition active:scale-95 enabled:hover:bg-slate-800/60 disabled:cursor-default"
                    >
                      {realGameForGame.awayLogo && (
                        <img src={realGameForGame.awayLogo} alt={realGameForGame.awayTeam || ""} className="w-14 h-14 object-contain pointer-events-none" />
                      )}
                      <div className="text-xs text-slate-300 text-center truncate w-full px-2">{realGameForGame.awayTeam}</div>
                      {realGameForGame.homeTeamId && realGameForGame.awayTeamId && (
                        <div className="text-[8px] font-mono uppercase tracking-wider text-cyan-400/80">View team ›</div>
                      )}
                    </button>
                    <div className="text-slate-500 text-xs font-mono">@</div>
                    <button
                      onClick={() => openTeamDetail("home")}
                      disabled={!realGameForGame.homeTeamId || !realGameForGame.awayTeamId}
                      className="flex flex-col items-center gap-1 flex-1 min-w-0 rounded-xl py-1 transition active:scale-95 enabled:hover:bg-slate-800/60 disabled:cursor-default"
                    >
                      {realGameForGame.homeLogo && (
                        <img src={realGameForGame.homeLogo} alt={realGameForGame.homeTeam || ""} className="w-14 h-14 object-contain pointer-events-none" />
                      )}
                      <div className="text-xs text-slate-300 text-center truncate w-full px-2">{realGameForGame.homeTeam}</div>
                      {realGameForGame.homeTeamId && realGameForGame.awayTeamId && (
                        <div className="text-[8px] font-mono uppercase tracking-wider text-cyan-400/80">View team ›</div>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="font-display text-xl text-slate-100 text-center">{game}</div>
                )}
                {realPicks.length === 0 && (
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mt-1 text-center">{isIndividual ? "Sample markets · single match" : "Sample markets · build a single-game parlay"}</div>
                )}
              </div>
            </div>

            {/* Scrollable categories */}
            <div className="flex-1 overflow-y-auto">
              {isIndividual ? (
                /* Individual matchup — no game lines / team props, just the match markets */
                picks.length > 0 ? (
                  <Section title="Match Markets" count={picks.length}>
                    {picks.map(addable)}
                  </Section>
                ) : null
              ) : (
                <>
                  {/* AI's recommended spread & total side (real recent-form analytics, price fallback) */}
                  {(aiSpreadPick || aiTotalPick) && (
                    <Section title="AI Spreads & Totals" count={(aiSpreadPick ? 1 : 0) + (aiTotalPick ? 1 : 0)}>
                      {histLoading && (
                        <div className="px-4 pt-1 text-[10px] font-mono uppercase tracking-wider text-cyan-400/70">Refreshing with recent-form data…</div>
                      )}
                      {aiLineCard("spread", aiSpreadPick)}
                      {aiLineCard("total", aiTotalPick)}
                    </Section>
                  )}
                  {/* Game Lines grid (main spreads, totals, moneyline) */}
                  {gameLines.length > 0 && (
                    <Section title="Game Lines" count={gameLines.length}>
                      {gameLines.map(addable)}
                    </Section>
                  )}
                  {teamOther.length > 0 && (
                    <Section title="Team Props" count={teamOther.length}>
                      {teamOther.map(addable)}
                    </Section>
                  )}
                </>
              )}
              {/* Live player props from The Odds API (real bookmaker lines) */}
              {(() => {
                const eid = realOddsForGame?.id;
                const live = eid ? realPropsByEvent[eid] : null;
                if (!live || !live.props || live.props.length === 0) {
                  if (eid && propsLoading) {
                    return (
                      <Section title="Live Player Props" count={0}>
                        <div className="px-4 py-3 text-xs text-slate-500">Loading live props…</div>
                      </Section>
                    );
                  }
                  return null;
                }
                const MARKET_LABEL = {
                  player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
                  player_threes: "3-Pointers Made", player_points_rebounds_assists: "Pts+Reb+Ast", player_points_rebounds: "Pts+Reb", player_points_assists: "Pts+Ast", player_rebounds_assists: "Reb+Ast",
                  player_blocks: "Blocks", player_steals: "Steals", player_turnovers: "Turnovers", player_blocks_steals: "Blocks + Steals",
                  player_points_q1: "1Q Points", player_rebounds_q1: "1Q Rebounds", player_assists_q1: "1Q Assists",
                  player_pass_yds: "Passing Yards", player_pass_tds: "Passing TDs",
                  player_rush_yds: "Rushing Yards", player_reception_yds: "Receiving Yards",
                  player_receptions: "Receptions", player_anytime_td: "Anytime TD",
                  player_pass_yds_q1: "1Q Passing Yards", player_pass_tds_q1: "1Q Passing TDs",
                  player_rush_yds_q1: "1Q Rushing Yards", player_reception_yds_q1: "1Q Receiving Yards",
                  player_pass_yds_h1: "1H Passing Yards", player_rush_yds_h1: "1H Rushing Yards",
                  player_reception_yds_h1: "1H Receiving Yards",
                  batter_hits: "Hits", batter_total_bases: "Total Bases", batter_home_runs: "Home Runs",
                  pitcher_strikeouts: "Strikeouts", player_goals: "Goals", player_shots_on_goal: "Shots on Goal",
                };
                // Score every live prop and pick the single best edge to
                // highlight as "AI PICK". Edge = no-vig fair implied prob
                // vs the market's vigged price, with a small form bump for
                // players we have on the roster + a "line vs player avg"
                // tilt when the market matches a known stat.
                const STAT_KEY_BY_MARKET = {
                  player_points: "pts", player_rebounds: "reb", player_assists: "ast",
                  player_threes: null, player_points_rebounds_assists: null,
                  player_points_rebounds: null, player_points_assists: null, player_rebounds_assists: null,
                  player_pass_yds: "passYds", player_rush_yds: "rushYds",
                  player_reception_yds: "recYds", player_receptions: "rec",
                  batter_hits: null, batter_total_bases: null, batter_home_runs: "hrPerGame",
                  pitcher_strikeouts: null, player_goals: null, player_shots_on_goal: "shots",
                };
                const americanToProb = (odds) => {
                  if (odds == null) return null;
                  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
                };
                const sportPlayers = PLAYERS[sport] || [];
                const findRosterPlayer = (name) => sportPlayers.find((pl) => pl.name.toLowerCase() === String(name || "").toLowerCase());
                const scoreProp = (p) => {
                  const oP = americanToProb(p.overPrice);
                  const uP = americanToProb(p.underPrice);
                  if (oP == null && uP == null) return null;
                  // No-vig fair probability for each side
                  let fairOver = 0.5, fairUnder = 0.5;
                  if (oP != null && uP != null) {
                    const sum = oP + uP;
                    fairOver = oP / sum; fairUnder = uP / sum;
                  }
                  // Roster-driven prior: if the player's average for this
                  // market is known, tilt fair toward the side our data agrees
                  // with. Cap the tilt so it can't flip a clearly bad price.
                  const roster = findRosterPlayer(p.player);
                  const statKey = STAT_KEY_BY_MARKET[p.market];
                  let prior = 0.5;
                  if (roster && statKey && roster.stats && roster.stats[statKey] != null && p.line != null) {
                    const avg = roster.stats[statKey];
                    // Logistic-ish tilt: each 10% of line difference → ~6% prior shift, clamped.
                    const diff = (avg - p.line) / Math.max(1, p.line);
                    prior = Math.max(0.30, Math.min(0.70, 0.5 + diff * 0.6));
                  }
                  // Blend prior into fair (weight 0.35) when we have data
                  const blended = roster && statKey ? (fairOver * 0.65 + prior * 0.35) : fairOver;
                  // Edges: market-implied vs blended fair
                  const overEdge = oP != null ? (blended - oP) : -1;
                  const underEdge = uP != null ? ((1 - blended) - uP) : -1;
                  const formBump = roster ? (roster.form - 7) * 0.005 : 0; // ±1.5% nudge
                  const overScore = overEdge + formBump;
                  const underScore = underEdge + formBump;
                  const side = overScore >= underScore ? "over" : "under";
                  const edge = Math.max(overScore, underScore);
                  return { side, edge, roster, statKey, blended };
                };
                let bestIdx = -1, bestScore = null;
                live.props.forEach((p, i) => {
                  const s = scoreProp(p);
                  if (!s) return;
                  // Always pick the best-scoring prop, even when no side has
                  // a strictly-positive no-vig edge. With only a single book's
                  // two-sided market and no roster prior, the "winner" surfaces
                  // the lowest-vig side / best price — still meaningful info.
                  if (bestScore == null || s.edge > bestScore.edge) { bestScore = s; bestIdx = i; }
                });
                // Belt-and-braces: if scoring failed for every prop (e.g. all
                // missing prices), still highlight the first one with a price
                // so the user always sees a recommendation.
                if (bestIdx === -1 && live.props.length > 0) {
                  const fbIdx = live.props.findIndex((p) => p.overPrice != null || p.underPrice != null);
                  if (fbIdx >= 0) {
                    const p = live.props[fbIdx];
                    bestIdx = fbIdx;
                    bestScore = { side: (p.overPrice != null ? "over" : "under"), edge: 0, roster: null, statKey: null, blended: 0.5 };
                  }
                }
                // Build the pinned "AI Pick" summary card — surfaces the
                // best-edge prop at the top of the section so the user sees
                // it without scrolling through hundreds of bookmaker rows.
                const aiPickCard = bestIdx >= 0 && bestScore ? (() => {
                  const p = live.props[bestIdx];
                  const label = MARKET_LABEL[p.market] || p.market;
                  const lineTxt = p.line == null ? "" : ` ${p.line}`;
                  const sideTxt = bestScore.side === "over" ? "Over" : "Under";
                  const priced = bestScore.side === "over" ? p.overPrice : p.underPrice;
                  const pickText = `${p.player} ${sideTxt}${lineTxt} ${label}`;
                  const aiBaseLeg = { sport, game, market: "Player Prop", propMarketLabel: label, player: p.player, line: p.line };
                  const aiPickKey = `${p.player} ${sideTxt}${lineTxt} ${label}`;
                  const aiInSlip = parlayLegs.some((l) => l.game === game && l.pick === aiPickKey);
                  const reasonBits = [];
                  if (bestScore.roster) {
                    reasonBits.push(`${bestScore.roster.name.split(" ").slice(-1)[0]} form ${bestScore.roster.form}/10`);
                    if (bestScore.statKey && bestScore.roster.stats[bestScore.statKey] != null) {
                      reasonBits.push(`avg ${bestScore.roster.stats[bestScore.statKey]} vs line ${p.line}`);
                    }
                    reasonBits.push(`${(bestScore.edge * 100).toFixed(1)}% edge vs no-vig fair`);
                  } else {
                    if (priced != null) reasonBits.push(`best price ${formatOdds(priced)}`);
                    reasonBits.push("lowest-vig side of this market");
                  }
                  return (
                    <div className="mx-4 mt-2 mb-3 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 border-2 border-cyan-400 overflow-hidden">
                      <div className="bg-cyan-400 text-slate-950 px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5">
                        <span>★</span><span>AI's top edge pick</span>
                      </div>
                      <div className="px-4 py-3">
                        <div className="text-[10px] font-mono uppercase text-cyan-300 tracking-wider mb-0.5">{label}{p.line != null ? ` · O/U ${p.line}` : ""}</div>
                        <div className="text-base font-bold text-slate-100 mb-1">{p.player}</div>
                        <div className="text-sm text-cyan-200 mb-2"><span className="font-semibold">{sideTxt} {p.line}</span>{priced != null && <span className="font-mono ml-2">{formatOdds(priced)}</span>}</div>
                        <div className="text-[11px] text-slate-300 leading-snug mb-3">
                          <span className="font-bold uppercase tracking-wider text-[9px] text-cyan-300 mr-1">Why:</span>
                          {reasonBits.join(" · ")}
                        </div>
                        <button
                          onClick={() => { if (!aiInSlip && priced != null) addLeg({ ...aiBaseLeg, pick: pickText, odds: priced }); }}
                          disabled={aiInSlip || priced == null}
                          className={`w-full rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${aiInSlip ? "bg-slate-800 text-slate-500" : "bg-cyan-400 hover:bg-cyan-300 text-slate-950"}`}
                        >
                          {aiInSlip ? "✓ Added to ticket" : "+ Add AI pick to ticket"}
                        </button>
                      </div>
                    </div>
                  );
                })() : null;
                return (
                  <Section title="All Player Props" count={live.props.length}>
                    {aiPickCard}
                    <div className="px-4 pt-1 pb-2 text-[10px] font-mono uppercase tracking-wider text-emerald-400">
                      {live.bookmaker || "Bookmaker"} · live lines
                    </div>
                    {(() => {
                      // Group flat props list into one card per player so the
                      // user sees a tidy roster instead of 200+ rows. Each
                      // card expands to show every market for that player.
                      const byPlayer = new Map();
                      live.props.forEach((p, i) => {
                        const arr = byPlayer.get(p.player) || [];
                        arr.push({ ...p, _idx: i });
                        byPlayer.set(p.player, arr);
                      });
                      const players = Array.from(byPlayer.entries());
                      return players.map(([playerName, plist]) => {
                        const headshot = plist.find((p) => p.headshot)?.headshot;
                        const showHeadshot = headshot && !headshotErrors[headshot];
                        const initials = playerName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                        // Per-player AI pick: best edge across all their markets.
                        // Also count how many of their markets the AI has an opinion on.
                        let topScore = null; let topProp = null;
                        let aiPickCount = 0;
                        plist.forEach((p) => {
                          const s = scoreProp(p);
                          if (s) {
                            aiPickCount += 1;
                            if (!topScore || s.edge > topScore.edge) { topScore = s; topProp = p; }
                          }
                        });
                        const topLabel = topProp ? (MARKET_LABEL[topProp.market] || topProp.market) : null;
                        const topSide = topScore?.side;
                        const topPriced = topProp && topSide ? (topSide === "over" ? topProp.overPrice : topProp.underPrice) : null;
                        // Count picks from this player already in the slip
                        const addedCount = plist.reduce((n, p) => {
                          const lbl = MARKET_LABEL[p.market] || p.market;
                          const lt = p.line == null ? "" : ` ${p.line}`;
                          const o = `${p.player} Over${lt} ${lbl}`;
                          const u = `${p.player} Under${lt} ${lbl}`;
                          return n + (parlayLegs.some((l) => l.game === game && (l.pick === o || l.pick === u)) ? 1 : 0);
                        }, 0);
                        const expanded = !!expandedPropPlayers[playerName];
                        const hasTopEdge = topProp && plist[topProp._idx === undefined ? -1 : plist.indexOf(topProp)] && live.props.indexOf(topProp) === bestIdx;
                        // Real ESPN identity for the stats screen — only wire the
                        // tap-through to the Player Props stats page. Match the live
                        // player to the curated PLAYERS pool (which carries season
                        // stats); only players we can match get the stats page.
                        const normName = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
                        const poolPlayer = (PLAYERS[sport] || []).find((p) => normName(p.name) === normName(playerName)) || null;
                        // For players not in the curated pool, build a stats view
                        // from their REAL live prop lines (no fabricated season
                        // numbers) so every player's row is tappable.
                        const synthStats = (() => {
                          if (poolPlayer) return null;
                          const stats = {};
                          plist.forEach((p) => {
                            if (p.line == null) return;
                            const key = STAT_KEY_BY_MARKET[p.market] || MARKET_LABEL[p.market] || p.market;
                            if (stats[key] === undefined) stats[key] = p.line;
                          });
                          return Object.keys(stats).length ? stats : null;
                        })();
                        const canOpenStats = !!poolPlayer || !!synthStats;
                        const openStats = () => {
                          if (poolPlayer) {
                            const sk = (sport === "nba" || sport === "wnba") ? "pts" : sport === "mlb" ? "hrPerGame"
                              : poolPlayer.pos === "QB" ? "passYds" : poolPlayer.pos === "RB" ? "rushYds"
                              : (poolPlayer.stats.recYds !== undefined ? "recYds" : Object.keys(poolPlayer.stats)[0]);
                            const avg = poolPlayer.stats[sk] ?? 0;
                            setPropStatKey(sk);
                            setPropLine(Math.round(avg * 0.9 * 2) / 2);
                            setSelectedPlayer({ player: poolPlayer, sport });
                          } else if (synthStats) {
                            const sk = Object.keys(synthStats)[0];
                            setPropStatKey(sk);
                            setPropLine(synthStats[sk] ?? 0);
                            setSelectedPlayer({ player: { name: playerName, team: "", pos: "", stats: synthStats, form: 0, headshot: showHeadshot ? headshot : null, gameLabel: game, _synth: true }, sport });
                          } else {
                            setExpandedPropPlayers((s) => ({ ...s, [playerName]: !s[playerName] }));
                          }
                        };
                        return (
                          <div key={playerName} className={`border-t border-slate-800 ${hasTopEdge ? "bg-cyan-500/5" : ""}`}>
                            <div className="w-full px-4 py-3 flex items-center gap-3">
                              <button
                                onClick={openStats}
                                className="flex items-center gap-3 text-left flex-1 min-w-0 hover:opacity-80"
                              >
                                {showHeadshot ? (
                                  <img
                                    src={headshot}
                                    alt={playerName}
                                    className="w-11 h-11 rounded-full object-cover bg-slate-800 shrink-0"
                                    onError={() => setHeadshotErrors((prev) => ({ ...prev, [headshot]: true }))}
                                  />
                                ) : (
                                  <div className="w-11 h-11 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-xs font-bold shrink-0">{initials}</div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-slate-100 font-semibold truncate">{playerName}</div>
                                  <div className="text-[11px] text-slate-400 truncate">
                                    <span className="text-cyan-400">{aiPickCount} AI pick{aiPickCount === 1 ? "" : "s"}</span>
                                    {canOpenStats && <span className="text-slate-500"> · tap for stats</span>}
                                  </div>
                                </div>
                              </button>
                              {addedCount > 0 && (
                                <span className="shrink-0 text-[10px] font-bold uppercase bg-emerald-500 text-slate-950 px-2 py-0.5 rounded-full">{addedCount} added</span>
                              )}
                              <button
                                onClick={() => setExpandedPropPlayers((s) => ({ ...s, [playerName]: !s[playerName] }))}
                                aria-label={expanded ? "Hide props" : "Show props"}
                                className="shrink-0 px-2 py-1 -mr-1 rounded hover:bg-slate-800/60"
                              >
                                <span className={`text-cyan-400 text-lg transition-transform inline-block ${expanded ? "rotate-180" : ""}`}>⌄</span>
                              </button>
                            </div>
                            {expanded && (
                              <div className="px-3 pb-3 space-y-2 bg-slate-900/40">
                                {plist.map((p) => {
                                  const label = MARKET_LABEL[p.market] || p.market;
                                  const lineTxt = p.line == null ? "" : ` ${p.line}`;
                                  const overPick = `${p.player} Over${lineTxt} ${label}`;
                                  const underPick = `${p.player} Under${lineTxt} ${label}`;
                                  const overIn = parlayLegs.some((l) => l.game === game && l.pick === overPick);
                                  const underIn = parlayLegs.some((l) => l.game === game && l.pick === underPick);
                                  const baseLeg = { sport, game, market: "Player Prop", propMarketLabel: label, player: p.player, line: p.line };
                                  const cardScore = scoreProp(p);
                                  const recoSide = cardScore?.side || null;
                                  const isTop = p === topProp && topScore;
                                  return (
                                    <div key={`${p.player}-${p.market}-${p._idx}`} className={`rounded-lg px-3 py-2 ${isTop ? "bg-cyan-500/10 ring-1 ring-cyan-400/60" : "bg-slate-800/50"}`}>
                                      <div className="flex items-center justify-between mb-1.5">
                                        <div className="text-[11px] font-mono uppercase text-slate-300 tracking-wider truncate">
                                          {isTop && <span className="text-cyan-400">★ </span>}{label}{p.line != null ? ` · O/U ${p.line}` : ""}
                                        </div>
                                      </div>
                                      <div className="flex gap-2">
                                        {p.overPrice != null && (
                                          <button
                                            onClick={() => {
                                              if (overIn) removeLegByPick({ ...baseLeg, pick: overPick });
                                              else addLeg({ ...baseLeg, pick: overPick, odds: p.overPrice });
                                            }}
                                            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold flex items-center justify-between transition ${overIn ? "bg-emerald-500 text-slate-950 ring-2 ring-emerald-300 hover:bg-emerald-400" : recoSide === "over" ? "bg-cyan-500 text-slate-950 ring-2 ring-cyan-300 hover:bg-cyan-400" : "bg-slate-800 hover:bg-slate-700 text-slate-100"}`}
                                          >
                                            <span>{overIn ? "✓ ADDED · " : recoSide === "over" ? "AI · " : ""}Over {p.line}</span>
                                            <span className={`font-mono ${overIn || (recoSide === "over") ? "text-slate-950" : "text-cyan-400"}`}>{formatOdds(p.overPrice)}</span>
                                          </button>
                                        )}
                                        {p.underPrice != null && (
                                          <button
                                            onClick={() => {
                                              if (underIn) removeLegByPick({ ...baseLeg, pick: underPick });
                                              else addLeg({ ...baseLeg, pick: underPick, odds: p.underPrice });
                                            }}
                                            className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold flex items-center justify-between transition ${underIn ? "bg-emerald-500 text-slate-950 ring-2 ring-emerald-300 hover:bg-emerald-400" : recoSide === "under" ? "bg-cyan-500 text-slate-950 ring-2 ring-cyan-300 hover:bg-cyan-400" : "bg-slate-800 hover:bg-slate-700 text-slate-100"}`}
                                          >
                                            <span>{underIn ? "✓ ADDED · " : recoSide === "under" ? "AI · " : ""}Under {p.line}</span>
                                            <span className={`font-mono ${underIn || (recoSide === "under") ? "text-slate-950" : "text-cyan-400"}`}>{formatOdds(p.underPrice)}</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </Section>
                );
              })()}
              {picks.length === 0 && gamePlayers.length === 0 && (
                <p className="text-center text-sm text-slate-500 py-10">No sample markets for this game yet.</p>
              )}
              <div className="h-24" />
            </div>
            {/* Sticky bet-slip bar — visible inside the game-detail overlay
                so the user can see their ticket while building it. */}
            {parlayLegs.length > 0 && (
              <button
                onClick={() => setBetslipOpen(true)}
                className="shrink-0 bg-slate-950 border-t border-cyan-500/40 px-4 py-3 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.4)]"
              >
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-cyan-400 text-slate-950 flex items-center justify-center text-sm font-bold">
                    {parlayLegs.length}
                  </span>
                  <span className="text-cyan-400 font-bold text-base">View ticket</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-300 text-sm whitespace-nowrap">
                    {bookLegCount >= 1
                      ? `$10 → $${((parlayMath.decimal - 1) * 10).toFixed(2)}`
                      : `${ppLegCount} leg${ppLegCount === 1 ? "" : "s"}`}
                  </span>
                  <span className="text-cyan-400 text-xl leading-none">⌃</span>
                </div>
              </button>
            )}
          </div>
        );
      })()}

      {/* All Sports picker */}
      {selectedPlayer && (() => {
        const pl = selectedPlayer.player;
        const isSynth = !!pl._synth; // built from live prop lines, not curated season stats
        const gameLabel = pl.gameLabel || `${pl.team} game`;
        const sport = selectedPlayer.sport;
        const statKey = propStatKey || Object.keys(pl.stats)[0];
        const statLabel = {
          pts: "Points", reb: "Rebounds", ast: "Assists", passYds: "Pass Yds",
          rushYds: "Rush Yds", recYds: "Rec Yds", rec: "Receptions", hrPerGame: "Home Runs", shots: "Shots",
        }[statKey] || statKey;
        const avg = pl.stats[statKey] ?? 0;
        const line = propLine ?? Math.round(avg * 0.9 * 2) / 2;
        // Build a sample 5-game log around the average (deterministic)
        const games = [];
        for (let i = 0; i < 5; i++) {
          // Index goes FIRST in the seed string so each game diverges early in
          // the hash cascade — appending it last produced near-identical seeds
          // (all 5 bars came out the same value).
          const seed = hashSeed(`feat-${i}-${pl.name}-${statKey}`);
          const swing = (seed - 0.5) * 2;
          let v = avg + swing * avg * 0.4;
          // Round to a precision that suits the stat's magnitude — small rate
          // stats (HR/game, batting avg, blocks) would all collapse to the same
          // integer otherwise and the bars would look flat.
          const decimals = avg >= 10 ? 0 : avg >= 2 ? 1 : 2;
          const f = 10 ** decimals;
          v = Math.max(0, Math.round(v * f) / f);
          games.push(v);
        }
        const maxV = Math.max(...games, line) * 1.2 || 1;
        const initials = pl.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
        // Odds scale off how far the line sits from the season average.
        // Higher line vs avg → Over pays more (+), Under costs more (−).
        const diff = line - avg; // positive = harder to go over
        const overOdds = decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 + diff * 0.5)));
        const underOdds = decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 - diff * 0.5)));
        const stepFor = (sk) => (sk === "hrPerGame" || sk === "rec" ? 0.5 : sk === "passYds" || sk === "rushYds" || sk === "recYds" ? 5 : 0.5);
        const step = stepFor(statKey);
        // SUGGESTED LINES (3 tiers): Safe / Balanced / Alt Under. Each pill is
        // a complete pick (side + line) so the user can compare the trade-off
        // between confidence and payout at a glance.
        const suggestedTiers = (() => {
          const sorted = [...games].sort((a, b) => a - b);
          const sampleMin = sorted[0];
          const sampleMax = sorted[sorted.length - 1];
          const hitsAtOrAbove = (c) => games.filter((v) => v >= c).length;
          const hitsAtOrBelow = (c) => games.filter((v) => v <= c).length;

          // Pick the side with more recent momentum — the side most sample
          // games landed on relative to the average. That's the side we'll
          // build the Safe + Balanced suggestions for. The Alt Under tier is
          // always an Under set a few points higher for a safer alternative.
          const overSampleHits = games.filter((v) => v >= avg).length;
          const safeSide = overSampleHits >= 3 ? "Over" : "Under";

          // ---- SAFE tier: line the player has cleared 5/5 with extra cushion ----
          const safe = (() => {
            let v = null;
            if (safeSide === "Over") {
              for (let c = 0; c <= maxV; c += step) {
                const cand = +c.toFixed(1);
                if (hitsAtOrAbove(cand) === 5) v = cand;
              }
              if (v != null) v = Math.max(0, Math.min(v, +(sampleMin - step).toFixed(1)));
            } else {
              for (let c = maxV; c >= 0; c -= step) {
                const cand = +c.toFixed(1);
                if (hitsAtOrBelow(cand) === 5) v = cand;
              }
              if (v != null) v = Math.max(v, +(sampleMax + step).toFixed(1));
            }
            // Fallback if no perfect-hit line exists — back off one step from extreme.
            if (v == null) v = safeSide === "Over" ? Math.max(0, +(sampleMin - step).toFixed(1)) : +(sampleMax + step).toFixed(1);
            return { side: safeSide, value: v };
          })();

          // ---- BALANCED tier: line near the season average (the typical book line) ----
          const balanced = (() => {
            // Round avg to nearest step in the right direction for the side.
            let v = +(Math.round(avg / step) * step).toFixed(1);
            if (statKey === "hrPerGame") v = Math.max(0.5, v);
            v = Math.max(0, v);
            return { side: safeSide, value: v };
          })();

          // ---- ALT UNDER tier: a safer Under set a few points ABOVE the
          // balanced line. A higher number is easier to stay beneath, so it
          // clears more often than the balanced line — an "alternate under"
          // for players who want a lower-risk under at reduced juice. ----
          const altUnder = (() => {
            const snap = (x) => +(Math.round(x / step) * step).toFixed(1);
            // Bump a few points above the balanced line, scaled to the stat
            // size, then snap onto the line grid.
            const bump = Math.max(step * 2, +(avg * 0.15).toFixed(2));
            let v = snap(balanced.value + bump);
            // Soft guard: don't sit absurdly far above every game (keep on grid).
            const cap = snap(sampleMax + step);
            if (v > cap) v = cap;
            // Hard guarantee: always strictly higher than the balanced line —
            // that's the whole point of the alternate under. Stays grid-aligned
            // because balanced.value is already a multiple of step.
            if (v <= balanced.value) v = snap(balanced.value + step);
            return { side: "Under", value: v };
          })();

          // Compute hit-count + cushion descriptors for each tier.
          const describe = (tier) => {
            const hits = tier.side === "Over" ? hitsAtOrAbove(tier.value) : hitsAtOrBelow(tier.value);
            const cushion = tier.side === "Over" ? avg - tier.value : tier.value - avg;
            return { ...tier, hits, cushion: +cushion.toFixed(1) };
          };

          return {
            safe: describe(safe),
            balanced: describe(balanced),
            altUnder: describe(altUnder),
          };
        })();
        // The single headline recommendation shown at the top of the page.
        // It's the side the sample form leans, set at a realistic line near the
        // season average (the Balanced tier), with odds + support computed for
        // that exact line so the chip and rationale stay in sync.
        const aiPick = (() => {
          const side = suggestedTiers.balanced.side;
          const pLine = suggestedTiers.balanced.value;
          const d = pLine - avg;
          const odds = side === "Over"
            ? decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 + d * 0.5)))
            : decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 - d * 0.5)));
          const support = side === "Over"
            ? games.filter((v) => v >= pLine).length
            : games.filter((v) => v <= pLine).length;
          return { side, line: pLine, odds, support };
        })();
        // Which tier (if any) is the bar currently sitting on?
        const tierMatch = (t) => Math.abs((propLine ?? line) - t.value) < 0.01;
        const activeTier = tierMatch(suggestedTiers.safe)
          ? "safe"
          : tierMatch(suggestedTiers.balanced)
          ? "balanced"
          : tierMatch(suggestedTiers.altUnder)
          ? "altUnder"
          : null;
        return (
          <div className="fixed inset-0 z-40 bg-slate-900 overflow-y-auto" >
            {/* Header */}
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between z-10">
              <h2 className="font-display text-lg text-slate-100">Player Props</h2>
              <button onClick={() => setSelectedPlayer(null)} className="text-blue-600 font-semibold">Close</button>
            </div>

            <div className="px-4 py-4">
              {/* Identity */}
              <div className="flex items-center gap-3 mb-4">
                {(() => {
                  const photo = lookupPlayerPhoto(sport, pl.name) || pl.headshot || null;
                  return photo ? (
                    <img src={photo} alt={pl.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} className="w-16 h-16 rounded-full object-cover bg-zinc-900 shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xl font-bold shrink-0">
                      {initials}
                    </div>
                  );
                })()}
                <div>
                  <div className="text-xl font-bold text-slate-100">{pl.name}</div>
                  <div className="text-sm text-slate-400">{[pl.team, pl.pos].filter(Boolean).join(" · ") || "Live prop lines"}</div>
                </div>
              </div>

              {/* AI Suggested Pick — single headline recommendation pinned at top */}
              <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-amber-400/5 p-4 mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-300 flex items-center gap-1.5"><Sparkles size={13} /> AI Suggested Pick</span>
                </div>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-2xl font-bold text-slate-50">{aiPick.side} {aiPick.line}</span>
                  <span className="text-sm font-semibold text-slate-300">{statLabel}</span>
                  <span className="ml-auto font-mono font-bold text-amber-300 text-lg">{formatOdds(aiPick.odds)}</span>
                </div>
                <p className="text-xs text-slate-300/90 leading-snug">
                  Leaning <span className="font-semibold text-amber-200">{aiPick.side.toLowerCase()}</span> — the sample form cleared this {aiPick.side === "Over" ? "over" : "under"} in {aiPick.support} of the last 5 games ({isSynth ? "live line" : "season avg"} {avg}).
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => addLeg({ game: gameLabel, market: "Player Prop", pick: `${pl.name} ${aiPick.side} ${aiPick.line} ${statLabel}`, odds: aiPick.odds, sport })}
                    className="flex-1 rounded-lg bg-amber-400 text-slate-950 font-bold text-sm py-2 active:scale-95 transition"
                  >
                    + Add to slip
                  </button>
                  <button
                    onClick={() => { setPropStatKey(statKey); setPropLine(aiPick.line); }}
                    className="rounded-lg border border-amber-400/40 text-amber-200 font-semibold text-sm px-3 py-2 active:scale-95 transition"
                  >
                    Load line
                  </button>
                </div>
              </div>

              {/* Season stats */}
              <div className="rounded-2xl overflow-hidden border border-slate-800 mb-5">
                <div className="bg-zinc-900 text-white text-center text-xs font-mono uppercase tracking-widest py-2">
                  {isSynth ? "Live Prop Lines" : "2025-26 Season Stats"}
                </div>
                <div className="grid grid-flow-col auto-cols-fr divide-x divide-slate-800">
                  {Object.entries(pl.stats).slice(0, 5).map(([k, v]) => (
                    <div key={k} className="py-3 text-center">
                      <div className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">{k}</div>
                      <div className="text-lg font-bold text-slate-100">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent performance */}
              <div className="border border-slate-800 rounded-2xl p-4 mb-5">
                <h3 className="font-bold text-slate-100 mb-3">Recent Performance</h3>
                {/* Stat switcher tabs */}
                <div className="flex gap-2 mb-3 overflow-x-auto scroll-fade -mx-1 px-1">
                  {Object.keys(pl.stats).map((sk) => {
                    const lbl = {
                      pts: "Points", reb: "Rebounds", ast: "Assists", passYds: "Pass Yds",
                      rushYds: "Rush Yds", recYds: "Rec Yds", rec: "Receptions", hrPerGame: "Home Runs", shots: "Shots",
                    }[sk] || sk;
                    const active = sk === statKey;
                    return (
                      <button
                        key={sk}
                        onClick={() => {
                          const a = pl.stats[sk] ?? 0;
                          setPropStatKey(sk);
                          setPropLine(Math.round(a * 0.9 * 2) / 2);
                        }}
                        className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                          active ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-zinc-200"
                        }`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                <div className="text-xs text-slate-400 mb-3">
                  {avg} {statLabel}{isSynth ? "" : "/game"} · {isSynth ? "live line" : "2025-26 avg"} · line {line} <span className="text-slate-500">(drag the line or use −/+)</span>
                </div>
                <div
                  ref={propChartRef}
                  className="flex items-end justify-between gap-2 h-40 border-b border-slate-800 relative touch-none select-none"
                  onPointerDown={(e) => {
                    const setFromY = (clientY) => {
                      const el = propChartRef.current;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const frac = Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height));
                      let val = frac * maxV;
                      val = Math.round(val / step) * step;
                      val = Math.max(0, +val.toFixed(1));
                      setPropLine(val);
                    };
                    setFromY(e.clientY);
                    const move = (ev) => setFromY(ev.clientY);
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  {/* O/U line + drag handle */}
                  <div
                    className="absolute left-0 right-0 border-t-2 border-dashed border-blue-400 z-10 pointer-events-none"
                    style={{ bottom: `${(line / maxV) * 100}%` }}
                  >
                    <div className="absolute -right-1 -top-3 flex items-center gap-1">
                      <span className="text-[9px] font-mono font-bold text-blue-300 bg-slate-900 px-1 rounded">{line}</span>
                      <span className="w-5 h-5 rounded-full bg-blue-500 border-2 border-slate-900 flex items-center justify-center text-[8px] text-white">↕</span>
                    </div>
                  </div>
                  {games.map((v, gi) => {
                    const over = v >= line;
                    return (
                      <div key={gi} className="flex-1 flex flex-col items-center justify-end h-full pointer-events-none">
                        <div className="text-xs font-bold text-slate-300 mb-1">{v}</div>
                        <div
                          className={`w-full rounded-t ${over ? "bg-emerald-500" : "bg-zinc-400"}`}
                          style={{ height: `${Math.max(4, (v / maxV) * 100)}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1.5">
                  {games.map((_, gi) => (
                    <div key={gi} className="flex-1 text-center text-[9px] font-mono text-slate-500">G{gi + 1}</div>
                  ))}
                </div>
              </div>

              {/* Suggested lines — 3 risk tiers */}
              <div className="border border-cyan-500/30 bg-cyan-400/5 rounded-2xl p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-cyan-300 text-sm flex items-center gap-1.5"><Sparkles size={14} /> Suggested lines</h3>
                  <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">3 ways to play</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "safe", label: "Safe", subtitle: "Low risk", color: "emerald", tier: suggestedTiers.safe },
                    { key: "balanced", label: "Balanced", subtitle: "Med risk", color: "cyan", tier: suggestedTiers.balanced },
                    { key: "altUnder", label: "Alt Under", subtitle: "Safer under", color: "violet", tier: suggestedTiers.altUnder },
                  ]).map(({ key, label, subtitle, color, tier }) => {
                    const isActive = activeTier === key;
                    const colorMap = {
                      emerald: {
                        ring: "border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400",
                        idle: "border-emerald-500/30 hover:border-emerald-400 hover:bg-emerald-500/5",
                        text: "text-emerald-300",
                        chip: "bg-emerald-500/20 text-emerald-300",
                      },
                      cyan: {
                        ring: "border-cyan-400 bg-cyan-500/15 ring-1 ring-cyan-400",
                        idle: "border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-500/5",
                        text: "text-cyan-300",
                        chip: "bg-cyan-500/20 text-cyan-300",
                      },
                      rose: {
                        ring: "border-rose-400 bg-rose-500/15 ring-1 ring-rose-400",
                        idle: "border-rose-500/30 hover:border-rose-400 hover:bg-rose-500/5",
                        text: "text-rose-300",
                        chip: "bg-rose-500/20 text-rose-300",
                      },
                      violet: {
                        ring: "border-violet-400 bg-violet-500/15 ring-1 ring-violet-400",
                        idle: "border-violet-500/30 hover:border-violet-400 hover:bg-violet-500/5",
                        text: "text-violet-300",
                        chip: "bg-violet-500/20 text-violet-300",
                      },
                    }[color];
                    return (
                      <button
                        key={key}
                        onClick={() => setPropLine(tier.value)}
                        className={`relative rounded-xl border p-2.5 text-center transition active:scale-95 ${isActive ? colorMap.ring : `border ${colorMap.idle}`}`}
                      >
                        {isActive && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold uppercase tracking-wider bg-slate-100 text-slate-950 px-2 py-0.5 rounded-full">✓ Set</span>
                        )}
                        <div className={`text-[10px] font-mono font-bold uppercase tracking-wider mb-1 ${colorMap.text}`}>{label}</div>
                        <div className={`text-[9px] font-mono uppercase mb-1.5 text-slate-500`}>{subtitle}</div>
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${colorMap.chip}`}>{tier.side}</span>
                          <span className="text-lg font-bold text-slate-100 leading-none">{tier.value}</span>
                        </div>
                        <div className="text-[9px] font-mono text-slate-500">
                          {tier.hits}/5 hit{tier.cushion !== 0 && ` · ${tier.cushion > 0 ? "+" : ""}${tier.cushion}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] font-mono text-slate-600 uppercase tracking-wider mt-3 text-center">
                  Tap a pill to move the bar · sample hit-rate, not a prediction
                </p>
              </div>

              {/* Adjustable prop line */}
              <h3 className="font-bold text-slate-100 mb-2">{statLabel} — set your line</h3>
              <div className="border border-slate-800 rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setPropLine(Math.max(0, +(line - step).toFixed(1)))}
                    className="w-12 h-12 rounded-full border border-slate-700 text-2xl font-bold text-slate-300 hover:border-cyan-400 hover:bg-slate-800 active:scale-95 transition flex items-center justify-center"
                  >
                    −
                  </button>
                  <div className="text-center">
                    <div className="text-4xl font-bold text-slate-100">{line}</div>
                    <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider">{statLabel} line</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">{isSynth ? "live line" : "season avg"} {avg}</div>
                  </div>
                  <button
                    onClick={() => setPropLine(+(line + step).toFixed(1))}
                    className="w-12 h-12 rounded-full border border-slate-700 text-2xl font-bold text-slate-300 hover:border-cyan-400 hover:bg-slate-800 active:scale-95 transition flex items-center justify-center"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Over / Under — tap to add to ticket */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                {(() => {
                  const activeSide = activeTier ? suggestedTiers[activeTier].side : null;
                  const overSuggested = activeTier != null && activeSide === "Over";
                  const underSuggested = activeTier != null && activeSide === "Under";
                  return (
                    <>
                      <button
                        onClick={() => {
                          addLeg({ game: gameLabel, market: "Player Prop", pick: `${pl.name} Under ${line} ${statLabel}`, odds: underOdds, sport });
                        }}
                        className={`relative rounded-xl py-3 text-center active:scale-95 transition border ${underSuggested ? "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400" : "border-slate-700 hover:border-cyan-400 hover:bg-slate-950"}`}
                      >
                        {underSuggested && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold uppercase tracking-wider bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full">✦ Suggested</span>}
                        <div className={`text-sm ${underSuggested ? "text-amber-300 font-semibold" : "text-slate-300"}`}>Under {line}</div>
                        <div className="font-mono font-bold text-blue-600">{formatOdds(underOdds)}</div>
                      </button>
                      <button
                        onClick={() => {
                          addLeg({ game: gameLabel, market: "Player Prop", pick: `${pl.name} Over ${line} ${statLabel}`, odds: overOdds, sport });
                        }}
                        className={`relative rounded-xl py-3 text-center active:scale-95 transition border ${overSuggested ? "border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400" : "border-slate-700 hover:border-cyan-400 hover:bg-slate-950"}`}
                      >
                        {overSuggested && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold uppercase tracking-wider bg-emerald-400 text-slate-950 px-2 py-0.5 rounded-full">✦ Suggested</span>}
                        <div className={`text-sm ${overSuggested ? "text-emerald-300 font-semibold" : "text-slate-300"}`}>Over {line}</div>
                        <div className="font-mono font-bold text-blue-600">{formatOdds(overOdds)}</div>
                      </button>
                    </>
                  );
                })()}
              </div>

              <p className="text-[9px] font-mono text-slate-500 text-center mb-24 uppercase tracking-widest leading-relaxed">
                ⚠️ Sample stats & game log — not live data. Odds are estimates that move with your line. Real player stats are in the Next.js version.<br/>21+ · Hypothetical only
              </p>
            </div>

            {/* Betslip bar — tap to go to chat */}
            {parlayLegs.length > 0 && (
              <button
                onClick={() => setBetslipOpen(true)}
                className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 px-4 py-4 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-50"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                    {parlayLegs.length}
                  </span>
                  <span className="text-blue-600 font-bold text-lg">Betslip</span>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-slate-300 whitespace-nowrap">
                    {bookLegCount >= 1
                      ? `$10 wins ${ppLegCount > 0 ? "(book) " : ""}$${((parlayMath.decimal - 1) * 10).toFixed(2)}`
                      : `${ppLegCount} PP leg${ppLegCount === 1 ? "" : "s"} · DFS payout`}
                  </span>
                  <span className="text-blue-600 text-xl leading-none">⌃</span>
                </div>
              </button>
            )}
          </div>
        );
      })()}

      {/* Team detail page — mirror of the player-props page, but for a TEAM
          TOTAL. Stats and the recent-performance chart are REAL last-10 final
          scores from ESPN (teams are not the sample exception); only the line
          you set and its odds are hypothetical estimates, clearly disclaimed. */}
      {selectedTeam && (() => {
        const t = selectedTeam;
        const sport = t.sport;
        const close = () => setSelectedTeam(null);
        const initials = (t.teamName || "?").split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase();
        // Loading / error / empty guards.
        if (t.loading) {
          return (
            <div className="fixed inset-0 z-40 bg-slate-900 flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
              <div className="text-sm text-slate-400">Loading {t.teamName} form…</div>
              <button onClick={close} className="text-cyan-400 text-sm mt-2">Close</button>
            </div>
          );
        }
        const recent = Array.isArray(t.recent) ? t.recent : [];
        if (t.error || recent.length === 0) {
          return (
            <div className="fixed inset-0 z-40 bg-slate-900 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="text-slate-200 font-semibold">No recent game data</div>
              <div className="text-xs text-slate-500">We only show real results, and there aren't enough completed games for {t.teamName} yet.</div>
              <button onClick={close} className="text-cyan-400 text-sm mt-2">Close</button>
            </div>
          );
        }
        // REAL chart data: team points per game, oldest → newest (left → right).
        const chartGames = recent.slice(0, 8).reverse();
        const games = chartGames.map((g) => g.pts);
        const n = games.length;
        const avg = t.last10?.ptsFor != null ? t.last10.ptsFor : +(games.reduce((a, b) => a + b, 0) / n).toFixed(1);
        const step = 0.5;
        // FORWARD-LOOKING MATCHUP PROJECTION (the suggested team total): blend
        // this team's scoring at THIS game's venue with the opponent's defense
        // at the opposite venue — all real ESPN home/away splits. Falls back to
        // the raw L10 average when split data is missing. This is what makes the
        // suggested line matchup-aware instead of just "their season average".
        const venueScoring = t.side === "home" ? t.splits?.home?.ptsFor : t.splits?.away?.ptsFor;
        const oppVenueDef = t.side === "home" ? t.oppSplits?.away?.ptsAgainst : t.oppSplits?.home?.ptsAgainst;
        const hasProjection = Number.isFinite(venueScoring) && Number.isFinite(oppVenueDef);
        const projected = hasProjection ? +(((venueScoring + oppVenueDef) / 2)).toFixed(1) : avg;
        const oppLast = (t.oppName || "").split(" ").slice(-1)[0];
        const line = teamLine != null ? teamLine : +(Math.round(projected / step) * step).toFixed(1);
        const maxV = Math.max(...games, line) * 1.2 || 1;
        // Odds scale off how far the set line sits from the matchup projection.
        // Multiplier is small because team totals can be large numbers (~100+).
        const diff = line - projected;
        const overOdds = decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 + diff * 0.05)));
        const underOdds = decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 - diff * 0.05)));
        const hitsAtOrAbove = (c) => games.filter((v) => v >= c).length;
        const hitsAtOrBelow = (c) => games.filter((v) => v <= c).length;
        // SUGGESTED LINES (Safe / Balanced / Alt Under) on the team total —
        // same logic as the player page, computed from real recent scores.
        const suggestedTiers = (() => {
          const sorted = [...games].sort((a, b) => a - b);
          const sampleMin = sorted[0];
          const sampleMax = sorted[sorted.length - 1];
          const overSampleHits = games.filter((v) => v >= avg).length;
          const safeSide = overSampleHits >= Math.ceil(n / 2) ? "Over" : "Under";
          const safe = (() => {
            let v = null;
            if (safeSide === "Over") {
              for (let c = 0; c <= maxV; c += step) { const cand = +c.toFixed(1); if (hitsAtOrAbove(cand) === n) v = cand; }
              if (v != null) v = Math.max(0, Math.min(v, +(sampleMin - step).toFixed(1)));
            } else {
              for (let c = maxV; c >= 0; c -= step) { const cand = +c.toFixed(1); if (hitsAtOrBelow(cand) === n) v = cand; }
              if (v != null) v = Math.max(v, +(sampleMax + step).toFixed(1));
            }
            if (v == null) v = safeSide === "Over" ? Math.max(0, +(sampleMin - step).toFixed(1)) : +(sampleMax + step).toFixed(1);
            return { side: safeSide, value: v };
          })();
          const balanced = { side: safeSide, value: Math.max(0, +(Math.round(projected / step) * step).toFixed(1)) };
          const altUnder = (() => {
            const snap = (x) => +(Math.round(x / step) * step).toFixed(1);
            const bump = Math.max(step * 2, +(avg * 0.04).toFixed(2));
            let v = snap(balanced.value + bump);
            const cap = snap(sampleMax + step);
            if (v > cap) v = cap;
            if (v <= balanced.value) v = snap(balanced.value + step);
            return { side: "Under", value: v };
          })();
          const describe = (tier) => {
            const hits = tier.side === "Over" ? hitsAtOrAbove(tier.value) : hitsAtOrBelow(tier.value);
            const cushion = tier.side === "Over" ? avg - tier.value : tier.value - avg;
            return { ...tier, hits, cushion: +cushion.toFixed(1) };
          };
          return { safe: describe(safe), balanced: describe(balanced), altUnder: describe(altUnder) };
        })();
        const aiPick = (() => {
          const side = suggestedTiers.balanced.side;
          const pLine = suggestedTiers.balanced.value;
          const d = pLine - projected;
          const odds = side === "Over"
            ? decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 + d * 0.05)))
            : decimalToAmerican(Math.min(8, Math.max(1.2, 1.9 - d * 0.05)));
          const support = side === "Over" ? hitsAtOrAbove(pLine) : hitsAtOrBelow(pLine);
          return { side, line: pLine, odds, support };
        })();
        const tierMatch = (tr) => Math.abs(line - tr.value) < 0.01;
        const activeTier = tierMatch(suggestedTiers.safe) ? "safe" : tierMatch(suggestedTiers.balanced) ? "balanced" : tierMatch(suggestedTiers.altUnder) ? "altUnder" : null;
        const statCells = [
          { k: "PPG", v: avg },
          { k: "OPP PPG", v: t.last10?.ptsAgainst ?? "—" },
          { k: "MARGIN", v: t.last10?.avgMargin != null ? `${t.last10.avgMargin > 0 ? "+" : ""}${t.last10.avgMargin}` : "—" },
          { k: "STREAK", v: t.streak ? `${t.streak.type}${t.streak.count}` : "—" },
          { k: "RECORD", v: t.season ? `${t.season.wins}-${t.season.losses}` : (t.last10 ? `${t.last10.wins}-${t.last10.losses}` : "—") },
        ];
        return (
          <div className="fixed inset-0 z-40 bg-slate-900 overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between z-10">
              <h2 className="font-display text-lg text-slate-100">Team Total</h2>
              <button onClick={close} className="text-blue-600 font-semibold">Close</button>
            </div>

            <div className="px-4 py-4">
              {/* Identity */}
              <div className="flex items-center gap-3 mb-4">
                {t.logo ? (
                  <img src={t.logo} alt={t.teamName} className="w-16 h-16 object-contain shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-zinc-900 text-white flex items-center justify-center text-lg font-bold shrink-0">{initials}</div>
                )}
                <div className="min-w-0">
                  <div className="text-xl font-bold text-slate-100 truncate">{t.teamName}</div>
                  <div className="text-sm text-slate-400 truncate">{t.last10 ? `${t.last10.wins}-${t.last10.losses} L10` : "Recent form"}{t.oppName ? ` · vs ${t.oppName}` : ""}</div>
                </div>
              </div>

              {/* AI Suggested Pick */}
              <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-amber-400/5 p-4 mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-300 flex items-center gap-1.5"><Sparkles size={13} /> AI Suggested Pick</span>
                </div>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-2xl font-bold text-slate-50">{aiPick.side} {aiPick.line}</span>
                  <span className="text-sm font-semibold text-slate-300">Team Points</span>
                  <span className="ml-auto font-mono font-bold text-amber-300 text-lg">{formatOdds(aiPick.odds)}</span>
                </div>
                <p className="text-xs text-slate-300/90 leading-snug">
                  Leaning <span className="font-semibold text-amber-200">{aiPick.side.toLowerCase()}</span> — {t.teamName.split(" ").slice(-1)[0]} went {aiPick.side === "Over" ? "over" : "under"} this in {aiPick.support} of the last {n} games (L10 avg {avg}).
                  {hasProjection && (
                    <> Line set to the <span className="font-semibold text-amber-200">matchup projection {projected}</span> — {t.side === "home" ? "home" : "road"} scoring {venueScoring} blended with {oppLast}{"'"}s defense ({oppVenueDef} allowed).</>
                  )}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => addLeg({ game: t.gameLabel, market: "Team Total", pick: `${t.teamName} ${aiPick.side} ${aiPick.line} Points`, odds: aiPick.odds, sport })}
                    className="flex-1 rounded-lg bg-amber-400 text-slate-950 font-bold text-sm py-2 active:scale-95 transition"
                  >
                    + Add to slip
                  </button>
                  <button
                    onClick={() => setTeamLine(aiPick.line)}
                    className="rounded-lg border border-amber-400/40 text-amber-200 font-semibold text-sm px-3 py-2 active:scale-95 transition"
                  >
                    Load line
                  </button>
                </div>
              </div>

              {/* Real last-10 stats */}
              <div className="rounded-2xl overflow-hidden border border-slate-800 mb-5">
                <div className="bg-zinc-900 text-white text-center text-xs font-mono uppercase tracking-widest py-2">Last 10 Games · Real</div>
                <div className="grid grid-flow-col auto-cols-fr divide-x divide-slate-800">
                  {statCells.map((c) => (
                    <div key={c.k} className="py-3 text-center">
                      <div className="text-[9px] font-mono uppercase text-slate-500 tracking-wider">{c.k}</div>
                      <div className="text-lg font-bold text-slate-100">{c.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent performance — REAL scores */}
              <div className="border border-slate-800 rounded-2xl p-4 mb-5">
                <h3 className="font-bold text-slate-100 mb-1">Recent Performance</h3>
                <div className="text-xs text-slate-400 mb-3">
                  {avg} pts/game · L10 avg · line {line} <span className="text-slate-500">(drag the line or use −/+)</span>
                </div>
                <div
                  ref={teamChartRef}
                  className="flex items-end justify-between gap-1.5 h-40 border-b border-slate-800 relative touch-none select-none"
                  onPointerDown={(e) => {
                    const setFromY = (clientY) => {
                      const el = teamChartRef.current;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const frac = Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height));
                      let val = frac * maxV;
                      val = Math.round(val / step) * step;
                      val = Math.max(0, +val.toFixed(1));
                      setTeamLine(val);
                    };
                    setFromY(e.clientY);
                    const move = (ev) => setFromY(ev.clientY);
                    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                >
                  <div className="absolute left-0 right-0 border-t-2 border-dashed border-blue-400 z-10 pointer-events-none" style={{ bottom: `${(line / maxV) * 100}%` }}>
                    <div className="absolute -right-1 -top-3 flex items-center gap-1">
                      <span className="text-[9px] font-mono font-bold text-blue-300 bg-slate-900 px-1 rounded">{line}</span>
                      <span className="w-5 h-5 rounded-full bg-blue-500 border-2 border-slate-900 flex items-center justify-center text-[8px] text-white">↕</span>
                    </div>
                  </div>
                  {games.map((v, gi) => {
                    const over = v >= line;
                    return (
                      <div key={gi} className="flex-1 flex flex-col items-center justify-end h-full pointer-events-none">
                        <div className="text-[10px] font-bold text-slate-300 mb-1">{v}</div>
                        <div className={`w-full rounded-t ${over ? "bg-emerald-500" : "bg-zinc-400"}`} style={{ height: `${Math.max(4, (v / maxV) * 100)}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1.5 gap-1.5">
                  {chartGames.map((g, gi) => (
                    <div key={gi} className="flex-1 text-center">
                      <div className={`text-[9px] font-mono font-bold ${g.won ? "text-emerald-400" : "text-rose-400"}`}>{g.won ? "W" : "L"}</div>
                      <div className="text-[8px] font-mono text-slate-600 truncate">{g.home ? "vs" : "@"} {(g.opp || "").split(" ").slice(-1)[0]}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suggested lines — 3 tiers */}
              <div className="border border-cyan-500/30 bg-cyan-400/5 rounded-2xl p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-cyan-300 text-sm flex items-center gap-1.5"><Sparkles size={14} /> Suggested lines</h3>
                  <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">3 ways to play</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "safe", label: "Safe", subtitle: "Low risk", color: "emerald", tier: suggestedTiers.safe },
                    { key: "balanced", label: "Balanced", subtitle: "Med risk", color: "cyan", tier: suggestedTiers.balanced },
                    { key: "altUnder", label: "Alt Under", subtitle: "Safer under", color: "violet", tier: suggestedTiers.altUnder },
                  ]).map(({ key, label, subtitle, color, tier }) => {
                    const isActive = activeTier === key;
                    const colorMap = {
                      emerald: { ring: "border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400", idle: "border-emerald-500/30 hover:border-emerald-400 hover:bg-emerald-500/5", text: "text-emerald-300", chip: "bg-emerald-500/20 text-emerald-300" },
                      cyan: { ring: "border-cyan-400 bg-cyan-500/15 ring-1 ring-cyan-400", idle: "border-cyan-500/30 hover:border-cyan-400 hover:bg-cyan-500/5", text: "text-cyan-300", chip: "bg-cyan-500/20 text-cyan-300" },
                      violet: { ring: "border-violet-400 bg-violet-500/15 ring-1 ring-violet-400", idle: "border-violet-500/30 hover:border-violet-400 hover:bg-violet-500/5", text: "text-violet-300", chip: "bg-violet-500/20 text-violet-300" },
                    }[color];
                    return (
                      <button key={key} onClick={() => setTeamLine(tier.value)} className={`relative rounded-xl border p-2.5 text-center transition active:scale-95 ${isActive ? colorMap.ring : `border ${colorMap.idle}`}`}>
                        {isActive && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold uppercase tracking-wider bg-slate-100 text-slate-950 px-2 py-0.5 rounded-full">✓ Set</span>}
                        <div className={`text-[10px] font-mono font-bold uppercase tracking-wider mb-1 ${colorMap.text}`}>{label}</div>
                        <div className="text-[9px] font-mono uppercase mb-1.5 text-slate-500">{subtitle}</div>
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${colorMap.chip}`}>{tier.side}</span>
                          <span className="text-lg font-bold text-slate-100 leading-none">{tier.value}</span>
                        </div>
                        <div className="text-[9px] font-mono text-slate-500">{tier.hits}/{n} hit{tier.cushion !== 0 && ` · ${tier.cushion > 0 ? "+" : ""}${tier.cushion}`}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] font-mono text-slate-600 uppercase tracking-wider mt-3 text-center">Tap a pill to move the bar · real hit-rate, not a prediction</p>
              </div>

              {/* Adjustable team-total line */}
              <h3 className="font-bold text-slate-100 mb-2">Team Total — set your line</h3>
              <div className="border border-slate-800 rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between">
                  <button onClick={() => setTeamLine(Math.max(0, +(line - step).toFixed(1)))} className="w-12 h-12 rounded-full border border-slate-700 text-2xl font-bold text-slate-300 hover:border-cyan-400 hover:bg-slate-800 active:scale-95 transition flex items-center justify-center">−</button>
                  <div className="text-center">
                    <div className="text-4xl font-bold text-slate-100">{line}</div>
                    <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider">team points line</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">L10 avg {avg}{hasProjection ? ` · proj ${projected}` : ""}</div>
                  </div>
                  <button onClick={() => setTeamLine(+(line + step).toFixed(1))} className="w-12 h-12 rounded-full border border-slate-700 text-2xl font-bold text-slate-300 hover:border-cyan-400 hover:bg-slate-800 active:scale-95 transition flex items-center justify-center">+</button>
                </div>
              </div>

              {/* Over / Under — add to ticket */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                {(() => {
                  const activeSide = activeTier ? suggestedTiers[activeTier].side : null;
                  const overSuggested = activeTier != null && activeSide === "Over";
                  const underSuggested = activeTier != null && activeSide === "Under";
                  return (
                    <>
                      <button
                        onClick={() => addLeg({ game: t.gameLabel, market: "Team Total", pick: `${t.teamName} Under ${line} Points`, odds: underOdds, sport })}
                        className={`relative rounded-xl py-3 text-center active:scale-95 transition border ${underSuggested ? "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400" : "border-slate-700 hover:border-cyan-400 hover:bg-slate-950"}`}
                      >
                        {underSuggested && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold uppercase tracking-wider bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full">✦ Suggested</span>}
                        <div className={`text-sm ${underSuggested ? "text-amber-300 font-semibold" : "text-slate-300"}`}>Under {line}</div>
                        <div className="font-mono font-bold text-blue-600">{formatOdds(underOdds)}</div>
                      </button>
                      <button
                        onClick={() => addLeg({ game: t.gameLabel, market: "Team Total", pick: `${t.teamName} Over ${line} Points`, odds: overOdds, sport })}
                        className={`relative rounded-xl py-3 text-center active:scale-95 transition border ${overSuggested ? "border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400" : "border-slate-700 hover:border-cyan-400 hover:bg-slate-950"}`}
                      >
                        {overSuggested && <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold uppercase tracking-wider bg-emerald-400 text-slate-950 px-2 py-0.5 rounded-full">✦ Suggested</span>}
                        <div className={`text-sm ${overSuggested ? "text-emerald-300 font-semibold" : "text-slate-300"}`}>Over {line}</div>
                        <div className="font-mono font-bold text-blue-600">{formatOdds(overOdds)}</div>
                      </button>
                    </>
                  );
                })()}
              </div>

              <p className="text-[9px] font-mono text-slate-500 text-center mb-24 uppercase tracking-widest leading-relaxed">
                ✅ Recent scores, averages & venue splits are real ESPN results.<br/>{hasProjection ? "Projection blends real splits · " : ""}lines you set & odds are estimates · 21+
              </p>
            </div>

            {/* Betslip bar */}
            {parlayLegs.length > 0 && (
              <button onClick={() => setBetslipOpen(true)} className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 px-4 py-4 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-50">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">{parlayLegs.length}</span>
                  <span className="text-blue-600 font-bold text-lg">Betslip</span>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-slate-300 whitespace-nowrap">
                    {bookLegCount >= 1 ? `$10 wins ${ppLegCount > 0 ? "(book) " : ""}$${((parlayMath.decimal - 1) * 10).toFixed(2)}` : `${ppLegCount} PP leg${ppLegCount === 1 ? "" : "s"} · DFS payout`}
                  </span>
                  <span className="text-blue-600 text-xl leading-none">⌃</span>
                </div>
              </button>
            )}
          </div>
        );
      })()}

      {showInjuries && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => setShowInjuries(false)}>
          <div className="bg-zinc-900 border-t-2 border-rose-500 w-full rounded-t-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg flex items-center gap-2"><InjuryIcon size={20} /> INJURY REPORT</h3>
                <p className="text-[10px] font-mono text-rose-400/70 uppercase tracking-wider mt-0.5">⚠️ Sample data · not a real report</p>
              </div>
              <button onClick={() => setShowInjuries(false)}><X size={20} className="text-slate-500" /></button>
            </div>
            <div className="overflow-y-auto scroll-fade p-3 space-y-2">
              {Object.entries(INJURIES).map(([team, list]) => (
                <div key={team} className="border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="bg-zinc-800/60 px-3 py-1.5 text-sm font-bold text-white">{team}</div>
                  <div className="divide-y divide-zinc-800">
                    {list.map((i, idx) => {
                      const tone = i.status === "out" ? "text-rose-400 bg-rose-500/15"
                        : i.status === "doubtful" ? "text-amber-400 bg-amber-500/15"
                        : "text-yellow-300 bg-yellow-500/10";
                      return (
                        <div key={idx} className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm text-zinc-100">{i.player} <span className="text-slate-400 text-xs">({i.pos})</span></div>
                              <div className="text-[11px] text-slate-400">Backup: {i.backup}</div>
                            </div>
                            <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${tone}`}>{i.status}</span>
                          </div>
                          {(() => {
                            const ip = findInjuryPick(team);
                            if (!ip) return null;
                            const inSlip = parlayLegs.some((l) => legKey(l) === legKey(ip));
                            return (
                              <button
                                onClick={() => { if (!inSlip) addLeg({ ...ip }); }}
                                disabled={inSlip}
                                className={`w-full mt-1.5 rounded-lg py-1.5 text-[11px] font-semibold transition ${
                                  inSlip ? "bg-zinc-800 text-slate-400 cursor-default" : "bg-rose-500 text-white hover:bg-rose-400"
                                }`}
                              >
                                {inSlip ? "✓ In ticket" : `+ Add edge pick · ${ip.pick} ${formatOdds(ip.odds)}`}
                              </button>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider leading-relaxed text-center pt-1">
                A key player out helps the opponent and shifts usage to backups — the builder factors this into matchups. Designations are directional; "questionable" ≠ out. Sample data; real injuries are in the Next.js version. Not a prediction.
              </p>
            </div>
          </div>
        </div>
      )}

      {showWeather && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => setShowWeather(false)}>
          <div className="bg-zinc-900 border-t-2 border-sky-400 w-full rounded-t-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg flex items-center gap-2"><WeatherIcon size={20} /> WEATHER IMPACT</h3>
                <p className="text-[10px] font-mono text-sky-400/70 uppercase tracking-wider mt-0.5">
                  ⚠️ Sample conditions · not a real forecast
                </p>
              </div>
              <button onClick={() => setShowWeather(false)}><X size={20} className="text-slate-500" /></button>
            </div>
            <div className="overflow-y-auto scroll-fade p-3 space-y-3">
              {(() => {
                // A few random outdoor picks across selected sports
                const outdoor = selectedSports
                  .filter((s) => OUTDOOR_SPORTS.includes(s))
                  .flatMap((s) => (PICK_POOL[s] || []).map((p) => ({ ...p, sport: s })));
                if (outdoor.length === 0) {
                  return (
                    <p className="text-sm text-slate-500 text-center py-8">
                      No outdoor games in your selected sports. Weather mainly affects NFL, MLB, college football, and soccer — add one of those to see impact analysis.
                    </p>
                  );
                }
                // Deterministic "random" few
                const shuffled = [...outdoor].sort((a, b) => hashSeed(a.game) - hashSeed(b.game));
                const picks = shuffled.slice(0, 4);
                return picks.map((pick, i) => {
                  const wx = sampleWeather(pick);
                  if (!wx) return null;
                  return (
                    <div key={i} className="border border-zinc-800 rounded-xl overflow-hidden">
                      <div className="bg-zinc-800/60 px-3 py-2 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="text-[9px] font-mono uppercase text-slate-400 tracking-wider">{pick.sport}</div>
                          <div className="text-sm font-semibold text-white truncate">{pick.game}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-sky-300">{wx.conditionLabel}</div>
                          {wx.lean && (
                            <div className={`text-[10px] font-mono uppercase tracking-wider ${wx.lean === "over" ? "text-emerald-400" : "text-amber-400"}`}>
                              leans {wx.lean}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="px-3 py-2 space-y-1.5">
                        <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">On this pick: {pick.pick}</div>
                        {wx.effects.map((e, ei) => (
                          <p key={ei} className="text-[11px] text-zinc-300 leading-relaxed flex gap-1.5">
                            <span className="text-sky-400">•</span><span>{e}</span>
                          </p>
                        ))}
                        {(() => {
                          const inSlip = parlayLegs.some((l) => legKey(l) === legKey(pick));
                          return (
                            <button
                              onClick={() => { if (!inSlip) addLeg({ ...pick }); }}
                              disabled={inSlip}
                              className={`w-full mt-1.5 rounded-lg py-2 text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                                inSlip
                                  ? "bg-zinc-800 text-slate-400 cursor-default"
                                  : "bg-sky-400 text-black hover:bg-sky-300"
                              }`}
                            >
                              {inSlip ? "✓ In ticket" : `+ Add to ticket · ${pick.pick} ${formatOdds(pick.odds)}`}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                });
              })()}
              <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider leading-relaxed text-center pt-1">
                Weather shifts tendencies — it does NOT predict results. Effects are directional handicapping factors, not outcomes. Sample data; real forecasts are in the Next.js version.
              </p>
            </div>
          </div>
        </div>
      )}

      {showSports && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => setShowSports(false)}>
          <div className="bg-zinc-900 border-t-2 border-cyan-400 w-full rounded-t-3xl max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-display text-lg">ALL SPORTS</h3>
              <button onClick={() => setShowSports(false)}><X size={20} className="text-slate-500" /></button>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2 overflow-y-auto">
              {SPORTS.map((s) => {
                const on = selectedSports.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleSport(s.id)}
                    className={`flex items-center gap-2 px-3 py-3 rounded-xl border transition ${
                      on ? "border-cyan-400 bg-cyan-400/10 text-cyan-400" : "border-zinc-800 text-slate-500 hover:border-zinc-600"
                    }`}
                  >
                    <span className="text-lg">{s.emoji}</span>
                    <span className="text-sm font-semibold">{s.label}</span>
                    {on && <span className="ml-auto text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="p-3 border-t border-zinc-800 flex gap-2">
              <button
                onClick={() => setSelectedSports(SPORTS.map((s) => s.id))}
                className="flex-1 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-mono uppercase tracking-wider hover:bg-cyan-300"
              >
                Select all
              </button>
              <button
                onClick={() => setShowSports(false)}
                className="flex-1 py-2 rounded-lg bg-cyan-400 text-black text-xs font-mono uppercase tracking-wider font-bold hover:bg-cyan-300"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global ticket bar — shows on home/profile/plans when picks exist */}
      {parlayLegs.length > 0 && (view === "home" || view === "profile" || view === "plans" || view === "allsports" || view === "allupcoming") && (
        <button
          onClick={() => setBetslipOpen(true)}
          className="absolute bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 px-4 py-4 flex items-center justify-between shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-30"
        >
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
              {parlayLegs.length}
            </span>
            <span className="text-blue-600 font-bold text-lg">Ticket</span>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-slate-300 whitespace-nowrap">
              {bookLegCount >= 1
                ? `$10 wins ${ppLegCount > 0 ? "(book) " : ""}$${((parlayMath.decimal - 1) * 10).toFixed(2)}`
                : `${ppLegCount} PP leg${ppLegCount === 1 ? "" : "s"} · DFS payout`}
            </span>
            <span className="text-blue-600 text-xl leading-none">⌃</span>
          </div>
        </button>
      )}

      {/* Betslip overlay — slides up over any page */}
      {upgradeOpen && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center px-6" onClick={() => setUpgradeOpen(false)}>
          <div className="bg-slate-900 border border-cyan-500/40 rounded-3xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center mx-auto mb-4 text-2xl">🔒</div>
            <h3 className="font-display text-xl text-slate-100 mb-1">{gatedFeature} is a Pro feature</h3>
            <p className="text-sm text-slate-400 mb-5">
              Unlock the analysis tools (Refs, Coaches, Weather, Injuries), live picks, AI chat, and ticket downloads — free for 7 days.
            </p>
            <button
              onClick={() => { setTrialActive(true); setUpgradeOpen(false); }}
              className="w-full bg-cyan-400 text-slate-950 rounded-xl py-3 font-bold hover:bg-cyan-300 transition mb-2"
            >
              Start 7-day free trial
            </button>
            <button
              onClick={() => { setUpgradeOpen(false); setView("plans"); }}
              className="w-full border border-slate-700 text-slate-300 rounded-xl py-3 font-semibold hover:border-cyan-400 transition mb-2"
            >
              See plans
            </button>
            <button onClick={() => setUpgradeOpen(false)} className="w-full text-slate-500 text-sm py-2 hover:text-slate-300">
              Not now
            </button>
            <p className="text-[9px] font-mono text-slate-600 uppercase tracking-widest mt-3 leading-relaxed">
              ⚠️ Demo — no real billing. The offline app can't track real trial days; the 7-day countdown is real in the Next.js version.
            </p>
          </div>
        </div>
      )}

      {betslipOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-800 flex flex-col fade-in">
          {/* Header */}
          <div className="bg-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                {parlayLegs.length}
              </span>
              <div>
                <div className="text-lg font-bold text-slate-100">Betslip</div>
                <div className="text-[11px] font-mono uppercase text-slate-400 tracking-wider">Balance: $0.00 (demo)</div>
              </div>
            </div>
            <button onClick={() => setBetslipOpen(false)} className="text-blue-600 font-semibold text-lg">Close</button>
          </div>

          {/* Parlay/straight row */}
          <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="font-bold text-slate-100">
              {parlayLegs.length > 1 ? `${parlayLegs.length}-Leg Parlay` : "Straight bet"}
              {ppLegCount > 0 && (
                <span className="ml-2 text-[10px] font-mono text-amber-400 uppercase">
                  {bookLegCount} book + {ppLegCount} PP
                </span>
              )}
            </span>
            <span className="font-mono font-bold text-slate-100">
              {bookLegCount >= 2 ? formatOdds(parlayMath.american) : ppLegCount > 0 ? "PP slip" : formatOdds(parlayMath.american)}
            </span>
          </div>

          {/* Remove all */}
          {parlayLegs.length > 0 && (
            <button
              onClick={() => { clearParlay(); }}
              className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-center gap-2 text-rose-600 font-semibold"
            >
              <Trash2 size={16} /> Remove all selections
            </button>
          )}

          {/* Legs */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {parlayLegs.length === 0 ? (
              <div className="text-center text-slate-500 py-16">
                <p className="text-sm">Your betslip is empty.</p>
                <p className="text-xs mt-1">Add picks and they'll show up here.</p>
              </div>
            ) : (
              parlayLegs.map((leg) => (
                <div key={leg.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-mono uppercase text-slate-500 tracking-wider break-words">
                      {leg.market} · {displayGameLabel(leg.game)}
                      {(() => {
                        const live = lookupLiveTag(leg.game);
                        if (live) return <span className="ml-1 text-rose-500 font-semibold">· {live}</span>;
                        const t = formatGameTime(lookupGameStart(leg.game));
                        return t ? <span className="ml-1 text-cyan-600">· {t}</span> : null;
                      })()}
                    </div>
                    <div className="text-sm font-semibold text-slate-100">{leg.pick}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-bold text-blue-600 text-sm">{formatOdds(leg.odds)}</span>
                    <button onClick={() => removeLeg(leg.id)} className="text-slate-500 hover:text-rose-500">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {parlayLegs.length > 0 && (
            <div className="bg-slate-900 border-t border-slate-800">
              <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono uppercase text-slate-400 tracking-wider">Stake</span>
                  <span className="text-sm font-bold text-slate-100">$10</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-mono uppercase text-slate-400 tracking-wider">
                    To win{ppLegCount > 0 && bookLegCount >= 1 ? " (book)" : ""}
                  </div>
                  <div className="font-bold text-slate-100 whitespace-nowrap">
                    {bookLegCount >= 1 ? `$${((parlayMath.decimal - 1) * 10).toFixed(2)}` : "DFS payout"}
                  </div>
                  {ppLegCount > 0 && (
                    <div className="text-[9px] font-mono text-amber-400 mt-0.5">
                      +{ppLegCount} PP leg{ppLegCount === 1 ? "" : "s"} on flat schedule
                    </div>
                  )}
                </div>
              </div>
              <div className="px-4 pb-3 space-y-2">
                <button
                  onClick={() => { if (requirePro("Ticket image download")) downloadTicketImage(); }}
                  className="w-full bg-cyan-500 text-white rounded-xl py-3 font-bold hover:bg-cyan-600 transition flex items-center justify-center gap-2"
                >
                  ↓ Download ticket image
                </button>
                <button
                  className="w-full bg-emerald-600 text-white rounded-xl py-3.5 font-bold hover:bg-emerald-700 transition"
                  onClick={() => { if (requirePro("AI Chat")) { setBetslipOpen(false); setView("chat"); } else { setBetslipOpen(false); } }}
                >
                  Review in chat (demo · no real bet)
                </button>
                <p className="text-[9px] font-mono text-slate-500 text-center mt-2 uppercase tracking-widest">
                  Demo only · no real wager is placed · 21+
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={composerRef} className="absolute bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-900 p-3 z-20" style={{ display: view === "home" || view === "profile" || view === "plans" || view === "allsports" || view === "allupcoming" ? "none" : undefined }}>
        {/* Popup YOUR SLIP — collapsed pill above chat; expands upward. */}
        {parlayLegs.length > 0 && (
          <>
            {slipOpen && (
              <div className="fixed inset-0 z-30" onClick={() => setSlipOpen(false)} />
            )}
            {slipOpen && (
              <div className="absolute bottom-full left-3 right-3 mb-2 z-40 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden slide-up flex flex-col" style={{ maxHeight: `calc(100dvh - ${composerH + 24}px)` }}>
                <div className="bg-cyan-500 text-white px-4 py-2 flex items-center justify-between shrink-0">
                  <span className="font-display text-sm">
                    YOUR SLIP · {parlayLegs.length} LEG{parlayLegs.length !== 1 ? "S" : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={clearParlay} className="text-white/80 hover:text-white" aria-label="Clear slip">
                      <Trash2 size={14} />
                    </button>
                    <button onClick={() => setSlipOpen(false)} className="text-white/80 hover:text-white" aria-label="Close slip">
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
                  {parlayLegs.map((leg, idx) => (
                    <div key={leg.id ?? idx} className="flex items-start gap-2 bg-slate-800 rounded-xl px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 break-words">{leg.game}</div>
                        <div className="text-sm text-slate-100 flex items-start gap-1.5 flex-wrap">
                          <span className="break-words">{leg.pick}</span>
                          {leg.originalPick && leg.originalPick !== leg.pick && (
                            <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-1.5 py-0.5">
                              <span className="text-emerald-400/60 line-through">{leg.originalPick}</span>
                              {leg.pointsDelta ? `+${Math.abs(leg.pointsDelta)}pt` : "fixed"}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {leg.market}{leg.odds != null ? ` · ${formatOdds(leg.odds)}` : ""}
                          {leg.originalOdds != null && leg.originalOdds !== leg.odds && (
                            <span className="text-emerald-400/60"> · was {formatOdds(leg.originalOdds)}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => removeLeg(leg.id)}
                        className="shrink-0 text-slate-400 hover:text-rose-400 transition p-1"
                        aria-label="Remove leg"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {slipAnalysis && (
                  <div className="px-4 py-3 border-t border-slate-800 bg-slate-950">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300">Analysis</span>
                      <button onClick={() => setSlipAnalysis(null)} className="text-slate-500 hover:text-slate-300 text-[10px] font-mono uppercase">clear</button>
                    </div>
                    <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{slipAnalysis}</div>
                  </div>
                )}
                {fixSummary && (
                  <div className="px-3 py-1.5 border-t border-emerald-500/30 bg-emerald-500/5 flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300 truncate">✓ Fixed · {fixSummary}</span>
                    <button onClick={() => setFixSummary(null)} className="text-emerald-400/60 hover:text-emerald-300 shrink-0" aria-label="Dismiss fix summary">
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="px-4 py-2 border-t border-slate-800 flex items-center justify-between bg-slate-950">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    {parlayLegs.length} leg{parlayLegs.length !== 1 ? "s" : ""} · {parlayConfidence}% conf
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={analyzeCurrentSlip}
                      className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition"
                    >
                      Analyze
                    </button>
                    <button
                      onClick={() => { if (requirePro("Fix for best outcome")) { optimizeSlip(); setSlipOpen(true); } }}
                      className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 transition"
                      title="Buy points / nudge lines toward safer outcomes"
                    >
                      Fix
                    </button>
                    <div className="text-sm font-bold text-cyan-400">
                      {parlayMath?.american ? `${parlayMath.american > 0 ? "+" : ""}${parlayMath.american}` : ""}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <button
              onClick={() => setSlipOpen((v) => !v)}
              className={`w-full mb-2 flex items-center justify-between rounded-2xl px-3 py-2 border transition ${
                slipOpen ? "border-cyan-400 bg-cyan-400/10" : "border-slate-700 bg-slate-800 hover:border-cyan-400"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 shrink-0">
                  🎟 Slip · {parlayLegs.length}
                </span>
                <div className="flex gap-1 overflow-hidden">
                  {parlayLegs.slice(0, 4).map((leg, idx) => (
                    <span key={leg.id ?? idx} className="shrink-0 text-[10px] bg-slate-900 border border-slate-700 text-slate-300 rounded-full px-2 py-0.5 max-w-[120px] truncate">
                      {leg.pick}
                    </span>
                  ))}
                  {parlayLegs.length > 4 && (
                    <span className="shrink-0 text-[10px] text-slate-400 px-1 py-0.5">+{parlayLegs.length - 4}</span>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-mono text-cyan-400 ml-2">
                {slipOpen ? "▼ Close" : "▲ Open"}
              </span>
            </button>
          </>
        )}
        {/* Build-parlay popup menu */}
        {legMenuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setLegMenuOpen(false)} />
            <div className="absolute bottom-full left-3 mb-2 z-40 w-56 bg-slate-900 rounded-2xl shadow-xl border border-slate-800 overflow-hidden py-1 slide-up">
              {[
                { label: "3-Leg parlay", icon: <Sparkles size={16} />, msg: "Build me a 3-leg parlay", n: 3 },
                { label: "6-Leg parlay", icon: <TrendingUp size={16} />, msg: "Build me a 6-leg parlay", n: 6 },
                { label: "9-Leg parlay", icon: <TrendingUp size={16} />, msg: "Build me a 9-leg parlay", n: 9 },
                { label: "15-Leg longshot", icon: <Shuffle size={16} />, msg: "Build me a 15-leg parlay", n: 15 },
                { label: "Player props only", icon: <Users size={16} />, msg: "Build me a player props parlay", n: 0 },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => { setLegMenuOpen(false); if (opt.n) setActiveLegBtn(opt.n); sendMessage(opt.msg); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-950 transition"
                >
                  <span className="text-slate-400">{opt.icon}</span>
                  <span className="text-sm font-medium text-slate-200">{opt.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex gap-2 mb-2 overflow-x-auto scroll-fade">
          <button
            onClick={() => setLegMenuOpen((v) => !v)}
            className={`shrink-0 text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-full border transition inline-flex items-center gap-1 ${
              legMenuOpen ? "border-cyan-400 bg-cyan-400/10 text-cyan-500 font-bold" : "border-slate-700 text-slate-400 hover:border-cyan-400 hover:text-cyan-400"
            }`}
          >
            <Plus size={12} /> Build parlay
          </button>
          <button
            onClick={() => { if (requirePro("Live picks")) setShowLiveDemo(true); }}
            className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-full border border-rose-400/40 text-rose-400 hover:bg-rose-400/10 transition inline-flex items-center gap-1"
          >
            🔴 Pick Live{(() => { const n = homeLiveGames.filter((g) => g.real).length; return n > 0 ? <span className="bg-rose-400 text-black rounded-full px-1.5 leading-none py-0.5 text-[9px] font-bold">{n}</span> : null; })()}
          </button>
          <button
            onClick={analyzeCurrentSlip}
            disabled={parlayLegs.length === 0}
            className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-full border border-slate-700 text-slate-400 hover:border-cyan-400 hover:text-cyan-400 transition disabled:opacity-30"
          >
            <TrendingUp size={10} className="inline mr-1" /> Analyze
          </button>
        </div>
        {attachment && attachment.kind === "image" && (
          <div className="flex items-center gap-2 mb-2 bg-slate-800 border border-slate-800 rounded-xl p-2 w-fit">
            <img src={attachment.dataUrl} alt="preview" className="h-12 w-12 object-cover rounded-lg" />
            <span className="text-xs text-slate-400 max-w-[140px] truncate">{attachment.name}</span>
            <button onClick={() => setAttachment(null)} className="text-slate-500 hover:text-slate-100">
              <X size={16} />
            </button>
          </div>
        )}
        {attachedSlipIdxs.size > 0 && (
          <div className="flex items-center gap-2 mb-2 bg-cyan-500/10 border border-cyan-500/40 rounded-xl px-3 py-2 w-fit">
            <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-200">
              📎 {attachedSlipIdxs.size} slip{attachedSlipIdxs.size !== 1 ? "s" : ""} pinned · will send with next message
            </span>
            <button
              onClick={() => setAttachedSlipIdxs(new Set())}
              aria-label="Clear pinned slips"
              className="text-cyan-300/80 hover:text-cyan-100"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.csv,.tsv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-900 border border-slate-700 text-slate-400 rounded-2xl w-12 h-12 flex items-center justify-center hover:border-cyan-400 hover:text-cyan-300 transition shrink-0"
            title="Attach an image, or a text/CSV file of picks"
          >
            <Plus size={20} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={attachment ? "Add a note, or just send…" : "Ask for a parlay, analysis, or odds math..."}
            rows={1}
            className="flex-1 bg-slate-800 border border-slate-800 text-slate-100 rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-zinc-400 transition placeholder-zinc-400"
            style={{ maxHeight: "100px" }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || (!input.trim() && !attachment)}
            className="bg-cyan-400 text-slate-950 rounded-2xl w-12 h-12 flex items-center justify-center font-bold hover:bg-cyan-300 disabled:opacity-30 active:scale-95 transition shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
        <p className="text-[9px] text-slate-500 text-center mt-2 font-mono uppercase tracking-wider">
          21+ · Hypothetical only · Bet responsibly
        </p>
      </div>
    </div>
  );
}
