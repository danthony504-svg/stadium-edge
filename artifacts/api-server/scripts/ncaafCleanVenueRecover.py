#!/usr/bin/env python3
"""
Recover venue IDs + explicit ESPN neutralSite flags for TUNING games.

Source: free ESPN scoreboard site API (by kickoff date).
Join: eventId + season. Sidecar only — does not mutate original games fixture.

Rules:
- Neutral ONLY when competition.neutralSite is explicitly True.
- Home stadium ONLY when competition.neutralSite is explicitly False.
- Missing event / missing neutralSite → unresolved (kind=unknown).
- Never infer neutral from absent fields or team order.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

FIX = Path(__file__).resolve().parents[1] / "test" / "fixtures"
GAMES_PATH = FIX / "ncaaf-tuning-2025-w1-7-games.json"
OUT_SIDECAR = FIX / "ncaaf-tuning-2025-w1-7-games.venue-tags.json"
OUT_MD = FIX / "ncaaf-tuning-2025-w1-7-venue-recovery.md"
DOCS_MD = Path(__file__).resolve().parents[3] / "docs" / "coach" / "ncaaf-clean-venue-recovery.md"

SCOREBOARD = (
    "https://site.api.espn.com/apis/site/v2/sports/football/"
    "college-football/scoreboard?dates={date}&limit=300"
)


def fetch_json(url: str, retries: int = 3) -> dict:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "stadium-edge-research/ncaaf-clean-venue"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.5 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def classify_international(address: dict | None) -> bool:
    if not address:
        return False
    country = str(address.get("country") or "").strip().upper()
    if not country:
        return False
    return country not in {"USA", "US", "UNITED STATES"}


def extract_event(ev: dict) -> dict | None:
    eid = str(ev.get("id") or "")
    if not eid:
        return None
    comps = ev.get("competitions") or []
    if not comps:
        return None
    c = comps[0]
    if "neutralSite" not in c:
        return {
            "eventId": eid,
            "neutralSite": None,
            "venueId": None,
            "venueName": None,
            "city": None,
            "state": None,
            "country": None,
            "indoor": None,
            "international": False,
            "conferenceCompetition": c.get("conferenceCompetition"),
            "kind": "unknown",
            "reason": "neutralSite_field_missing",
        }
    neutral = c.get("neutralSite")
    venue = c.get("venue") or {}
    addr = venue.get("address") or {}
    venue_id = str(venue.get("id")) if venue.get("id") is not None else None
    international = classify_international(addr)
    if neutral is True:
        kind = "neutral"
        reason = "espn_neutralSite_true"
    elif neutral is False:
        kind = "home"
        reason = "espn_neutralSite_false"
    else:
        kind = "unknown"
        reason = "neutralSite_non_boolean"
    return {
        "eventId": eid,
        "neutralSite": bool(neutral) if isinstance(neutral, bool) else None,
        "venueId": venue_id,
        "venueName": venue.get("fullName"),
        "city": addr.get("city"),
        "state": addr.get("state"),
        "country": addr.get("country"),
        "indoor": venue.get("indoor"),
        "international": international,
        "conferenceCompetition": c.get("conferenceCompetition"),
        "kind": kind,
        "reason": reason,
        "espnDate": (ev.get("date") or c.get("date")),
    }


def main() -> None:
    games_doc = json.loads(GAMES_PATH.read_text())
    games = games_doc["games"]
    dates = sorted({g["kickoffIso"][:10].replace("-", "") for g in games})
    by_id: dict[str, dict] = {}
    fetch_errors: list[dict] = []

    for i, d in enumerate(dates):
        url = SCOREBOARD.format(date=d)
        try:
            payload = fetch_json(url)
            for ev in payload.get("events") or []:
                row = extract_event(ev)
                if row:
                    by_id[row["eventId"]] = {
                        **row,
                        "scoreboardDate": d,
                        "sourceUrl": url,
                        "source": "espn_site_scoreboard_v2",
                    }
        except Exception as e:  # noqa: BLE001
            fetch_errors.append({"date": d, "error": str(e)})
        time.sleep(0.15)
        if (i + 1) % 5 == 0:
            print(f"fetched {i+1}/{len(dates)} dates, events_indexed={len(by_id)}", flush=True)

    # Summary fallback for TUNING events missing from date scoreboards
    for g in games:
        eid = str(g["eventId"])
        if eid in by_id:
            continue
        url = (
            "https://site.api.espn.com/apis/site/v2/sports/football/"
            f"college-football/summary?event={eid}"
        )
        try:
            payload = fetch_json(url)
            h = payload.get("header") or {}
            comps = h.get("competitions") or []
            c = comps[0] if comps else {}
            venue = (payload.get("gameInfo") or {}).get("venue") or {}
            addr = venue.get("address") or {}
            if "neutralSite" not in c:
                continue
            neutral = c.get("neutralSite")
            international = classify_international(addr)
            if neutral is True:
                kind, reason = "neutral", "espn_summary_neutralSite_true"
            elif neutral is False:
                kind, reason = "home", "espn_summary_neutralSite_false"
            else:
                continue
            by_id[eid] = {
                "eventId": eid,
                "neutralSite": bool(neutral),
                "venueId": str(venue.get("id")) if venue.get("id") is not None else None,
                "venueName": venue.get("fullName"),
                "city": addr.get("city"),
                "state": addr.get("state"),
                "country": addr.get("country"),
                "indoor": venue.get("indoor"),
                "international": international,
                "conferenceCompetition": c.get("conferenceCompetition"),
                "kind": kind,
                "reason": reason,
                "espnDate": c.get("date"),
                "scoreboardDate": None,
                "sourceUrl": url,
                "source": "espn_site_summary_v2",
            }
            time.sleep(0.1)
        except Exception as e:
            fetch_errors.append({"eventId": eid, "error": str(e)})

    rows = []
    counts = Counter()
    for g in games:
        eid = str(g["eventId"])
        season = int(g["season"])
        hit = by_id.get(eid)
        if not hit:
            rec = {
                "eventId": eid,
                "season": season,
                "week": g.get("week"),
                "kickoffIso": g.get("kickoffIso"),
                "kind": "unknown",
                "neutralSite": None,
                "venueId": None,
                "venueName": None,
                "city": None,
                "state": None,
                "country": None,
                "indoor": None,
                "international": False,
                "conferenceCompetition": None,
                "reason": "event_not_on_fetched_scoreboards",
                "source": None,
                "sourceUrl": None,
                "scoreboardDate": None,
                "provenance": "unresolved",
            }
            counts["unresolved_missing_event"] += 1
        else:
            rec = {
                "eventId": eid,
                "season": season,
                "week": g.get("week"),
                "kickoffIso": g.get("kickoffIso"),
                "kind": hit["kind"],
                "neutralSite": hit["neutralSite"],
                "venueId": hit["venueId"],
                "venueName": hit["venueName"],
                "city": hit["city"],
                "state": hit["state"],
                "country": hit["country"],
                "indoor": hit["indoor"],
                "international": hit["international"],
                "conferenceCompetition": hit["conferenceCompetition"],
                "reason": hit["reason"],
                "source": hit["source"],
                "sourceUrl": hit["sourceUrl"],
                "scoreboardDate": hit["scoreboardDate"],
                "espnDate": hit.get("espnDate"),
                "provenance": "espn_explicit" if hit["kind"] != "unknown" else "unresolved",
            }
            if hit["kind"] == "home":
                counts["home_stadium"] += 1
            elif hit["kind"] == "neutral":
                counts["neutral"] += 1
                if hit["international"]:
                    counts["neutral_international"] += 1
                else:
                    counts["neutral_domestic"] += 1
            else:
                counts["unresolved_explicit_gap"] += 1
            if hit["international"]:
                counts["international_any"] += 1
            if hit["venueId"]:
                counts["has_venue_id"] += 1
        rows.append(rec)

    recovered = sum(1 for r in rows if r["kind"] in ("home", "neutral"))
    unresolved = sum(1 for r in rows if r["kind"] == "unknown")

    sidecar = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceGames": str(GAMES_PATH.name),
        "source": "espn_site_scoreboard_v2",
        "joinKeys": ["eventId", "season"],
        "rules": {
            "neutral": "only competition.neutralSite === true",
            "home": "only competition.neutralSite === false",
            "unknown": "missing event or missing/non-boolean neutralSite",
            "noInferenceFrom": ["absent fields", "team order", "bowl name heuristics"],
        },
        "originalFixturesUntouched": True,
        "nGames": len(games),
        "nDatesFetched": len(dates),
        "nEventsIndexedFromEspn": len(by_id),
        "fetchErrors": fetch_errors,
        "counts": {
            "recovered": recovered,
            "unresolved": unresolved,
            "home_stadium": counts["home_stadium"],
            "neutral": counts["neutral"],
            "neutral_domestic": counts["neutral_domestic"],
            "neutral_international": counts["neutral_international"],
            "international_any": counts["international_any"],
            "has_venue_id": counts["has_venue_id"],
            "unresolved_missing_event": counts["unresolved_missing_event"],
            "unresolved_explicit_gap": counts["unresolved_explicit_gap"],
        },
        "games": rows,
    }
    OUT_SIDECAR.write_text(json.dumps(sidecar, indent=2) + "\n")

    md = f"""# TUNING venue recovery sidecar

