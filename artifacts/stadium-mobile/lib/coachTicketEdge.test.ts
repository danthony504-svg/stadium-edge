import assert from "node:assert/strict";
import test from "node:test";
import {
  averageTicketEdge,
  shouldReoptimizeTicketEdge,
  TICKET_EDGE_REOPT_MARGIN_PCT,
  weakestEdgeLegIndex,
} from "./coachTicketEdge.ts";

test("TICKET_EDGE_REOPT_MARGIN_PCT is 1", () => {
  assert.equal(TICKET_EDGE_REOPT_MARGIN_PCT, 1);
});

test("shouldReoptimizeTicketEdge flags -0.9% but not -1.5%", () => {
  assert.equal(shouldReoptimizeTicketEdge(-0.9), true);
  assert.equal(shouldReoptimizeTicketEdge(-0.1), true);
  assert.equal(shouldReoptimizeTicketEdge(0), false);
  assert.equal(shouldReoptimizeTicketEdge(0.5), false);
  assert.equal(shouldReoptimizeTicketEdge(-1.5), false);
  assert.equal(shouldReoptimizeTicketEdge(null), false);
});

test("averageTicketEdge rounds to one decimal", () => {
  const avg = averageTicketEdge([
    { finalAiScore: { edgePct: -1.2 } },
    { scores: { edgePct: 0.6 } },
  ]);
  assert.equal(avg, -0.3);
});

test("weakestEdgeLegIndex picks lowest edge leg", () => {
  const idx = weakestEdgeLegIndex([
    { finalAiScore: { edgePct: 1.2 } },
    { finalAiScore: { edgePct: -0.8 } },
    { finalAiScore: { edgePct: 0.4 } },
  ]);
  assert.equal(idx, 1);
});
