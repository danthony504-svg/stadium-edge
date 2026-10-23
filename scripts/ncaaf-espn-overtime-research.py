"""Recover retrospective OT quarter scores; never assert historical availability."""
import concurrent.futures, datetime, hashlib, json, pathlib, sys, urllib.request
source=pathlib.Path(sys.argv[1]); destination=pathlib.Path(sys.argv[2]); destination.mkdir(parents=True,exist_ok=True)
games=[g for line in source.read_text().splitlines() if line.strip() for g in json.loads(line)['games'] if g.get('overtime') is True]
def fetch(g):
 event=g['eventId']; cache=destination/(event+'.json')
 try:
  if cache.exists():raw=cache.read_bytes()
  else:
   with urllib.request.urlopen('https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event='+event,timeout=20) as response:raw=response.read()
   cache.write_bytes(raw)
  data=json.loads(raw); header=data.get('header',{}); competition=header.get('competitions',[{}])[0]
  if str(header.get('id'))!=event:raise ValueError('event_identity_mismatch')
  teams={p['homeAway']:p for p in competition.get('competitors',[])}
  home,away=teams['home'],teams['away']
  if str(home['team']['id'])!=g['homeId'] or str(away['team']['id'])!=g['awayId']:raise ValueError('team_identity_mismatch')
  if int(home['score'])!=g['homePoints'] or int(away['score'])!=g['awayPoints']:raise ValueError('final_score_mismatch')
  def quarters(team):
   lines=team.get('linescores',[])
   if len(lines)<5:raise ValueError('missing_overtime_quarters')
   values=[int(p['value'] if 'value' in p else p['displayValue']) for p in lines]
   if any(p<0 for p in values) or sum(values)!=int(team['score']):raise ValueError('inconsistent_quarter_scores')
   return sum(values[:4])
  h,a=quarters(home),quarters(away)
  if h!=a:raise ValueError('regulation_not_tied')
  return {'season':g['season'],'eventId':event,'homeId':g['homeId'],'awayId':g['awayId'],'kickoff':g['kickoff'],'regulationHomePoints':h,'regulationAwayPoints':a,'homePoints':g['homePoints'],'awayPoints':g['awayPoints'],'source':'espn_summary','retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'responseSha256':hashlib.sha256(raw).hexdigest(),'historicalAvailabilityVerified':False}
 except Exception as e:return {'eventId':event,'error':str(e) if isinstance(e,ValueError) else type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,games))
report={'sourceInputSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'attempted':len(games),'recovered':sum('error' not in r for r in results),'records':results,'productionReady':False,'limitations':['retrospective_fetch_not_pregame_snapshot','no_quote_timing_prices_or_injury_evidence']}
(destination/'overtime-sidecar.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='records'}));print(json.dumps([r for r in results if 'error' in r]))
