"""Normalize the ramirobentes/nba_data regular-season research tables.

Usage: python prepareNbaFirstBasketSeason.py PBP POSSESSIONS STINTS OUTPUT
Dependencies: pandas and pyarrow. Recorded starting fives are known in this
lineup-conditioned replay. Jump candidates and usage priors use earlier finals.
"""
from collections import Counter, defaultdict
import argparse
import heapq
import json
import re

import pandas as pd
import pyarrow.parquet as parquet


PLAYER = re.compile(r"(\d+) (.+)")
METHOD = {"freethrow": "FT", "2pt": "2", "3pt": "3"}


def athlete(value):
    match = PLAYER.fullmatch(str(value).strip())
    return (match[1], match[2]) if match else ("", "")


def five(value):
    return dict(athlete(player) for player in str(value).split(", ") if athlete(player)[0])


def clock(value):
    minutes, seconds = str(value).split(":")
    return int(minutes) * 60 + float(seconds)


def model_clock(value):
    minutes, seconds = str(value).split(":")
    return f"{int(minutes)}:{seconds}"


def milliseconds(value):
    return int(pd.Timestamp(value).timestamp() * 1000)


def read_games(pbp, possessions, stints):
    poss_groups = dict(tuple(possessions[possessions.period == 1].groupby("game_id", sort=False)))
    # Both team perspectives can be present. One team's row supplies both fives.
    rotations = dict(tuple(stints[stints.location_team.str.lower() == "home"].groupby("game_id", sort=False)))
    excluded = Counter()
    games = []
    for event_id, game in pbp.groupby("game_id", sort=False):
        game = game.sort_values("order", kind="stable")
        q1 = game[game.period == 1]
        opening = q1[(q1.action_type == "period") & (q1.sub_type == "start")]
        ends = game[(game.action_type == "game") & (game.sub_type == "end")]
        tips = q1[(q1.action_type == "jumpball") & (q1.sub_type == "recovered") & (q1.secs_game <= 12)]
        if opening.empty or ends.empty or tips.empty or event_id not in poss_groups:
            excluded["missing_start_tip_final_or_possessions"] += 1
            continue
        start = opening.iloc[0]
        tip = tips.iloc[0]
        end = ends.iloc[-1]
        if pd.isna(start.time_actual) or pd.isna(end.time_actual) or start.time_actual >= end.time_actual:
            excluded["invalid_timestamps"] += 1
            continue
        team_ids = [start.team_home, start.team_away]
        starters = [five(start.lineup_home), five(start.lineup_away)]
        # In this CDN-derived table a recovered jump-ball row stores the
        # recovering player in player1 and the ordered jumpers in player2/3.
        winner, loser = athlete(tip.player2_name)[0], athlete(tip.player3_name)[0]
        winning_side = [side for side in (0, 1) if winner in starters[side] and loser in starters[1 - side]]
        if any(len(side) != 5 for side in starters) or len(winning_side) != 1:
            excluded["unbound_starters_or_jumpers"] += 1
            continue
        tip_side = winning_side[0]
        ordered_jumps = [winner, loser] if tip_side == 0 else [loser, winner]
        poss_rows = poss_groups[event_id]
        if poss_rows.empty or poss_rows.iloc[0].team_poss not in team_ids or clock(poss_rows.iloc[0].start_time) != 720:
            excluded["missing_opening_possession"] += 1
            continue
        segments = []
        sides_with_field_goal = set()
        events = q1[q1.action_type.isin(METHOD)].copy()
        events["sec"] = events.clock.map(clock)
        for row in poss_rows.itertuples():
            if row.team_poss not in team_ids:
                break
            lower, upper = clock(row.end_time), clock(row.start_time)
            if upper < lower:
                break
            side = team_ids.index(row.team_poss)
            candidates = events[(events.team_abb == row.team_poss) & (events.sec <= upper) & (events.sec >= lower)]
            shots = []
            for shot in candidates.itertuples():
                if shot.shot_result not in ("Made", "Missed") or not athlete(shot.player1_name)[0]:
                    continue
                shots.append({"playerId": athlete(shot.player1_name)[0], "method": METHOD[shot.action_type],
                              "made": shot.shot_result == "Made", "clock": model_clock(shot.clock)})
                if shot.shot_result == "Made" and shot.action_type != "freethrow":
                    sides_with_field_goal.add(side)
            events = events.drop(candidates.index)
            segments.append({"side": side, "clock": model_clock(row.start_time), "endClock": model_clock(row.end_time), "shots": shots})
            if lower < 600 and len(sides_with_field_goal) == 2:
                break
        if not segments or len(sides_with_field_goal) != 2:
            excluded["missing_first_field_goal"] += 1
            continue
        # Verify the reconstructed scorers against ordered play-by-play for
        # game first points and both teams' field goals.
        raw_made = q1[(q1.action_type.isin(METHOD)) & (q1.shot_result == "Made")]
        replay_made = [(segment["side"], shot["playerId"], shot["method"], shot["clock"])
                       for segment in segments for shot in segment["shots"] if shot["made"]]
        raw = [(team_ids.index(shot.team_abb), athlete(shot.player1_name)[0], METHOD[shot.action_type], model_clock(shot.clock))
               for shot in raw_made.itertuples() if shot.team_abb in team_ids]
        field_goals = lambda rows, side: next((shot for shot in rows if shot[0] == side and shot[2] != "FT"), None)
        if not raw or not replay_made or raw[0] != replay_made[0] or any(
                field_goals(raw, side) != field_goals(replay_made, side) for side in (0, 1)):
            excluded["scoring_reconciliation"] += 1
            continue
        usage = defaultdict(lambda: [0, 0, 0, 0])
        shots = game[(game.action_type.isin(METHOD)) & game.shot_result.isin(["Made", "Missed"])]
        for shot in shots.itertuples():
            player = athlete(shot.player1_name)[0]
            if player:
                usage[player][list(METHOD).index(shot.action_type)] += 1
        if event_id in rotations:
            for row in rotations[event_id].itertuples():
                if not (row.secs_played > 0):
                    continue
                for player in {**five(row.lineup_team), **five(row.lineup_opp)}:
                    usage[player][3] += row.secs_played / 60
        final_at = milliseconds(end.time_actual)
        record = {"eventId": event_id, "finalAt": final_at, "availableAt": final_at + 60_000,
                  "teams": [{"id": team_id, "starters": list(starters[side]), "jumperId": ordered_jumps[side]}
                            for side, team_id in enumerate(team_ids)], "tipWinner": tip_side,
                  "firstPossession": segments[0]["side"], "possessions": segments}
        games.append((milliseconds(start.time_actual), record, starters, dict(usage)))
    return sorted(games, key=lambda game: game[0]), excluded


