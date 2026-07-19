import assert from "node:assert/strict";
import test from "node:test";
import {
  coachScrollBodyWouldBeBlank,
  resolveCoachRenderBranch,
} from "./coachRenderTrace.ts";
import { formatCoachBoardScanManifest, emptyCoachBoardScanManifest } from "./coachBoardScanManifest.ts";

const isWelcome = (m: { role: string; content?: string }) =>
  m.role === "assistant" && (m.content?.includes("Stadium Edge") ?? false);
const isParlayAsk = (t: string) => /\bbuild\b.*\bparlay\b/i.test(t) || /\d+\s*leg/i.test(t);

test("resolveCoachRenderBranch: impossible empty-without-prompts", () => {
  const r = resolveCoachRenderBranch({
    messages: [],
    streaming: false,
    buildFinishing: false,
    waiting: false,
    buildProgressExpired: false,
    parlayBuildPhase: "idle",
    showQuickPrompts: false,
    footerParlayProgress: false,
    isOrphanThread: false,
    isWelcome,
    isParlayAsk,
  });
  assert.equal(r.branch, "Blank");
  assert.match(r.blankReason ?? "", /messages\.length===0/);
});

test("resolveCoachRenderBranch: busy parlay assistant maps to progress branch", () => {
  const r = resolveCoachRenderBranch({
    messages: [
      { role: "user", content: "Build me a 5-leg parlay", picksCount: 0 },
      {
        role: "assistant",
        content: "",
        picksCount: 0,
        parlayBuild: true,
      },
    ],
    streaming: true,
    buildFinishing: true,
    waiting: false,
    buildProgressExpired: true,
    parlayBuildPhase: "context",
    showQuickPrompts: false,
    footerParlayProgress: false,
    isOrphanThread: false,
    isWelcome,
    isParlayAsk,
  });
  assert.equal(r.branch, "ProgressCard.message");
});

test("coachScrollBodyWouldBeBlank: raw picks filtered to zero at paint", () => {
  const r = coachScrollBodyWouldBeBlank({
    messages: [
      { role: "user", content: "Build me a 5-leg parlay", picksCount: 0, hideBubble: true },
      { role: "assistant", content: "", picksCount: 3, parlayBuild: true },
    ],
    showQuickPrompts: false,
    footerParlayProgress: false,
    lastDisplayPicksCount: 0,
    lastHasScanManifest: false,
    isWelcome,
  });
  assert.equal(r.blank, true);
  assert.match(r.reason ?? "", /raw pick\(s\) but filterCoachDeliveredPicks/);
});

test("legacy manifest missing pipeline arrays throws on format", () => {
  const m = { ...emptyCoachBoardScanManifest(5) } as Record<string, unknown>;
  delete m.pipelineRejections;
  delete m.relaxationsApplied;
  assert.throws(
    () => formatCoachBoardScanManifest(m as never),
    /Cannot read properties of undefined \(reading 'length'\)/,
  );
});

test("legacy manifest spread on pipelineRejections throws", () => {
  const m = { ...emptyCoachBoardScanManifest(5) } as Record<string, unknown>;
  delete m.pipelineRejections;
  assert.throws(() => [...(m.pipelineRejections as never[]), ...[]]);
});
