import assert from "node:assert/strict";
import test from "node:test";
import { planCoachMessagePaint } from "./coachDisplayPicks.ts";
import { normalizeCoachBoardScanManifest, formatCoachBoardScanManifest, emptyCoachBoardScanManifest } from "./coachBoardScanManifest.ts";

test("planCoachMessagePaint: scanning shows progress card", () => {
  const plan = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 0,
    displayPicksCount: 0,
    hasScanManifest: false,
    hasLegNote: false,
    hasCoachDetailNote: false,
    parlayBuildIntent: true,
    streaming: true,
    buildFinishing: true,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    isBuildingParlay: false,
    parlayStillBuilding: true,
    parlayStillFilling: false,
    parlayBuildHung: false,
    analyzeWaiting: false,
    askWaiting: false,
    showBubble: false,
  });
  assert.equal(plan.showProgress, true);
  assert.equal(plan.bodyWouldBeBlank, false);
});

test("planCoachMessagePaint: picks show results", () => {
  const plan = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 3,
    displayPicksCount: 3,
    hasScanManifest: false,
    hasLegNote: false,
    hasCoachDetailNote: false,
    parlayBuildIntent: true,
    streaming: false,
    buildFinishing: false,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    isBuildingParlay: false,
    parlayStillBuilding: false,
    parlayStillFilling: false,
    parlayBuildHung: false,
    analyzeWaiting: false,
    askWaiting: false,
    showBubble: false,
  });
  assert.equal(plan.showPickCards, true);
  assert.equal(plan.showTicketHeader, true);
  assert.equal(plan.bodyWouldBeBlank, false);
});

test("planCoachMessagePaint: zero picks after build shows empty/manifest", () => {
  const plan = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 0,
    displayPicksCount: 0,
    hasScanManifest: true,
    hasLegNote: true,
    hasCoachDetailNote: true,
    parlayBuildIntent: true,
    streaming: false,
    buildFinishing: false,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    isBuildingParlay: false,
    parlayStillBuilding: false,
    parlayStillFilling: false,
    parlayBuildHung: false,
    analyzeWaiting: false,
    askWaiting: false,
    showBubble: false,
  });
  assert.equal(plan.showEmptyState, true);
  assert.equal(plan.showTicketHeader, true);
  assert.equal(plan.bodyWouldBeBlank, false);
});

test("planCoachMessagePaint: gated partial scan shows progress not cards", () => {
  const plan = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 5,
    displayPicksCount: 5,
    hasScanManifest: false,
    hasLegNote: false,
    hasCoachDetailNote: false,
    parlayBuildIntent: true,
    streaming: true,
    buildFinishing: true,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    isBuildingParlay: false,
    parlayStillBuilding: true,
    parlayStillFilling: true,
    parlayBuildHung: false,
    analyzeWaiting: false,
    askWaiting: false,
    showBubble: false,
    ticketLegTarget: 15,
    scanComplete: false,
    stagedPickCount: 5,
  });
  assert.equal(plan.showPickCards, false);
  assert.equal(plan.showProgress, true);
});

test("planCoachMessagePaint: raw picks with display picks never blank while building", () => {
  const plan = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 2,
    displayPicksCount: 2,
    hasScanManifest: false,
    hasLegNote: false,
    hasCoachDetailNote: false,
    parlayBuildIntent: true,
    streaming: true,
    buildFinishing: true,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    isBuildingParlay: false,
    parlayStillBuilding: true,
    parlayStillFilling: true,
    parlayBuildHung: false,
    analyzeWaiting: false,
    askWaiting: false,
    showBubble: false,
  });
  assert.equal(plan.showPickCards, true);
  assert.equal(plan.showTicketHeader, true);
  assert.equal(plan.bodyWouldBeBlank, false);
});

test("planCoachMessagePaint: no state leaves body blank when progress or header paints", () => {
  const scanning = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 0,
    displayPicksCount: 0,
    hasScanManifest: false,
    hasLegNote: false,
    hasCoachDetailNote: false,
    parlayBuildIntent: true,
    streaming: true,
    buildFinishing: true,
    waiting: true,
    isLastMessage: true,
    contentLen: 0,
    askWaiting: true,
    parlayStillBuilding: true,
    parlayBuildHung: false,
    showBubble: false,
  });
  assert.equal(scanning.bodyWouldBeBlank, false);

  const results = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 5,
    displayPicksCount: 5,
    hasScanManifest: false,
    hasLegNote: false,
    hasCoachDetailNote: false,
    parlayBuildIntent: true,
    streaming: false,
    buildFinishing: false,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    showBubble: false,
  });
  assert.equal(results.bodyWouldBeBlank, false);

  const empty = planCoachMessagePaint({
    role: "assistant",
    rawPicksCount: 0,
    displayPicksCount: 0,
    hasScanManifest: true,
    hasLegNote: true,
    hasCoachDetailNote: true,
    parlayBuildIntent: true,
    streaming: false,
    buildFinishing: false,
    waiting: false,
    isLastMessage: true,
    contentLen: 0,
    showBubble: false,
  });
  assert.equal(empty.bodyWouldBeBlank, false);
});

test("normalizeCoachBoardScanManifest fills missing pipeline fields", () => {
  const legacy = { ...emptyCoachBoardScanManifest(5) } as Record<string, unknown>;
  delete legacy.pipelineRejections;
  delete legacy.relaxationsApplied;
  delete legacy.pipelineStages;
  const normalized = normalizeCoachBoardScanManifest(legacy as never);
  assert.ok(Array.isArray(normalized.pipelineRejections));
  assert.ok(Array.isArray(normalized.relaxationsApplied));
  assert.doesNotThrow(() => formatCoachBoardScanManifest(normalized));
});
