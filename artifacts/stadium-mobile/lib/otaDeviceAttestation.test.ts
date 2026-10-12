import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_HEALTHY_EMBEDDED,
  EXPECTED_HEALTHY_RUNTIME,
  EXPECTED_HEALTHY_UPDATE_ID,
  caseCNativeModuleSafetyReport,
  classifyDeviceAttestation,
  expectedHealthyLines,
  isMissingOrEmbeddedUpdateId,
} from "./otaDeviceAttestation.ts";

test("expected healthy constants match ops brief", () => {
  assert.equal(EXPECTED_HEALTHY_RUNTIME, "1.1.0");
  assert.equal(EXPECTED_HEALTHY_UPDATE_ID, "01a12e0b-2bdc-75dd-944b-310a4eb5add5");
  assert.equal(EXPECTED_HEALTHY_EMBEDDED, false);
  assert.ok(expectedHealthyLines().some((l) => l.includes("1.1.0")));
});

test("Case A — runtime 1.1.0 + correct updateId + not embedded", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: EXPECTED_HEALTHY_UPDATE_ID,
    isEmbeddedLaunch: false,
  });
  assert.equal(r.caseId, "A");
  assert.equal(r.matchesExpectedUpdateId, true);
  assert.match(r.recoveryPath, /Do not republish OTA/i);
  assert.match(r.recoveryPath, /renderer/i);
});

test("Case A updateId match is case-insensitive", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: EXPECTED_HEALTHY_UPDATE_ID.toUpperCase(),
    isEmbeddedLaunch: false,
  });
  assert.equal(r.caseId, "A");
});

test("Case B — matching updateId but embedded launch wins", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: EXPECTED_HEALTHY_UPDATE_ID,
    isEmbeddedLaunch: true,
  });
  assert.equal(r.caseId, "B");
  assert.match(r.recoveryPath, /checkForUpdateAsync/i);
});

test("Case B — runtime 1.1.0 + wrong updateId", () => {
  const r = classifyDeviceAttestation({
    runtimeVersion: "1.1.0",
    updateId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    isEmbeddedLaunch: false,
  });
  assert.equal(r.caseId, "B");
  assert.equal(r.matchesExpectedUpdateId, false);
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