def make_input(games):
    results = []
    player_usage = defaultdict(lambda: [0, 0, 0, 0])
    tip_history = Counter()
    pending = []
    for i, (starts_at, final, starters, usage) in enumerate(games):
        cutoff = starts_at - 1
        while pending and pending[0][0] <= cutoff:
            _, _, previous, attempts = heapq.heappop(pending)
            for player, summary in attempts.items():
                if summary[3] > 0:
                    player_usage[player] = [a + b for a, b in zip(player_usage[player], summary)]
            for team in previous["teams"]:
                tip_history[(team["id"], team["jumperId"])] += 1
        teams = []
        for side, team in enumerate(final["teams"]):
            players = []
            for player, name in starters[side].items():
                prior = player_usage[player]
                # Ten prior minutes of neutral opportunity make cold-start
                # usage explicit without consulting the target game's shots.
                rate = [(prior[j] + fallback * 10) / (prior[3] + 10)
                        for j, fallback in enumerate((0.07, 0.20, 0.14))]
                players.append({"id": player, "name": name, "usage": rate})
            weights = [0.25 + tip_history[(team["id"], player["id"])] for player in players]
            teams.append({"id": team["id"], "starters": players, "likelyJumpers": [
                {"playerId": player["id"], "weight": weight / sum(weights)}
                for player, weight in zip(players, weights)
            ]})
        results.append({"snapshot": {"eventId": final["eventId"], "startsAt": starts_at,
                                     "availableAt": cutoff, "confirmedAt": cutoff,
                                     "source": "2025-26 public play-by-play, recorded-starter research replay",
                                     "home": teams[0], "away": teams[1]}, "final": final})
        heapq.heappush(pending, (final["availableAt"], i, final, usage))
    return {"history": [item["final"] for item in results], "cases": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for label in ("pbp", "possessions", "stints", "output"):
        parser.add_argument(label)
    args = parser.parse_args()
    tables = [parquet.read_table(getattr(args, name)).to_pandas() for name in ("pbp", "possessions", "stints")]
    games, excluded = read_games(*tables)
    print(json.dumps({"sourceGames": tables[0].game_id.nunique(), "normalizedGames": len(games), "excluded": excluded}))
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(make_input(games), output, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


if __name__ == "__main__":
    main()
