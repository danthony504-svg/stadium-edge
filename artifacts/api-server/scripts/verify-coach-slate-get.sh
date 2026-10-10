#!/usr/bin/env bash
# Read-only probe of GET /api/coach/slate + locked-preview leak check.
# Does not call cron (no key). Exit 0 only when slate looks warm AND free-safe.
set -euo pipefail
BASE="${COACH_API_BASE:-https://stadium-edge.onrender.com}"

python3 - "$BASE" <<'PY'
import json, sys, urllib.request, urllib.error, re, time

base = sys.argv[1].rstrip("/")

def get(path):
    with urllib.request.urlopen(base + path, timeout=60) as r:
        return r.status, json.loads(r.read())

def post_chat():
    body = json.dumps({
        "messages": [{"role": "user", "content": "Build me a 5-leg parlay for tonight"}],
        "mode": "build",
    }).encode()
    req = urllib.request.Request(
        base + "/api/chat",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read().decode("utf-8", "replace")

st, slate = get("/api/coach/slate")
print("GET /api/coach/slate", st)
print({
    "fresh": slate.get("fresh"),
    "instantServe": slate.get("instantServe"),
    "refreshing": slate.get("refreshing"),
    "computedAt": slate.get("computedAt"),
    "deepSimComplete": slate.get("deepSimComplete"),
    "activeSports": slate.get("activeSports"),
    "premiumUnlocked": slate.get("premiumUnlocked"),
    "hasSnapshot": slate.get("snapshot") is not None,
})

snap = slate.get("snapshot") or {}
board = (snap.get("boardScan") or {}).get("picks") or []
print("boardScanPicks", len(board) if isinstance(board, list) else None)

# Age
age_ms = None
if slate.get("computedAt"):
    try:
        # ISO timestamp
        from datetime import datetime
        ts = datetime.fromisoformat(str(slate["computedAt"]).replace("Z", "+00:00"))
        age_ms = int(time.time() * 1000 - ts.timestamp() * 1000)
    except Exception:
        age_ms = None
print("snapshotAgeMs", age_ms)

ok = True
if not slate.get("computedAt"):
    print("FAIL: computedAt missing")
    ok = False
if not (slate.get("activeSports") or []):
    print("FAIL: activeSports empty (eligible markets may exist — refresh pipeline still cold)")
    ok = False
if not (slate.get("fresh") or slate.get("instantServe")):
    print("FAIL: neither fresh nor instantServe")
    ok = False
if slate.get("premiumUnlocked") is True:
    print("FAIL: anonymous premiumUnlocked true")
    ok = False

# Free leak check on board picks in GET payload
leak_kw = ("edge", "ev", "simScore", "trueProb", "fairOdds", "kelly")
if isinstance(board, list):
    for p in board[:20]:
        if not isinstance(p, dict):
            continue
        if p.get("game") not in (None, "", "••••••") and slate.get("premiumUnlocked") is False:
            # Locked clients should receive redacted identity
            if p.get("game") != "••••••" or p.get("pick") != "••••••":
                print("FAIL: possible identity leak in locked board pick keys", list(p.keys())[:12])
                ok = False
                break
        blob = json.dumps(p).lower()
        for kw in leak_kw:
            if kw.lower() in blob:
                print("FAIL: premium field hint in locked pick:", kw)
                ok = False

st2, raw = post_chat()
print("POST /api/chat anon build", st2, "bytes", len(raw))
if "lockedPreview" not in raw and "Subscribe" not in raw:
    print("WARN: locked preview markers not found in SSE")
premium_hits = [kw for kw in ("trueProb", "simScore", "fairOdds", "kelly") if kw.lower() in raw.lower()]
# Allow word "edge" in CTA copy — check structured premium tokens only
if premium_hits:
    print("FAIL: premium tokens in anon SSE", premium_hits)
    ok = False
else:
    print("OK: no structured premium tokens in anon SSE")

if not ok:
    sys.exit(1)
print("OK: slate warm + free-safe")
PY