**Generated:** {sidecar['generatedAt']}  
**Source:** free ESPN `site.api` scoreboard v2 (by date)  
**Join:** `eventId` + `season`  
**Original fixtures:** untouched (`ncaaf-tuning-2025-w1-7-games.json`)

## Rules

- **Neutral** only when ESPN `competition.neutralSite === true`
- **Home stadium** only when ESPN `competition.neutralSite === false`
- **Unknown** if event missing or `neutralSite` absent/non-boolean
- Do **not** infer neutral from missing fields or team order

## Counts

| Category | n |
|----------|--:|
| TUNING games | {len(games)} |
| Recovered (home+neutral) | {recovered} |
| Unresolved | {unresolved} |
| Home stadium (`neutralSite=false`) | {counts['home_stadium']} |
| Neutral (`neutralSite=true`) | {counts['neutral']} |
| Neutral domestic | {counts['neutral_domestic']} |
| Neutral international | {counts['neutral_international']} |
| Any international venue | {counts['international_any']} |
| Has venueId | {counts['has_venue_id']} |
| Unresolved: event not on scoreboards | {counts['unresolved_missing_event']} |
| Unresolved: explicit gap | {counts['unresolved_explicit_gap']} |
| Fetch date errors | {len(fetch_errors)} |

Sidecar: `{OUT_SIDECAR.name}`
"""
    OUT_MD.write_text(md)
    DOCS_MD.write_text(md)
    print(json.dumps(sidecar["counts"], indent=2))
    print(f"Wrote {OUT_SIDECAR}")
    print(f"Wrote {OUT_MD}")


if __name__ == "__main__":
    main()
