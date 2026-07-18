import assert from "node:assert/strict";
import { test } from "node:test";

import { initialCoachProgress } from "./coachProgressState.ts";
import { lockCoachProgressDeadEnd } from "./coachProgressMessages.ts";

test("lockCoachProgressDeadEnd marks terminal without ticket", () => {
  const requestId = "req-dead";
  const messages = [
    {
      role: "assistant",
      requestId,
      coachProgress: {
        ...initialCoachProgress(requestId),
        stage: "building-ticket" as const,
        percent: 92,
        propsComplete: true,
        edgeComplete: true,
        simulationsComplete: true,
      },
    },
  ];
  const next = lockCoachProgressDeadEnd(messages, requestId);
  assert.equal(next[0]?.coachProgress?.terminal, true);
  assert.equal(next[0]?.coachProgress?.ticketComplete, false);
});
