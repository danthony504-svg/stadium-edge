import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoachParlay } from './buildParlay.ts';
import { coachTotalRequestBudgetMs } from './coachRequestDeadline.ts';

test('actual Coach build returns on its shared deadline when loading ignores cancellation', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 500));
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });
  const statuses: string[] = [];
  const start = Date.now();
  const result = await buildCoachParlay({
    requestedLegs: 6, askText: '6 leg NFL moneylines only',
    signal: new AbortController().signal,
    requestStartedAtMs: start - coachTotalRequestBudgetMs(6) + 300,
    onStatus: status => statuses.push(status),
  });
  assert.equal(result.timedOut, true);
  assert.deepEqual(result.picks, []);
  assert.match(result.note, /time limit before the scan finished/);
  assert.doesNotMatch(result.note, /only .*eligible/i);
  assert.ok(['absolute_budget', 'load_deadline'].includes(result.timing?.timeoutReason ?? ''));
  assert.ok(calls > 0);
  const deliveredStatuses = statuses.length;
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(statuses.length, deliveredStatuses, 'late loader cannot change terminal status');
});

test('actual build starts no network work after the absolute deadline', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('[]'); });
  const result = await buildCoachParlay({
    requestedLegs: 6, askText: '6 leg NFL', signal: new AbortController().signal,
    requestStartedAtMs: Date.now() - coachTotalRequestBudgetMs(6) - 1,
  });
  assert.equal(result.timedOut, true);
  assert.equal(calls, 0);
});
