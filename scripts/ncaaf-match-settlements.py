"""Match archived odds to retrospective ESPN finals; never infer input availability.

Usage: python scripts/ncaaf-match-settlements.py odds-identities.json cache-dir
Matching requires exact normalized full team names, home/away, and kickoff minute.
Ambiguous/unmatched events remain excluded; no fuzzy identity substitution.
"""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import re
import sys
import urllib.request

games = json.loads(pathlib.Path(sys.argv[1]).read_text())
cache = pathlib.Path(sys.argv[2])
cache.mkdir(parents=True, exist_ok=True)

def minute(value):
    return int(datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()) // 60

def name(value):
    return re.sub(r'[^a-z0-9]', '', value.lower())

def fetch(day):
    path = cache / (day + '.json')
    try:
        if path.exists():
            raw = path.read_bytes()
        else:
            url = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=' + day.replace('-', '') + '&groups=80&limit=1000'
            with urllib.request.urlopen(url, timeout=25) as response:
                raw = response.read()
            json.loads(raw)
            path.write_bytes(raw)
        return day, json.loads(raw), hashlib.sha256(raw).hexdigest()
    except Exception as error:
        return day, {'error': type(error).__name__}, None

days = sorted({g['kickoff'][:10] for g in games})
index, failures = {}, []
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for day, payload, digest in pool.map(fetch, days):
        if 'error' in payload:
            failures.append({'day': day, 'error': payload['error']})
            continue
        for event in payload.get('events', []):
            for c in event.get('competitions', []):
                sides = {t['homeAway']: t for t in c.get('competitors', [])}
                if not all(s in sides for s in ('home', 'away')):
                    continue
                h, a = sides['home'], sides['away']
                k = (name(h['team']['displayName']), name(a['team']['displayName']), minute(c['date']))
                record = {'espnEventId': event['id'], 'homeId': h['team']['id'], 'awayId': a['team']['id'], 'kickoff': c['date'], 'completed': c.get('status', event.get('status', {})).get('type', {}).get('completed') is True, 'homePoints': int(h['score']), 'awayPoints': int(a['score']), 'neutralSite': c.get('neutralSite'), 'sourceSha256': digest}
                index.setdefault(k, {})[event['id']] = record

matched, excluded = [], []
for g in games:
    hits = list(index.get((name(g['home']), name(g['away']), minute(g['kickoff'])), {}).values())
    if len(hits) != 1:
        excluded.append({**g, 'reason': 'ambiguous_identity' if hits else 'no_exact_identity_match'})
    elif not hits[0]['completed'] or hits[0]['homePoints'] == hits[0]['awayPoints']:
        excluded.append({**g, 'reason': 'not_final_non_tied'})
    else:
        matched.append({**g, **hits[0]})
report = {'matched': matched, 'excluded': excluded, 'fetchFailures': failures, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'productionReady': False, 'historicalInputAvailabilityVerified': False}
(cache / 'settlement-matches.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'requested': len(games), 'matched': len(matched), 'excluded': len(excluded), 'fetchFailures': len(failures)}))
