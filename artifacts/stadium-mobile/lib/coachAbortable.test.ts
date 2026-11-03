import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachWorkTimeout, runCoachBounded } from './coachAbortable.ts';

test('hung dependency ignoring abort settles at deadline and child work is aborted', async () => {
  let child: AbortSignal | undefined;
  await assert.rejects(runCoachBounded(signal => { child = signal; return new Promise(() => {}); }, 15), CoachWorkTimeout);
  assert.equal(child?.aborted, true);
});
test('cancellation settles hung work without waiting for its timeout', async () => {
  const parent = new AbortController();
  let child: AbortSignal | undefined;
  const result = runCoachBounded(signal => { child = signal; return new Promise(() => {}); }, 60_000, parent.signal);
  await Promise.resolve();
  parent.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(child?.aborted, true);
});
test('completed work removes its timer and parent listener', async () => {
  const parent = new AbortController();
  assert.equal(await runCoachBounded(async () => 42, 60_000, parent.signal), 42);
  parent.abort();
});
test('expired or cancelled requests do not start new work', async () => {
  let calls = 0;
  const work = async () => ++calls;
  await assert.rejects(runCoachBounded(work, 0), CoachWorkTimeout);
  const parent = new AbortController(); parent.abort();
  await assert.rejects(runCoachBounded(work, 60_000, parent.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
});
test('late rejection after timeout is consumed', async () => {
  let reject!: (reason: Error) => void;
  await assert.rejects(runCoachBounded(() => new Promise((_, r) => { reject = r; }), 5), CoachWorkTimeout);
  reject(new Error('late network failure'));
  await new Promise(resolve => setImmediate(resolve));
});
