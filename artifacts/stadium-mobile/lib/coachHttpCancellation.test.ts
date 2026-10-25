import test from 'node:test';
import assert from 'node:assert/strict';
import { getOdds, fetchGameOutcomeSimulation } from './api.ts';
import { classifySportCategoryFromAsk } from './coachReliabilityClassify.ts';

test('odds cancellation settles a response body that ignores abort and never retries', async t => {
  let calls = 0;
  let child: AbortSignal | null | undefined;
  let bodyStarted!: () => void;
  let releaseBody!: (value: unknown) => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++; child = init?.signal;
    return { ok: true, json: () => { bodyStarted(); return new Promise(resolve => { releaseBody = resolve; }); } } as Response;
  });
  const parent = new AbortController();
  const request = getOdds('nfl', parent.signal);
  await started;
  parent.abort();
  assert.deepEqual(await request, []);
  assert.equal(child?.aborted, true);
  assert.equal(calls, 1);
  releaseBody([]);
});

test('game simulation cancellation covers the body after successful headers', async t => {
  let bodyStarted!: () => void;
  let releaseBody!: (value: unknown) => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: () => {
    bodyStarted(); return new Promise(resolve => { releaseBody = resolve; });
  } }) as Response);
  const parent = new AbortController();
  const request = fetchGameOutcomeSimulation({ sport: 'nfl', homeTeam: 'Home', awayTeam: 'Away', simulations: 10000 }, parent.signal);
  await started;
  parent.abort();
  await assert.rejects(request, { name: 'AbortError' });
  releaseBody(null);
});

test('team-only alerts identify unambiguous sport and keep ambiguity unknown', () => {
  assert.equal(classifySportCategoryFromAsk('6 leg New Orleans Saints'), 'nfl');
  assert.equal(classifySportCategoryFromAsk('4 leg Lakers'), 'nba');
  assert.equal(classifySportCategoryFromAsk('6 leg Giants'), 'unspecified');
});
