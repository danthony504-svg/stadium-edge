import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCoachContext,
  coachContextBudgetMs,
} from "./coachContextBudget.ts";
test("context reserves scoring time without extending the request budget", () => {
  assert.equal(coachContextBudgetMs(45000), 8000);
  assert.equal(coachContextBudgetMs(22000), 4000);
  assert.equal(coachContextBudgetMs(17000), 0);
});
test("completed evidence and partial abort results survive a stalled loader", async () => {
  let signal: AbortSignal | undefined;
  const result = await collectCoachContext(
    [
      { fallback: "missing", run: async () => "fresh" },
      {
        fallback: [] as string[],
        run: async (s) => {
          signal = s;
          return new Promise<string[]>((r) =>
            s.addEventListener("abort", () => r(["completed-team"]), {
              once: true,
            }),
          );
        },
      },
      { fallback: null, run: async () => new Promise<null>(() => {}) },
    ] as const,
    20,
  );
  assert.deepEqual(result.values, ["fresh", ["completed-team"], null]);
  assert.equal(result.budgetExpired, true);
  assert.equal(signal?.aborted, true);
});
test("no optional work starts after reserve and parent cancellation is preserved", async () => {
  let calls = 0;
  const jobs = [
    {
      fallback: null,
      run: async () => {
        calls++;
        return null;
      },
    },
  ] as const;
  await collectCoachContext(jobs, 0);
  assert.equal(calls, 0);
  const parent = new AbortController();
  parent.abort();
  const result = await collectCoachContext(jobs, 100, parent.signal);
  assert.equal(calls, 0);
  assert.equal(result.budgetExpired, false);
});
test("late completions cannot mutate a returned report; failures stay missing", async () => {
  let complete!: (value: string) => void;
  const result = await collectCoachContext(
    [
      {
        fallback: "absent",
        run: () =>
          new Promise<string>((r) => {
            complete = r;
          }),
      },
      {
        fallback: "absent",
        run: async () => {
          throw Error("provider unavailable");
        },
      },
    ] as const,
    10,
  );
  complete("late");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(result.values, ["absent", "absent"]);
});
