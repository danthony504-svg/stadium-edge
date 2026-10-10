/**
 * Adversarial checks for free-user open-parlay /chat responses.
 * Ensures locked preview payloads cannot carry pick identity.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveCoachQaGate } from "../src/lib/coachAskAccess.ts";
import {
  assertLockedPreviewSafe,
  COACH_LOCKED_PARLAY_CTA,
  type LockedOpenParlayPreview,
} from "../src/lib/coachLockedPreviewSafety.ts";
import { redactPremiumPickForClient } from "../src/lib/coachSlateTypes.ts";

function simulateSseFrames(preview: LockedOpenParlayPreview): string[] {
  // Mirror chat.ts locked-preview frames exactly.
  const frames = [
    JSON.stringify({
      status: "Locked parlay preview",
      lockedPreview: true,
      pickCount: preview.pickCount,
      requestedLegs: preview.requestedLegs,
      cta: preview.cta,
    }),
    JSON.stringify({ content: preview.content }),
  ];
  if (preview.picks.length > 0) {
    frames.push(
      JSON.stringify({
        lockedPicks: preview.picks,
        pickCount: preview.pickCount,
      }),
    );
  }
  frames.push(JSON.stringify({ done: true, lockedPreview: true }));
  return frames;
}

test("unauthenticated open-parlay gate allows but must use locked preview path", () => {
  for (const ask of ["1 leg MLB", "2 leg parlay", "5 leg NFL", "9 leg", "15 leg parlay"]) {
    const g = resolveCoachQaGate({
      askText: ask,
      signedIn: false,
      premiumUnlocked: false,
    });
    assert.equal(g.allowed, true, ask);
    if (g.allowed) assert.equal(g.openParlay, true, ask);
  }
});

test("authenticated free-user Q&A still blocked; open parlay allowed", () => {
  assert.equal(
    resolveCoachQaGate({
      askText: "who wins tonight",
      signedIn: true,
      premiumUnlocked: false,
    }).allowed,
    false,
  );
  const open = resolveCoachQaGate({
    askText: "5 leg parlay",
    signedIn: true,
    premiumUnlocked: false,
  });
  assert.equal(open.allowed, true);
  if (open.allowed) assert.equal(open.openParlay, true);
});

test("SSE frames for locked preview contain no PICK lines or props keys", () => {
  const preview: LockedOpenParlayPreview = {
    content: "5 qualifying picks ready. Subscribe to reveal picks.",
    pickCount: 5,
    requestedLegs: 5,
    cta: COACH_LOCKED_PARLAY_CTA,
    picks: [
      redactPremiumPickForClient({
        game: "A @ B",
        market: "Spread",
        pick: "A -3.5",
        odds: -110,
        player: "Secret",
        startsAt: "2026-10-10T00:00:00Z",
        finalAiScore: { grade: "B+", confidencePct: 55, edgePct: 2, composite: 7 },
      }),
    ],
  };
  assert.deepEqual(assertLockedPreviewSafe(preview), []);
  const joined = simulateSseFrames(preview).join("\n");
  assert.doesNotMatch(joined, /\bPICK\s*:/i);
  assert.doesNotMatch(joined, /"props"\s*:/);
  assert.doesNotMatch(joined, /Secret/);
  assert.doesNotMatch(joined, /A @ B/);
  assert.match(joined, /lockedPreview/);
  assert.match(joined, /B\+/);
});

test("in-memory free-user state stores redacted picks", () => {
  const raw = {
    game: "Yankees @ Red Sox",
    market: "Moneyline",
    pick: "Yankees",
    odds: -130,
    player: undefined,
    startsAt: "2026-10-10T00:00:00Z",
    finalAiScore: { grade: "A-", confidencePct: 58, edgePct: 2.5, composite: 7.8 },
  };
  const stored = redactPremiumPickForClient(raw);
  assert.equal(stored.game, "••••••");
  assert.equal(stored.pick, "••••••");
  assert.equal(stored.odds, 0);
  assert.equal(stored.startsAt, null);
  assert.equal(stored.finalAiScore?.grade, "A-");
  assert.equal(stored.finalAiScore?.confidencePct, 58);
});

test("premium gate still allows full path classification", () => {
  const g = resolveCoachQaGate({
    askText: "who wins tonight",
    signedIn: true,
    premiumUnlocked: true,
  });
  assert.deepEqual(g, { allowed: true, openParlay: false });
});
