#!/usr/bin/env python3
"""
FINAL_EVAL ML archive retrieval — close h2h + T−24h two-sided h2h.

Authorized caps (separate + combined):
  closeH2h hardCap = 2100
  earlyClvH2h hardCap = 2100
  combinedMaximum = 4200
  (probes/retries included)

Preserves frozen membership, E1 α=1.15, Coach R1–R4/C1–C6.
Does NOT score FINAL_EVAL. Does NOT deploy/OTA/unlock NCAAF.
Spreads blocked (markets=h2h only). Never invents away ML.

Env:
  ODDS_API_KEY — required (Cursor secret; never logged)
  NCAAF_FINAL_EVAL_PULL — must be 1 to authorize paid HTTP
  NCAAF_FINAL_EVAL_PULL_PHASE — close | early | both (default both)
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

HERE = Path(__file__).resolve().parent
FIX = HERE.parent / "test" / "fixtures"
DOCS = HERE.parents[2] / "docs" / "coach"
ART = Path("/opt/cursor/artifacts")

MANIFEST_PATH = FIX / "ncaaf-final-eval-odds-request-manifests.json"
MEMBERSHIP_PATH = FIX / "ncaaf-final-eval-membership-games.json"

CLOSE_CAP = 2100
EARLY_CAP = 2100
COMBINED_CAP = 4200
CREDITS_PER_BUCKET_EST = 10  # h2h × us historical


def die(msg: str, code: int = 2) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(code)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def secret_presence() -> dict:
    key = (os.environ.get("ODDS_API_KEY") or "").strip()
    return {
        "ODDS_API_KEY": "PRESENT" if key else "ABSENT",
        "ODDS_API_KEY_len": len(key) if key else 0,
        "CLOUD_AGENT_ALL_SECRET_NAMES": os.environ.get(
            "CLOUD_AGENT_ALL_SECRET_NAMES", ""
        ),
        "CLOUD_AGENT_INJECTED_SECRET_NAMES": os.environ.get(
            "CLOUD_AGENT_INJECTED_SECRET_NAMES", ""
        ),
    }


def load_key() -> str:
    key = (os.environ.get("ODDS_API_KEY") or "").strip()
    if not key:
        die(
            "ODDS_API_KEY unset. Add Cursor Secret ODDS_API_KEY and start a new "
            "agent run (do not paste the key into chat).",
            3,
        )
    return key


def parse_iso(iso: str) -> datetime:
    s = iso.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def norm_name(name: str) -> str:
    return " ".join((name or "").lower().replace("&", "and").split())


def school_key(name: str) -> str:
    n = norm_name(name)
    parts = n.split()
    if len(parts) >= 2:
        return " ".join(parts[:-1])
    return n


def http_get(url: str) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "stadium-edge-final-eval-ml/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}, e.read()


def extract_ml(event: dict, team_name: str) -> tuple[float | None, str | None]:
    prefer = ["draftkings", "fanduel", "betmgm", "williamhill_us", "bovada"]
    books = list(event.get("bookmakers") or [])
    books.sort(
        key=lambda b: prefer.index(b.get("key")) if b.get("key") in prefer else 99
    )
    want = norm_name(team_name)

    def outcome_match(name: str) -> bool:
        n = norm_name(name)
        return n == want or want in n or n in want

    for b in books:
        markets = {m.get("key"): m for m in (b.get("markets") or [])}
        if "h2h" not in markets:
            continue
        for o in markets["h2h"].get("outcomes") or []:
            if outcome_match(o.get("name") or ""):
                price = o.get("price")
                if price is None:
                    continue
                return float(price), b.get("key")
    return None, None


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


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")


def stop_no_key(reason: str) -> int:
    presence = secret_presence()
    report = {
        "status": "STOPPED_NO_KEY",
        "generatedAt": utc_now(),
        "paidRetrieval": False,
        "historicalBatchStarted": False,
        "creditsConsumed": 0,
        "creditsConsumedClose": 0,
        "creditsConsumedEarly": 0,
        "combinedCreditCap": COMBINED_CAP,
        "closeHardCap": CLOSE_CAP,
        "earlyHardCap": EARLY_CAP,
        "matchedGamesClose": 0,
        "matchedGamesEarly": 0,
        "timestampValidity": "NOT_RUN",
        "missingData": "all — retrieval not started",
        "coverage": "INCOMPLETE",
        "finalEvalScored": False,
        "spreads": "BLOCKED",
        "voice": "PAUSED",
        "ncaafUnlock": False,
        "deployOta": False,
        "e1Frozen": "alpha=1.15 preserved",
        "coachSelectionRules": "R1–R4 / C1–C6 preserved (not re-opened)",
        "membershipPreserved": True,
        "agent": {
            "ODDS_API_KEY": presence["ODDS_API_KEY"],
            "CLOUD_AGENT_ALL_SECRET_NAMES": presence["CLOUD_AGENT_ALL_SECRET_NAMES"],
            "CLOUD_AGENT_INJECTED_SECRET_NAMES": presence[
                "CLOUD_AGENT_INJECTED_SECRET_NAMES"
            ],
        },
        "reason": reason,
        "addSecret": (
            "https://cursor.com/dashboard/cloud-agents/environments/"
            "e/8c5427d9-a490-11f1-a7d1-d6b4613131ce → Secrets → ODDS_API_KEY; "
            "then start a new agent run"
        ),
        "noPurchaseOrUpgrade": True,
    }
    ART.mkdir(parents=True, exist_ok=True)
    write_json(ART / "ncaaf-final-eval-ml-archive-retrieval-stop.json", report)
    write_json(FIX / "ncaaf-final-eval-ml-archive-retrieval-stop.json", report)
    md = f"""# FINAL_EVAL ML archive retrieval — STOPPED

