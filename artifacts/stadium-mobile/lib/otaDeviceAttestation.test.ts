import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_HEALTHY_EMBEDDED,
  EXPECTED_HEALTHY_RUNTIME,
  caseCNativeModuleSafetyReport,
  classifyDeviceAttestation,
  expectedHealthyLines,
  formatChannelTipMatchLabel,
  formatOtaChannelStreamLabel,
  isKnownChannelTipUpdateId,
  isMissingOrEmbeddedUpdateId,
  resolveChannelTipMatch,
  resolveKnownChannelTipUpdateId,
} from "./otaDeviceAttestation.ts";

test("healthy criteria do not hardcode a historical updateId", () => {
  assert.equal(EXPECTED_HEALTHY_RUNTIME, "1.1.0");
  assert.equal(EXPECTED_HEALTHY_EMBEDDED, false);
  const lines = expectedHealthyLines({ channel: "preview" });
  assert.ok(lines.some((l) => l.includes("1.1.0")));
  assert.ok(lines.some((l) => /PREVIEW/i.test(l)));
  assert.ok(!lines.some((l) => /01a13582/i.test(l)));
  assert.ok(!lines.some((l) => /^expected updateId:/i.test(l)));
});

test("channel stream labels are screenshot-safe", () => {
  assert.equal(formatOtaChannelStreamLabel("preview"), "PREVIEW");
  assert.equal(formatOtaChannelStreamLabel("production"), "PRODUCTION");
  assert.equal(formatOtaChannelStreamLabel(""), "UNKNOWN");
});

test("Case A — runtime 1.1.0 + non-embedded + tip unknown", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "01a14afd-f1f8-7752-bbd1-6ddda65568ff",
    isEmbeddedLaunch: false,
    channel: "preview",
  });
  assert.equal(r.caseId, "A");
  assert.equal(r.matchesChannelTip, null);
  assert.equal(r.channelStreamLabel, "PREVIEW");
  assert.match(r.summary, /PREVIEW/);
  assert.match(r.summary, /channel tip not probed/i);
});

test("Case A — unknown tip sentinel 'not available' is not a known mismatch", () => {
  // Regression: snapshot stores OTA_DEBUG_UNAVAILABLE when latestManifest.id is
  // absent; that must not become behind-tip Case B.
  const running = "01a14bb3-1046-746c-afa4-722338e3ef7c";
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: running,
    isEmbeddedLaunch: false,
    channel: "preview",
    channelTipUpdateId: "not available",
  });
  assert.equal(r.caseId, "A");
  assert.equal(r.matchesChannelTip, null);
  assert.notEqual(r.label, "Case B — running update is not the known channel tip");
  assert.match(r.summary, /channel tip not probed/i);
  assert.equal(isKnownChannelTipUpdateId("not available"), false);
});

test("Case A — unknown tip sentinels (unavailable / unknown / em-dash)", () => {
  for (const tip of ["unavailable", "unknown", "—", "", null] as const) {
    const r = classifyDeviceAttestation({
      runtimeVersion: "1.1.0",
      updateId: "01a14bb3-1046-746c-afa4-722338e3ef7c",
      isEmbeddedLaunch: false,
      channel: "preview",
      channelTipUpdateId: tip,
    });
    assert.equal(r.caseId, "A", `tip=${String(tip)}`);
    assert.equal(r.matchesChannelTip, null, `tip=${String(tip)}`);
  }
});

test("Case A — running update equals known channel tip", () => {
  const tip = "01a14afd-f1f8-7752-bbd1-6ddda65568ff";
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: tip,
    isEmbeddedLaunch: false,
    channel: "preview",
    channelTipUpdateId: tip,
  });
  assert.equal(r.caseId, "A");
  assert.equal(r.matchesChannelTip, true);
  assert.equal(r.matchesExpectedUpdateId, true);
  assert.match(r.summary, /matches current channel tip/i);
});

test("Case B — running update behind known channel tip", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "01a14ab5-1271-7d9e-9b76-bdfc53a31197",
    isEmbeddedLaunch: false,
    channel: "preview",
    channelTipUpdateId: "01a14afd-f1f8-7752-bbd1-6ddda65568ff",
  });
  assert.equal(r.caseId, "B");
  assert.equal(r.matchesChannelTip, false);
  assert.match(r.label, /not the known channel tip/i);
});

test("Case B — rollback scenario: running older tip vs newer known tip", () => {
  // Device still on rollback content while channel tip advanced.
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "01a14afd-f1f8-7752-bbd1-6ddda65568ff",
    isEmbeddedLaunch: false,
    channel: "preview",
    channelTipUpdateId: "01a14bb3-1046-746c-afa4-722338e3ef7c",
  });
  assert.equal(r.caseId, "B");
  assert.equal(r.matchesChannelTip, false);
  assert.equal(r.channelStreamLabel, "PREVIEW");
  assert.match(r.label, /not the known channel tip/i);
});

test("preview vs production stream labels stay separated on tip mismatch", () => {
  const preview = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "aaa",
    isEmbeddedLaunch: false,
    channel: "preview",
    channelTipUpdateId: "bbb",
  });
  const production = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "aaa",
    isEmbeddedLaunch: false,
    channel: "production",
    channelTipUpdateId: "bbb",
  });
  assert.equal(preview.caseId, "B");
  assert.equal(production.caseId, "B");
  assert.equal(preview.channelStreamLabel, "PREVIEW");
  assert.equal(production.channelStreamLabel, "PRODUCTION");
  assert.match(preview.summary, /PREVIEW/);
  assert.match(production.summary, /PRODUCTION/);
});

