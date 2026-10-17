#!/usr/bin/env python3
"""
Phase E2b: build true pre-kickoff closing lines from The Odds API historical
snapshots, join to ESPN final scores, and validate.

Does NOT flip NCAAF_GAME_LINE_SIM_VALIDATED.
Does NOT print or persist ODDS_API_KEY.

Closing definition (Odds API): for each game, request historical odds with
date = kickoff (ISO). The API returns the closest snapshot at or before that
timestamp — i.e. the last available pre-kickoff prices for games that commence
at that time. Midday slate snapshots alone are NOT used as closes.

Env:
  ODDS_API_KEY — required (injected secret preferred)
  NCAAF_PHASE_E_HOLDOUT_SEASON — default 2024 (ignored when NCAAF_E2B_FIXTURE set)
  NCAAF_E2B_FIXTURE — optional absolute/relative path to games JSON (TUNING uses
                       test/fixtures/ncaaf-tuning-2025-w1-7-games.json)
  NCAAF_E2B_OUT_STEM — output basename stem (default ncaaf-phase-e-closing-lines /
                       ncaaf-phase-e-e2b-report; TUNING: ncaaf-tuning-2025-w1-7-closing-lines)
  NCAAF_E2B_CREDIT_CAP — hard stop on credits consumed this run (default unset=unlimited;
                       TUNING authorized cap = 4500 including probes/retries)
  NCAAF_E2B_CREDITS_ALREADY_SPENT — credits already spent before this process (probes)
  NCAAF_E2B_MAX_BUCKETS — optional cap for dry runs
  NCAAF_E2B_MARKETS — default h2h,spreads; set h2h,spreads,totals,alternate_spreads
                       to capture closing totals + posted ALT prices (never invent).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[1] / "test" / "fixtures" / "ncaaf-phase-e-games.json"
)
OUT_DIR = Path(__file__).resolve().parents[1] / "test" / "fixtures"
ART_DIR = Path("/opt/cursor/artifacts")


def die(msg: str, code: int = 2) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load_key() -> str:
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        die(
            "ODDS_API_KEY unset in process env. Add Cursor Secret ODDS_API_KEY "
            "and start a new agent run (do not paste the key into chat)."
        )
    return key


def markets_param() -> str:
    """Odds API markets list. Default preserves the vendored E2b archive shape."""
    raw = os.environ.get("NCAAF_E2B_MARKETS", "h2h,spreads").strip()
    return raw or "h2h,spreads"


def parse_iso(iso: str) -> datetime:
    s = iso.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def norm_bucket(iso: str) -> str:
    """Minute-resolution kickoff bucket used as historical date= parameter."""
    return parse_iso(iso).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm_name(name: str) -> str:
    return " ".join((name or "").lower().replace("&", "and").split())


def school_key(name: str) -> str:
    """Drop trailing mascot token(s) for fuzzy school match."""
    n = norm_name(name)
    parts = n.split()
    if len(parts) >= 2:
        return " ".join(parts[:-1])
    return n


def http_get(url: str) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "stadium-edge-e2b/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {}, e.read()


def extract_team_prices(
    event: dict, team_name: str
) -> tuple[float | None, float | None, float | None, str | None]:
    """Prices for `team_name`, matched by outcome name — not venue side.

    Returns (spread_point, ml_american, spread_odds_american, book_key).
    """
    prefer = ["draftkings", "fanduel", "betmgm", "williamhill_us", "bovada"]
    books = list(event.get("bookmakers") or [])
    books.sort(
        key=lambda b: prefer.index(b.get("key")) if b.get("key") in prefer else 99
    )
    want = norm_name(team_name)

    def outcome_match(name: str) -> bool:
        n = norm_name(name)
        return n == want or want in n or n in want

    spread = ml = spread_odds = None
    used = None
    for b in books:
        markets = {m.get("key"): m for m in (b.get("markets") or [])}
        if spread is None and "spreads" in markets:
            for o in markets["spreads"].get("outcomes") or []:
                if outcome_match(o.get("name") or ""):
                    spread = o.get("point")
                    spread_odds = o.get("price")
                    used = b.get("key")
                    break
        if ml is None and "h2h" in markets:
            for o in markets["h2h"].get("outcomes") or []:
                if outcome_match(o.get("name") or ""):
                    ml = o.get("price")
                    used = used or b.get("key")
                    break
        if spread is not None and ml is not None:
            break
    return (
        float(spread) if spread is not None else None,
        float(ml) if ml is not None else None,
        float(spread_odds) if spread_odds is not None else None,
        used,
    )


def ml_to_prob(american: float) -> float:
    if not american:
        return 0.5
    if american < 0:
        return (-american) / (-american + 100.0)
    return 100.0 / (american + 100.0)


def main() -> int:
    key = load_key()
    season = int(os.environ.get("NCAAF_PHASE_E_HOLDOUT_SEASON", "2024"))
    max_buckets = os.environ.get("NCAAF_E2B_MAX_BUCKETS")
    max_buckets_n = int(max_buckets) if max_buckets else None
    fixture_env = os.environ.get("NCAAF_E2B_FIXTURE", "").strip()
    fixture_path = Path(fixture_env) if fixture_env else DEFAULT_FIXTURE
    if not fixture_path.is_absolute():
        fixture_path = (Path(__file__).resolve().parents[1] / fixture_path).resolve()
    out_stem = os.environ.get("NCAAF_E2B_OUT_STEM", "").strip()
    credit_cap_raw = os.environ.get("NCAAF_E2B_CREDIT_CAP", "").strip()
    credit_cap = int(credit_cap_raw) if credit_cap_raw else None
    credits_spent = int(os.environ.get("NCAAF_E2B_CREDITS_ALREADY_SPENT", "0") or "0")
    stopped_for_cap = False

    raw = json.loads(fixture_path.read_text())
    split = raw.get("split") or ("TUNING" if "tuning" in fixture_path.name.lower() else "holdout")
    if fixture_env or split == "TUNING":
        games = [g for g in raw["games"] if g.get("kickoffIso")]
        if not out_stem:
            out_stem = "ncaaf-tuning-2025-w1-7-closing-lines"
        print(f"split={split} fixture={fixture_path.name} games={len(games)}")
    else:
        games = [g for g in raw["games"] if g.get("season") == season and g.get("kickoffIso")]
        if not out_stem:
            out_stem = "ncaaf-phase-e-closing-lines"
        print(f"holdout_season={season} games={len(games)}")

    by_bucket: dict[str, list[dict]] = defaultdict(list)
    for g in games:
        by_bucket[norm_bucket(g["kickoffIso"])].append(g)
    buckets = sorted(by_bucket.keys())
    if max_buckets_n is not None:
        buckets = buckets[:max_buckets_n]
    print(f"kickoff_buckets={len(buckets)} (of {len(by_bucket)} total)")
    if credit_cap is not None:
        print(f"credit_cap={credit_cap} already_spent={credits_spent}")

    # Cache raw snapshots outside the git tree (no api key in files)
    ART_DIR.mkdir(parents=True, exist_ok=True)
    cache_dir = ART_DIR / "ncaaf-e2b-close-snapshots"
    cache_dir.mkdir(parents=True, exist_ok=True)

    matched: list[dict] = []
    missing: list[dict] = []
    reject_post_kick: list[dict] = []
    api_errors = 0
    http_calls = 0

    def record_spend(hdr: dict[str, str]) -> None:
        nonlocal credits_spent
        last = hdr.get("x-requests-last")
        if last is not None and str(last).strip() != "":
            try:
                credits_spent += int(float(last))
            except ValueError:
                pass

    def under_cap(next_cost: int = 20) -> bool:
        if credit_cap is None:
            return True
        return credits_spent + next_cost <= credit_cap

    for i, bucket in enumerate(buckets):
        cache_path = cache_dir / f"{bucket.replace(':', '')}.json"
        if cache_path.exists():
            payload = json.loads(cache_path.read_text())
        else:
            if not under_cap(20):
                stopped_for_cap = True
                print(
                    f"STOP credit_cap reached spent={credits_spent} cap={credit_cap} "
                    f"at bucket {i+1}/{len(buckets)} {bucket}"
                )
                for g in by_bucket[bucket]:
                    missing.append(
                        {
                            "eventId": g["eventId"],
                            "reason": "credit_cap",
                            "kickoffIso": g["kickoffIso"],
                            "home": g.get("homeName"),
                            "away": g.get("awayName"),
                        }
                    )
                for b2 in buckets[i + 1 :]:
                    for g in by_bucket[b2]:
                        missing.append(
                            {
                                "eventId": g["eventId"],
                                "reason": "credit_cap",
                                "kickoffIso": g["kickoffIso"],
                                "home": g.get("homeName"),
                                "away": g.get("awayName"),
                            }
                        )
                break
            url = (
                "https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds"
                f"?apiKey={key}&regions=us&markets={markets_param()}&oddsFormat=american&date={bucket}"
            )
            status, hdr, body = http_get(url)
            http_calls += 1
            record_spend(hdr)
            if status != 200:
                api_errors += 1
                print(f"bucket_fail {bucket} status={status} spent={credits_spent}")
                if status in (401, 402, 403):
                    die(f"historical access denied status={status}; stopping", 3)
                for g in by_bucket[bucket]:
                    missing.append(
                        {
                            "eventId": g["eventId"],
                            "reason": f"api_{status}",
                            "kickoffIso": g["kickoffIso"],
                            "home": g.get("homeName"),
                            "away": g.get("awayName"),
                        }
                    )
                time.sleep(0.2)
                continue
            data = json.loads(body)
            payload = {
                "requestDate": bucket,
                "snapshotTimestamp": data.get("timestamp"),
                "previousTimestamp": data.get("previous_timestamp"),
                "nextTimestamp": data.get("next_timestamp"),
                "remaining": hdr.get("x-requests-remaining"),
                "events": data.get("data") or [],
            }
            cache_path.write_text(json.dumps(payload) + "\n")
            if (i + 1) % 25 == 0:
                print(
                    f"progress {i+1}/{len(buckets)} remaining={hdr.get('x-requests-remaining')} "
                    f"spent={credits_spent}"
                )
            time.sleep(0.15)

        snap_ts = payload.get("snapshotTimestamp")
        # Index odds events by normalized home|away
        odds_events = list(payload.get("events") or [])

        def find_event(home: str, away: str, events: list[dict]) -> dict | None:
            hk, ak = norm_name(home), norm_name(away)
            sh, sa = school_key(home), school_key(away)
            for ev in events:
                eh, ea = norm_name(ev.get("home_team") or ""), norm_name(
                    ev.get("away_team") or ""
                )
                esh, esa = school_key(ev.get("home_team") or ""), school_key(
                    ev.get("away_team") or ""
                )
                if {eh, ea} == {hk, ak}:
                    return ev
                if {esh, esa} == {sh, sa}:
                    return ev
                if (hk in eh or eh in hk) and (ak in ea or ea in ak):
                    return ev
                if (hk in ea or ea in hk) and (ak in eh or eh in ak):
                    return ev
            return None

        def fetch_snapshot(date_iso: str) -> dict | None:
            nonlocal stopped_for_cap, http_calls
            cpath = cache_dir / f"{date_iso.replace(':', '')}.json"
            if cpath.exists():
                return json.loads(cpath.read_text())
            if not under_cap(20):
                stopped_for_cap = True
                return None
            url = (
                "https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds"
                f"?apiKey={key}&regions=us&markets={markets_param()}&oddsFormat=american&date={date_iso}"
            )
            status, hdr, body = http_get(url)
            http_calls += 1
            record_spend(hdr)
            if status != 200:
                if status in (401, 402, 403):
                    die(f"historical access denied status={status}; stopping", 3)
                return None
            data = json.loads(body)
            out = {
                "requestDate": date_iso,
                "snapshotTimestamp": data.get("timestamp"),
                "previousTimestamp": data.get("previous_timestamp"),
                "nextTimestamp": data.get("next_timestamp"),
                "remaining": hdr.get("x-requests-remaining"),
                "events": data.get("data") or [],
            }
            cpath.write_text(json.dumps(out) + "\n")
            time.sleep(0.12)
            return out

        for g in by_bucket[bucket]:
            ev = find_event(g.get("homeName") or "", g.get("awayName") or "", odds_events)
            if not ev:
                missing.append(
                    {
                        "eventId": g["eventId"],
                        "reason": "no_odds_match",
                        "kickoffIso": g["kickoffIso"],
                        "home": g.get("homeName"),
                        "away": g.get("awayName"),
                        "snapshotTimestamp": snap_ts,
                    }
                )
                continue

            commence = ev.get("commence_time")
            used_snap = snap_ts
            used_payload = payload
            # If slate snap is at/after Odds commence, re-fetch at commence for true close
            if used_snap and commence and used_snap >= commence:
                retry = fetch_snapshot(commence if commence.endswith("Z") else commence)
                if retry and retry.get("snapshotTimestamp"):
                    if retry["snapshotTimestamp"] < commence:
                        used_payload = retry
                        used_snap = retry["snapshotTimestamp"]
                        ev2 = find_event(
                            g.get("homeName") or "",
                            g.get("awayName") or "",
                            retry.get("events") or [],
                        )
                        if ev2:
                            ev = ev2
                            commence = ev.get("commence_time")
                    elif retry.get("previousTimestamp"):
                        retry2 = fetch_snapshot(retry["previousTimestamp"])
                        if (
                            retry2
                            and retry2.get("snapshotTimestamp")
                            and commence
                            and retry2["snapshotTimestamp"] < commence
                        ):
                            used_payload = retry2
                            used_snap = retry2["snapshotTimestamp"]
                            ev2 = find_event(
                                g.get("homeName") or "",
                                g.get("awayName") or "",
                                retry2.get("events") or [],
                            )
                            if ev2:
                                ev = ev2
                                commence = ev.get("commence_time")

            if used_snap and commence and used_snap >= commence:
                reject_post_kick.append(
                    {
                        "eventId": g["eventId"],
                        "reason": "snapshot_not_before_commence",
                        "snapshotTimestamp": used_snap,
                        "commenceTime": commence,
                    }
                )
                missing.append(
                    {
                        "eventId": g["eventId"],
                        "reason": "snapshot_not_before_commence",
                        "kickoffIso": g["kickoffIso"],
                        "home": g.get("homeName"),
                        "away": g.get("awayName"),
                    }
                )
                continue

            # Prefer prices from the close snapshot's event object (two-sided).
            _ = used_payload
            spread_h, ml_h, spread_odds_h, book = extract_team_prices(
                ev, g.get("homeName") or ""
            )
            spread_a, ml_a, spread_odds_a, book_a = extract_team_prices(
                ev, g.get("awayName") or ""
            )
            book = book or book_a

            if spread_h is None and ml_h is None:
                missing.append(
                    {
                        "eventId": g["eventId"],
                        "reason": "no_prices",
                        "kickoffIso": g["kickoffIso"],
                        "home": g.get("homeName"),
                        "away": g.get("awayName"),
                    }
                )
                continue

            matched.append(
                {
                    "gameId": g["eventId"],
                    "season": g["season"],
                    "week": g["week"],
                    "home": g.get("homeName"),
                    "away": g.get("awayName"),
                    "kickoffIso": g["kickoffIso"],
                    "oddsCommenceTime": commence,
                    "closeRequestDate": bucket,
                    "closeSnapshotTimestamp": used_snap,
                    "closeSpreadHome": spread_h,
                    "closeSpreadAway": spread_a,
                    "closeMlHome": ml_h,
                    "closeMlAway": ml_a,
                    "closeSpreadOddsHome": spread_odds_h,
                    "closeSpreadOddsAway": spread_odds_a,
                    "bookSample": book,
                    "homeScore": g["homeFg"],
                    "awayScore": g["awayFg"],
                    "injuryKnown": None,  # unknown — NOT false; E4 separate
                    "qbOut": None,
                    "source": "the-odds-api-historical-prekicking",
                }
            )

    # Validation metrics on matched rows with both prices + scores
    usable = [
        r
        for r in matched
        if r["closeSpreadHome"] is not None
        and r["closeMlHome"] is not None
        and r["homeScore"] is not None
        and r["awayScore"] is not None
    ]

    brier = 0.0
    ats_home = 0
    ats_n = 0
    ml_home = 0
    push = 0
    for r in usable:
        p = ml_to_prob(float(r["closeMlHome"]))
        y = 1.0 if r["homeScore"] > r["awayScore"] else 0.0
        brier += (p - y) ** 2
        if r["homeScore"] > r["awayScore"]:
            ml_home += 1
        margin = r["homeScore"] - r["awayScore"]
        adj = margin + float(r["closeSpreadHome"])
        if abs(adj) < 1e-9:
            push += 1
        else:
            ats_n += 1
            if adj > 0:
                ats_home += 1
    n = len(usable)
    market_brier = brier / n if n else None
    coin_brier = 0.25

    # Midday-slate inadequacy proof on saved 2024-09-14 fixtures
    midday_proof = []
    for p in sorted(OUT_DIR.glob("ncaaf-historical-odds-2024-09-14*.json")):
        d = json.loads(p.read_text())
        snap = d.get("snapshotTimestamp") or d.get("requestDate")
        events = d.get("events") or []
        # Games whose kickoff is >2h after snap are not "closed" by this snap
        far = sum(
            1
            for e in events
            if e.get("commenceTime")
            and (parse_iso(e["commenceTime"]) - parse_iso(snap)).total_seconds() > 7200
        )
        midday_proof.append(
            {
                "file": p.name,
                "requestDate": d.get("requestDate"),
                "snapshotTimestamp": snap,
                "events": len(events),
                "eventsKickoffMoreThan2hAfterSnap": far,
                "note": "These slate snapshots include many still-open games; not closing lines.",
            }
        )

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "split": split,
        "fixture": str(fixture_path.name),
        "holdoutSeason": season if split != "TUNING" else None,
        "finalEval": "UNTOUCHED",
        "closingDefinition": (
            "Per-game last Odds API historical snapshot with date=kickoff "
            "(closest snapshot ≤ kickoff). Midday slate files are not closes."
        ),
        "markets": markets_param(),
        "regions": "us",
        "bucketsRequested": len(buckets),
        "httpCalls": http_calls,
        "creditsSpent": credits_spent,
        "creditCap": credit_cap,
        "stoppedForCreditCap": stopped_for_cap,
        "apiErrors": api_errors,
        "holdoutGames": len(games) if max_buckets_n is None else sum(len(by_bucket[b]) for b in buckets),
        "matched": len(matched),
        "matchedWithFullPrices": n,
        "matchedTwoSidedMl": sum(
            1 for r in matched if r.get("closeMlHome") is not None and r.get("closeMlAway") is not None
        ),
        "matchedTwoSidedSpreadJuice": sum(
            1
            for r in matched
            if r.get("closeSpreadOddsHome") is not None
            and r.get("closeSpreadOddsAway") is not None
        ),
        "missing": len(missing),
        "rejectPostKickoffSnapshot": len(reject_post_kick),
        "missingReasons": {},
        "metrics": {
            "marketBrierCloseMl": market_brier,
            "marketBrierCoin": coin_brier,
            "marketBrierBeatsCoin": (
                market_brier is not None and market_brier < coin_brier
            ),
            "homeMlWinRate": (ml_home / n) if n else None,
            "homeAtsCoverRateExclPush": (ats_home / ats_n) if ats_n else None,
            "atsN": ats_n,
            "pushes": push,
        },
        "middaySlateNotClosingProof": midday_proof,
        "injuryNote": (
            "injuryKnown/qbOut left null — missing injury records must NOT be "
            "treated as no injuries. E4 requires a documented historical provider."
        ),
        "lockedParamsPreserved": True,
        "verdicts": {
            "E2b_closingArchive": "PASS" if n >= 200 else "INSUFFICIENT_DATA",
            "E2b_marketBrierVsCoin": (
                "PASS"
                if market_brier is not None and market_brier < coin_brier and n >= 200
                else "FAIL"
                if market_brier is not None and n >= 200
                else "INSUFFICIENT_DATA"
            ),
            "E2b_engineClv": "OPEN_NEEDS_ENGINE_JOIN",
            "E4_injuryConservatism": "INSUFFICIENT_DATA",
            "NCAAF_GAME_LINE_SIM_VALIDATED": "false — do not flip",
            "FINAL_EVAL": "UNTOUCHED",
        },
        "keepP0Armed": True,
        "flagFlipAllowed": False,
    }
    for m in missing:
        r = m["reason"]
        report["missingReasons"][r] = report["missingReasons"].get(r, 0) + 1

    # Write archive JSON + CSV (injuryKnown empty string, not false)
    archive_path = OUT_DIR / f"{out_stem}.json"
    report_name = (
        "ncaaf-tuning-2025-w1-7-e2b-report.json"
        if split == "TUNING"
        else "ncaaf-phase-e-e2b-report.json"
    )
    archive_path.write_text(
        json.dumps(
            {
                "version": 1,
                "split": split,
                "finalEval": "UNTOUCHED",
                "closingDefinition": report["closingDefinition"],
                "season": season if split != "TUNING" else 2025,
                "generatedAt": report["generatedAt"],
                "creditsSpent": credits_spent,
                "creditCap": credit_cap,
                "games": matched,
                "missing": missing,
            },
            indent=2,
        )
        + "\n"
    )

    csv_path = OUT_DIR / f"{out_stem}.csv"
    with csv_path.open("w") as f:
        f.write(
            "gameId,season,home,away,closeSpreadHome,closeSpreadAway,closeMlHome,closeMlAway,"
            "closeSpreadOddsHome,closeSpreadOddsAway,homeScore,awayScore,"
            "injuryKnown,closeSnapshotTimestamp,kickoffIso\n"
        )
        for r in matched:
            inj = "" if r["injuryKnown"] is None else str(r["injuryKnown"]).lower()
            def cell(v):
                return "" if v is None else v
            f.write(
                f"{r['gameId']},{r['season']},"
                f"\"{r['home']}\",\"{r['away']}\","
                f"{cell(r.get('closeSpreadHome'))},{cell(r.get('closeSpreadAway'))},"
                f"{cell(r.get('closeMlHome'))},{cell(r.get('closeMlAway'))},"
                f"{cell(r.get('closeSpreadOddsHome'))},{cell(r.get('closeSpreadOddsAway'))},"
                f"{r['homeScore']},{r['awayScore']},"
                f"{inj},{r['closeSnapshotTimestamp']},{r['kickoffIso']}\n"
            )

    report_path = OUT_DIR / report_name
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    (ART_DIR / report_name).write_text(json.dumps(report, indent=2) + "\n")
    (ART_DIR / f"{out_stem}.json").write_text(archive_path.read_text())

    print(json.dumps(report, indent=2))
    print(f"Wrote {archive_path}")
    print(f"Wrote {csv_path}")
    print(f"Wrote {report_path}")
    print(f"credits_spent={credits_spent} credit_cap={credit_cap} http_calls={http_calls}")
    print("NCAAF_GAME_LINE_SIM_VALIDATED remains false.")
    print("FINAL_EVAL untouched.")
    # Exit 2 while engine CLV / E4 / E6 still open; exit 4 if stopped for credit cap mid-run
    if stopped_for_cap:
        return 4
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