**Status:** `STOPPED_NO_KEY` · **Credits consumed:** **0** · **FINAL_EVAL scored:** false  
**Spreads:** blocked · **Voice:** paused · **Deploy/OTA/NCAAF unlock:** false  
**No purchase / upgrade**

## Access (no value exposure)

| Check | Result |
|-------|--------|
| `ODDS_API_KEY` | **{presence["ODDS_API_KEY"]}** |
| `CLOUD_AGENT_ALL_SECRET_NAMES` | `{presence["CLOUD_AGENT_ALL_SECRET_NAMES"]}` |
| `CLOUD_AGENT_INJECTED_SECRET_NAMES` | `{presence["CLOUD_AGENT_INJECTED_SECRET_NAMES"]}` |

## Caps (authorized, unused)

| Pull | Hard cap | Spent |
|------|----------|-------|
| Close h2h | {CLOSE_CAP} | 0 |
| Early T−24h two-sided h2h | {EARLY_CAP} | 0 |
| Combined | {COMBINED_CAP} | 0 |

## Coverage

| Metric | Value |
|--------|-------|
| Matched games (close) | 0 |
| Matched games (early) | 0 |
| Timestamp validity | NOT_RUN |
| Missing data | **all** — retrieval not started |
| Coverage | **INCOMPLETE** |

## Preserved

Membership (408) · E1 α=1.15 · Coach R1–R4/C1–C6 · manifests 2100+2100≤4200

## Next