test("Case A tip match is case-insensitive", () => {
  const tip = "01a14afd-f1f8-7752-bbd1-6ddda65568ff";
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: tip.toUpperCase(),
    isEmbeddedLaunch: false,
    channel: "production",
    channelTipUpdateId: tip,
  });
  assert.equal(r.caseId, "A");
  assert.equal(r.matchesChannelTip, true);
  assert.equal(r.channelStreamLabel, "PRODUCTION");
});

test("Case B — matching tip but embedded launch wins", () => {
  const tip = "01a14afd-f1f8-7752-bbd1-6ddda65568ff";
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: tip,
    isEmbeddedLaunch: true,
    channel: "production",
    channelTipUpdateId: tip,
  });
  assert.equal(r.caseId, "B");
  assert.match(r.recoveryPath, /checkForUpdateAsync/i);
});

test("Case B — runtime 1.1.0 + blank updateId + embedded", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "",
    isEmbeddedLaunch: true,
    channel: "preview",
  });
  assert.equal(r.caseId, "B");
  assert.equal(r.matchesChannelTip, null);
  assert.match(r.recoveryPath, /before republishing/i);
  assert.match(r.recoveryPath, /ota-recovery/i);
});

test("Case B — runtime 1.1.0 + missing updateId + embedded", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "embedded",
    isEmbeddedLaunch: true,
  });
  assert.equal(r.caseId, "B");
  assert.equal(isMissingOrEmbeddedUpdateId("embedded"), true);
});

test("Case C — runtime 1.0.3", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.0.3",
    updateId: "anything",
    isEmbeddedLaunch: true,
    appVersion: "1.0.3",
  });
  assert.equal(r.caseId, "C");
  assert.equal(r.isLegacyRuntime, true);
  assert.match(r.recoveryPath, /cannot receive the 1\.1\.0 OTA/i);
  assert.match(r.recoveryPath, /RNPurchases/i);
  assert.match(r.recoveryPath, /NOT technically safe/i);
  assert.match(r.recoveryPath, /Do not create a native build yet/i);
});

test("Case C — runtime 1.0.0", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.0.0",
    updateId: "—",
    isEmbeddedLaunch: true,
  });
  assert.equal(r.caseId, "C");
});

test("Case C native-module safety report refuses main→1.0.3 Coach OTA", () => {
  const report = caseCNativeModuleSafetyReport();
  assert.match(report, /UNSAFE/i);
  assert.match(report, /RNPurchases/i);
  assert.match(report, /force-update/i);
  assert.match(report, /do not publish main-only OTA/i);
});

test("UNKNOWN runtime asks for capture before publish", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "9.9.9",
    updateId: "x",
    isEmbeddedLaunch: false,
  });
  assert.equal(r.caseId, "UNKNOWN");
  assert.match(r.recoveryPath, /ota-recovery/i);
});

test("resolveKnownChannelTipUpdateId prefers check, then context, then idle tip", () => {
  assert.equal(
    resolveKnownChannelTipUpdateId({
      availableUpdateIdFromCheck: "aaa",
      availableUpdateIdFromContext: "bbb",
      runningUpdateId: "ccc",
    }),
    "aaa",
  );
  assert.equal(
    resolveKnownChannelTipUpdateId({
      availableUpdateIdFromContext: "bbb",
      runningUpdateId: "ccc",
    }),
    "bbb",
  );
  assert.equal(
    resolveKnownChannelTipUpdateId({
      runningUpdateId: "ccc",
      updateAvailable: false,
      isEmbeddedLaunch: false,
    }),
    "ccc",
  );
  assert.equal(
    resolveKnownChannelTipUpdateId({
      runningUpdateId: "ccc",
      updateAvailable: null,
      isEmbeddedLaunch: false,
    }),
    null,
  );
});

test("resolveKnownChannelTipUpdateId rejects 'not available' context sentinel", () => {
  assert.equal(
    resolveKnownChannelTipUpdateId({
      availableUpdateIdFromContext: "not available",
      runningUpdateId: "01a14bb3-1046-746c-afa4-722338e3ef7c",
      updateAvailable: null,
      isEmbeddedLaunch: false,
    }),
    null,
  );
  assert.equal(
    resolveKnownChannelTipUpdateId({
      availableUpdateIdFromCheck: "not available",
      availableUpdateIdFromContext: "unknown",
      runningUpdateId: "01a14bb3-1046-746c-afa4-722338e3ef7c",
    }),
    null,
  );
  // Idle tip path still works when check reports no update available.
  assert.equal(
    resolveKnownChannelTipUpdateId({
      availableUpdateIdFromContext: "not available",
      runningUpdateId: "01a14bb3-1046-746c-afa4-722338e3ef7c",
      updateAvailable: false,
      isEmbeddedLaunch: false,
    }),
    "01a14bb3-1046-746c-afa4-722338e3ef7c",
  );
});

test("resolveChannelTipMatch / format labels", () => {
  assert.equal(
    resolveChannelTipMatch({
      runningUpdateId: "01a14afd",
      channelTipUpdateId: "01A14AFD",
    }),
    true,
  );
  assert.equal(
    resolveChannelTipMatch({
      runningUpdateId: "a",
      channelTipUpdateId: "b",
    }),
    false,
  );
  assert.equal(
    resolveChannelTipMatch({
      runningUpdateId: "a",
      channelTipUpdateId: null,
    }),
    null,
  );
  assert.equal(
    resolveChannelTipMatch({
      runningUpdateId: "01a14bb3-1046-746c-afa4-722338e3ef7c",
      channelTipUpdateId: "not available",
    }),
    null,
  );
  assert.match(formatChannelTipMatchLabel(true), /yes/i);
  assert.match(formatChannelTipMatchLabel(false), /no/i);
  assert.match(formatChannelTipMatchLabel(null), /unknown/i);
});
