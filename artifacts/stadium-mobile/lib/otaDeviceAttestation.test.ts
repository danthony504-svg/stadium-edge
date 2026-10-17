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
  assert.match(formatChannelTipMatchLabel(true), /yes/i);
  assert.match(formatChannelTipMatchLabel(false), /no/i);
  assert.match(formatChannelTipMatchLabel(null), /unknown/i);
});