1. Add `ODDS_API_KEY` in Cloud Agent environment Secrets (same name as Render).  
2. Start a **new** agent run so injection applies.  
3. Re-run `ncaafCleanFinalEvalMlArchivePull.py` with `NCAAF_FINAL_EVAL_PULL=1`.
"""
    (ART / "ncaaf-final-eval-ml-archive-retrieval-stop.md").write_text(md)
    (DOCS / "ncaaf-final-eval-ml-archive-retrieval-stop.md").write_text(md)
    (FIX / "ncaaf-final-eval-ml-archive-retrieval-stop.md").write_text(md)
    print(json.dumps(report, indent=2))
    print("STOP: ODDS_API_KEY absent — 0 credits consumed; coverage INCOMPLETE")
    return 3


def probe_quota(key: str, combined_spent: int) -> dict:
    """Free GET /v4/sports — 0 credits. Cap check still runs before any call."""
    if combined_spent + 0 > COMBINED_CAP:
        return {"ok": False, "reason": "combined_cap_before_probe"}
    url = f"https://api.the-odds-api.com/v4/sports?apiKey={key}"
    status, hdr, body = http_get(url)
    return {
        "ok": status == 200,
        "status": status,
        "x_requests_remaining": hdr.get("x-requests-remaining"),
        "x_requests_used": hdr.get("x-requests-used"),
        "x_requests_last": hdr.get("x-requests-last"),
        "bytes": len(body),
        "creditsCharged": int(float(hdr.get("x-requests-last") or 0) or 0),
    }


class CapLedger:
    def __init__(self) -> None:
        self.close = 0
        self.early = 0
        self.stopped: str | None = None

    @property
    def combined(self) -> int:
        return self.close + self.early

    def can_spend(self, phase: str, next_cost: int) -> bool:
        if self.combined + next_cost > COMBINED_CAP:
            self.stopped = "combined_cap"
            return False
        if phase == "close" and self.close + next_cost > CLOSE_CAP:
            self.stopped = "close_cap"
            return False
        if phase == "early" and self.early + next_cost > EARLY_CAP:
            self.stopped = "early_cap"
            return False
        return True

    def record(self, phase: str, hdr: dict[str, str], fallback: int = CREDITS_PER_BUCKET_EST) -> int:
        last = hdr.get("x-requests-last")
        cost = fallback
        if last is not None and str(last).strip() != "":
            try:
                cost = int(float(last))
            except ValueError:
                pass
        if phase == "close":
            self.close += cost
        else:
            self.early += cost
        return cost


def cache_path(cache_dir: Path, bucket_iso: str) -> Path:
    # Match manifest naming and E2b colon-stripped variants
    a = cache_dir / f"{bucket_iso.replace(':', '-')}.json"
    b = cache_dir / f"{bucket_iso.replace(':', '')}.json"
    if a.exists():
        return a
    if b.exists():
        return b
    return a


def fetch_or_cache(
    *,
    key: str,
    bucket_iso: str,
    cache_dir: Path,
    phase: str,
    ledger: CapLedger,
) -> dict | None:
    path = cache_path(cache_dir, bucket_iso)
    if path.exists():
        return json.loads(path.read_text())
    # Cap BEFORE each request
    if not ledger.can_spend(phase, CREDITS_PER_BUCKET_EST):
        return None
    url = (
        "https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf/odds"
        f"?apiKey={key}&regions=us&markets=h2h&oddsFormat=american&date={bucket_iso}"
    )
    status, hdr, body = http_get(url)
    ledger.record(phase, hdr)
    if status != 200:
        if status in (401, 402, 403):
            die(f"historical access denied status={status}; stopping", 3)
        print(f"{phase}_bucket_fail {bucket_iso} status={status} spent={ledger.combined}")
        return None
    data = json.loads(body)
    payload = {
        "requestDate": bucket_iso,
        "snapshotTimestamp": data.get("timestamp"),
        "previousTimestamp": data.get("previous_timestamp"),
        "nextTimestamp": data.get("next_timestamp"),
        "remaining": hdr.get("x-requests-remaining"),
        "events": data.get("data") or [],
        "phase": phase,
        "markets": "h2h",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload) + "\n")
    time.sleep(0.12)
    return payload


def join_games(
    *,
    games_by_id: dict[str, dict],
    requests: list[dict],
    key: str,
    cache_dir: Path,
    phase: str,
    ledger: CapLedger,
    require_pre_kick: bool,
) -> tuple[list[dict], list[dict], dict]:
    matched: list[dict] = []
    missing: list[dict] = []
    validity = {
        "ok": 0,
        "reject_post_kick": 0,
        "cache_hits": 0,
        "http_fetches": 0,
        "cap_stopped_remaining_games": 0,
    }

    for i, req in enumerate(requests):
        if req.get("skipHttp") and req.get("skipReason") == "file_cache_hit":
            pass
        bucket = req["bucketIso"]
        path = cache_path(cache_dir, bucket)
        existed = path.exists()
        payload = fetch_or_cache(
            key=key, bucket_iso=bucket, cache_dir=cache_dir, phase=phase, ledger=ledger
        )
        if payload is None:
            # Cap or API failure — mark remaining
            reason = ledger.stopped or "api_or_empty"
            for r2 in requests[i:]:
                for eid in r2["eventIds"]:
                    g = games_by_id.get(eid, {})
                    missing.append(
                        {
                            "eventId": eid,
                            "reason": reason,
                            "kickoffIso": g.get("kickoffIso"),
                            "home": g.get("homeName"),
                            "away": g.get("awayName"),
                            "phase": phase,
                        }
                    )
                    validity["cap_stopped_remaining_games"] += 1
            break
        if existed:
            validity["cache_hits"] += 1
        else:
            validity["http_fetches"] += 1

        events = list(payload.get("events") or [])
        snap_ts = payload.get("snapshotTimestamp")

        for eid in req["eventIds"]:
            g = games_by_id.get(eid)
            if not g:
                missing.append(
                    {"eventId": eid, "reason": "not_in_membership", "phase": phase}
                )
                continue
            ev = find_event(g.get("homeName") or "", g.get("awayName") or "", events)
            if not ev:
                missing.append(
                    {
                        "eventId": eid,
                        "reason": "no_odds_match",
                        "kickoffIso": g.get("kickoffIso"),
                        "home": g.get("homeName"),
                        "away": g.get("awayName"),
                        "snapshotTimestamp": snap_ts,
                        "phase": phase,
                    }
                )
                continue

            commence = ev.get("commence_time")
            used_snap = snap_ts
            used_ev = ev

            if require_pre_kick and used_snap and commence and used_snap >= commence:
                # Retry at commence / previousTimestamp under cap
                for retry_date in (
                    commence if isinstance(commence, str) else None,
                    payload.get("previousTimestamp"),
                ):
                    if not retry_date:
                        continue
                    retry = fetch_or_cache(
                        key=key,
                        bucket_iso=retry_date if retry_date.endswith("Z") else retry_date,
                        cache_dir=cache_dir,
                        phase=phase,
                        ledger=ledger,
                    )
                    if not retry:
                        break
                    rts = retry.get("snapshotTimestamp")
                    if rts and commence and rts < commence:
                        used_snap = rts
                        ev2 = find_event(
                            g.get("homeName") or "",
                            g.get("awayName") or "",
                            retry.get("events") or [],
                        )
                        if ev2:
                            used_ev = ev2
                            commence = ev2.get("commence_time")
                        break

            if require_pre_kick and used_snap and commence and used_snap >= commence:
                validity["reject_post_kick"] += 1
                missing.append(
                    {
                        "eventId": eid,
                        "reason": "snapshot_not_before_commence",
                        "kickoffIso": g.get("kickoffIso"),
                        "snapshotTimestamp": used_snap,
                        "commenceTime": commence,
                        "phase": phase,
                    }
                )
                continue

            ml_h, book_h = extract_ml(used_ev, g.get("homeName") or "")
            ml_a, book_a = extract_ml(used_ev, g.get("awayName") or "")
            if ml_h is None or ml_a is None:
                missing.append(
                    {
                        "eventId": eid,
                        "reason": "missing_two_sided_ml",
                        "kickoffIso": g.get("kickoffIso"),
                        "home": g.get("homeName"),
                        "away": g.get("awayName"),
                        "mlHome": ml_h,
                        "mlAway": ml_a,
                        "phase": phase,
                    }
                )
                continue

            validity["ok"] += 1
            matched.append(
                {
                    "gameId": eid,
                    "season": g.get("season"),
                    "week": g.get("week"),
                    "home": g.get("homeName"),
                    "away": g.get("awayName"),
                    "kickoffIso": g.get("kickoffIso"),
                    "oddsCommenceTime": commence,
                    "requestDate": bucket,
                    "snapshotTimestamp": used_snap,
                    "mlHome": ml_h,
                    "mlAway": ml_a,
                    "bookSample": book_h or book_a,
                    "homeScore": g.get("homeFg"),
                    "awayScore": g.get("awayFg"),
                    "phase": phase,
                    "source": "the-odds-api-historical-h2h",
                    "twoSided": True,
                }
            )

    return matched, missing, validity


def run_pull() -> int:
    presence = secret_presence()
    if presence["ODDS_API_KEY"] == "ABSENT":
        return stop_no_key(
            "Authorized FINAL_EVAL ML archive pull cannot start: ODDS_API_KEY "
            "not in process env; CLOUD_AGENT_ALL_SECRET_NAMES has only EXPO_TOKEN."
        )

    if os.environ.get("NCAAF_FINAL_EVAL_PULL", "").strip() != "1":
        die("Set NCAAF_FINAL_EVAL_PULL=1 to authorize paid historical HTTP", 2)

    key = load_key()
    phase_sel = (os.environ.get("NCAAF_FINAL_EVAL_PULL_PHASE") or "both").strip().lower()
    manifest = json.loads(MANIFEST_PATH.read_text())
    membership = json.loads(MEMBERSHIP_PATH.read_text())
    games = membership["games"]
    games_by_id = {g["eventId"]: g for g in games}

    close_m = manifest["closeOnlyH2h"]
    early_m = manifest["earlyTwoSidedClv"]
    close_cache = Path(
        (close_m.get("deduplication") or {}).get(
            "fileCacheDir", "/opt/cursor/artifacts/ncaaf-e2b-close-snapshots"
        )
    )
    early_cache = Path(
        (early_m.get("deduplication") or {}).get(
            "fileCacheDir", "/opt/cursor/artifacts/ncaaf-e2b-early-snapshots"
        )
    )
    close_cache.mkdir(parents=True, exist_ok=True)
    early_cache.mkdir(parents=True, exist_ok=True)

    ledger = CapLedger()

    # Free quota probe (0 credits) — still after key confirm; never print key
    probe = probe_quota(key, ledger.combined)
    print(
        f"quota_probe ok={probe.get('ok')} status={probe.get('status')} "
        f"remaining={probe.get('x_requests_remaining')} last={probe.get('x_requests_last')}"
    )
    if probe.get("creditsCharged"):
        # Should be 0; if not, count against combined before historical
        ledger.close += int(probe["creditsCharged"])

    results: dict = {
        "generatedAt": utc_now(),
        "paidRetrieval": True,
        "finalEvalScored": False,
        "spreads": "BLOCKED",
        "voice": "PAUSED",
        "ncaafUnlock": False,
        "deployOta": False,
        "e1Frozen": "alpha=1.15",
        "coachSelectionRulesLocked": True,
        "membershipGames": len(games),
        "quotaProbe": {
            k: probe[k]
            for k in (
                "ok",
                "status",
                "x_requests_remaining",
                "x_requests_used",
                "x_requests_last",
                "creditsCharged",
            )
            if k in probe
        },
        "caps": {
            "close": CLOSE_CAP,
            "early": EARLY_CAP,
            "combined": COMBINED_CAP,
        },
        "close": None,
        "early": None,
    }

    if phase_sel in ("close", "both"):
        matched, missing, validity = join_games(
            games_by_id=games_by_id,
            requests=close_m["requests"],
            key=key,
            cache_dir=close_cache,
            phase="close",
            ledger=ledger,
            require_pre_kick=True,
        )
        archive = {
            "version": 1,
            "split": "FINAL_EVAL",
            "archive": "close_h2h",
            "scored": False,
            "markets": ["h2h"],
            "generatedAt": utc_now(),
            "creditsSpent": ledger.close,
            "creditCap": CLOSE_CAP,
            "games": matched,
            "missing": missing,
            "timestampValidity": validity,
            "stoppedForCap": ledger.stopped == "close_cap"
            or ledger.stopped == "combined_cap",
        }
        write_json(FIX / "ncaaf-final-eval-close-h2h-archive.json", archive)
        write_json(ART / "ncaaf-final-eval-close-h2h-archive.json", archive)
        results["close"] = {
            "matched": len(matched),
            "matchedTwoSided": sum(
                1 for r in matched if r.get("mlHome") is not None and r.get("mlAway") is not None
            ),
            "missing": len(missing),
            "creditsSpent": ledger.close,
            "hardCap": CLOSE_CAP,
            "timestampValidity": validity,
            "stoppedForCap": archive["stoppedForCap"],
            "incomplete": archive["stoppedForCap"] or len(missing) > 0,
        }
        if ledger.stopped:
            print(f"STOP close phase: {ledger.stopped} spent_close={ledger.close}")

    if phase_sel in ("early", "both") and ledger.stopped not in (
        "combined_cap",
    ):
        # Reset phase-local stop for early if only close_cap tripped
        if ledger.stopped == "close_cap":
            ledger.stopped = None
        matched, missing, validity = join_games(
            games_by_id=games_by_id,
            requests=early_m["requests"],
            key=key,
            cache_dir=early_cache,
            phase="early",
            ledger=ledger,
            require_pre_kick=False,  # T−24h is intentionally pre-kickoff by construction
        )
        archive = {
            "version": 1,
            "split": "FINAL_EVAL",
            "archive": "early_t24h_h2h_twosided",
            "scored": False,
            "markets": ["h2h"],
            "generatedAt": utc_now(),
            "creditsSpent": ledger.early,
            "creditCap": EARLY_CAP,
            "games": matched,
            "missing": missing,
            "timestampValidity": validity,
            "stoppedForCap": ledger.stopped in ("early_cap", "combined_cap"),
        }
        write_json(FIX / "ncaaf-final-eval-early-t24h-h2h-archive.json", archive)
        write_json(ART / "ncaaf-final-eval-early-t24h-h2h-archive.json", archive)
        results["early"] = {
            "matched": len(matched),
            "matchedTwoSided": sum(
                1 for r in matched if r.get("mlHome") is not None and r.get("mlAway") is not None
            ),
            "missing": len(missing),
            "creditsSpent": ledger.early,
            "hardCap": EARLY_CAP,
            "timestampValidity": validity,
            "stoppedForCap": archive["stoppedForCap"],
            "incomplete": archive["stoppedForCap"] or len(missing) > 0,
        }

    results["creditsConsumed"] = ledger.combined
    results["creditsConsumedClose"] = ledger.close
    results["creditsConsumedEarly"] = ledger.early
    results["stoppedFor"] = ledger.stopped
    results["coverage"] = (
        "INCOMPLETE"
        if ledger.stopped
        or (results.get("close") or {}).get("incomplete")
        or (results.get("early") or {}).get("incomplete")
        else "COMPLETE"
    )
    write_json(ART / "ncaaf-final-eval-ml-archive-retrieval-report.json", results)
    write_json(FIX / "ncaaf-final-eval-ml-archive-retrieval-report.json", results)
    print(json.dumps(results, indent=2))
    if ledger.stopped or results["coverage"] == "INCOMPLETE":
        print(
            f"INCOMPLETE coverage credits={ledger.combined} "
            f"close={ledger.close} early={ledger.early} stopped={ledger.stopped}"
        )
        return 4
    print(f"COMPLETE credits={ledger.combined} FINAL_EVAL unscored")
    return 0


def main() -> int:
    # Always prefer stop-no-key path when absent (even without PULL=1)
    if secret_presence()["ODDS_API_KEY"] == "ABSENT":
        return stop_no_key(
            "Authorized FINAL_EVAL ML archive pull cannot start: ODDS_API_KEY "
            "not in process env; CLOUD_AGENT_ALL_SECRET_NAMES has only EXPO_TOKEN."
        )
    return run_pull()


if __name__ == "__main__":
    raise SystemExit(main())
