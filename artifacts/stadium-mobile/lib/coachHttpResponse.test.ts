import assert from "node:assert/strict";
import test from "node:test";

import { classifyCoachHttpResponse } from "./api.ts";

test("HTTP 200 with valid picks is a successful stream response", () => {
  assert.equal(classifyCoachHttpResponse({ ok: true, status: 200, hasBody: true }), "stream");
});

test("HTTP 200 with an empty Coach result completes without failure", () => {
  assert.equal(classifyCoachHttpResponse({ ok: true, status: 200, hasBody: false }), "empty-success");
});

test("HTTP 204 completes without failure", () => {
  assert.equal(classifyCoachHttpResponse({ ok: true, status: 204, hasBody: false }), "empty-success");
});

test("HTTP 400 and 500 are failures", () => {
  assert.equal(classifyCoachHttpResponse({ ok: false, status: 400, hasBody: true }), "failure");
  assert.equal(classifyCoachHttpResponse({ ok: false, status: 500, hasBody: true }), "failure");
});
