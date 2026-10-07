/**
 * Client App Review ticket helper + verify-flow contract tests.
 *
 * Uses a local mock HTTP server (no secrets in the bundle). Mirrors the
 * sign-in Verify path: ticket first, then Clerk OTP, incorrect → clear error.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { requestAppReviewTicket } from "./appReviewAuth.ts";

const INCORRECT = "Incorrect verification code";

type MockBody = { email?: string; code?: string };

async function startMockTicketServer(handler: (body: MockBody) => {
  status: number;
  json: Record<string, unknown>;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/auth/app-review-ticket")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: MockBody = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as MockBody;
    } catch {
      body = {};
    }
    const out = handler(body);
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.json));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** Route every app-review-ticket call to the local mock, regardless of API_BASE. */
function withTicketFetchMock<T>(
  port: number,
  run: () => Promise<T>,
): Promise<T> {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/app-review-ticket")) {
      return prevFetch(
        `http://127.0.0.1:${port}/api/auth/app-review-ticket`,
        init,
      );
    }
    return prevFetch(input, init);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = prevFetch;
  });
}

/** Mirrors sign-in handleVerify branching without Clerk/React. */
async function simulateVerifyFlow(opts: {
  email: string;
  code: string;
  requestTicket: typeof requestAppReviewTicket;
  clerkOtpOk: boolean;
  ticketSignInOk?: boolean;
}): Promise<{ outcome: "home" | "error"; message?: string }> {
  const review = await opts.requestTicket(opts.email, opts.code);
  if (review.ok) {
    if (opts.ticketSignInOk !== false) return { outcome: "home" };
    return {
      outcome: "error",
      message: "Couldn't finish App Review sign-in. Please try again.",
    };
  }
  if (opts.clerkOtpOk) return { outcome: "home" };
  return { outcome: "error", message: INCORRECT };
}

describe("requestAppReviewTicket (client)", () => {
  it("maps 200 + ticket → ok", async () => {
    const mock = await startMockTicketServer((body) => {
      assert.equal(body.email, "apple@stadiumedge.app");
      assert.equal(body.code, "REVIEW-OK");
      return { status: 200, json: { ok: true, ticket: "ticket_abc" } };
    });
    try {
      const result = await withTicketFetchMock(mock.port, () =>
        requestAppReviewTicket("apple@stadiumedge.app", "REVIEW-OK"),
      );
      assert.deepEqual(result, { ok: true, ticket: "ticket_abc" });
    } finally {
      await mock.close();
    }
  });

  it("maps 401 → rejected (incorrect code / non-review email)", async () => {
    const mock = await startMockTicketServer(() => ({
      status: 401,
      json: { error: "invalid credentials" },
    }));
    try {
      const result = await withTicketFetchMock(mock.port, () =>
        requestAppReviewTicket("apple@stadiumedge.app", "wrong"),
      );
      assert.deepEqual(result, { ok: false, reason: "rejected" });
    } finally {
      await mock.close();
    }
  });

  it("maps 404 → unavailable (Render path not configured)", async () => {
    const mock = await startMockTicketServer(() => ({
      status: 404,
      json: { error: "not available" },
    }));
    try {
      const result = await withTicketFetchMock(mock.port, () =>
        requestAppReviewTicket("apple@stadiumedge.app", "x"),
      );
      assert.deepEqual(result, { ok: false, reason: "unavailable" });
    } finally {
      await mock.close();
    }
  });

  it("does not embed APP_REVIEW_CODE in the client module source", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./appReviewAuth.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /APP_REVIEW_CODE\s*=/);
    assert.doesNotMatch(src, /SE-REVIEW|FIXED-CODE|REVIEW-SECRET/);
    assert.match(src, /\/auth\/app-review-ticket/);
  });
});

describe("verify flow (client contract)", () => {
  it("correct review ticket continues into the app", async () => {
    const out = await simulateVerifyFlow({
      email: "apple@stadiumedge.app",
      code: "REVIEW-OK",
      requestTicket: async () => ({ ok: true, ticket: "t1" }),
      clerkOtpOk: false,
      ticketSignInOk: true,
    });
    assert.deepEqual(out, { outcome: "home" });
  });

  it("incorrect review/OTP code shows Incorrect verification code", async () => {
    const out = await simulateVerifyFlow({
      email: "apple@stadiumedge.app",
      code: "nope",
      requestTicket: async () => ({ ok: false, reason: "rejected" }),
      clerkOtpOk: false,
    });
    assert.equal(out.outcome, "error");
    assert.equal(out.message, INCORRECT);
  });

  it("normal user with valid Clerk OTP still signs in", async () => {
    const out = await simulateVerifyFlow({
      email: "fan@example.com",
      code: "482913",
      requestTicket: async () => ({ ok: false, reason: "rejected" }),
      clerkOtpOk: true,
    });
    assert.deepEqual(out, { outcome: "home" });
  });
});
