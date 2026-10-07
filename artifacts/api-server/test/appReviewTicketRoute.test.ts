/**
 * Local HTTP contract for the App Review ticket gate (same credential helpers
 * as the production route). Avoids Clerk so CI/local can prove env gating
 * without CLERK_SECRET_KEY.
 */
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { describe, it } from "node:test";
import {
  matchesAppReviewCredentials,
  normalizeReviewEmail,
  readAppReviewEnv,
} from "../src/lib/appReviewAuth";

const REVIEW_EMAIL = "apple@stadiumedge.app";
const REVIEW_CODE = "LOCAL-TEST-CODE";

async function withEnv<T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    prev[key] = process.env[key];
    const next = env[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Mirrors production route credential gate + ticket mint seam. */
function mountTicketGate(app: express.Express, mint: () => string) {
  app.post("/api/auth/app-review-ticket", (req, res) => {
    const configured = readAppReviewEnv();
    if (!configured) {
      res.status(404).json({ error: "not available" });
      return;
    }
    const email = normalizeReviewEmail(
      typeof req.body?.email === "string" ? req.body.email : "",
    );
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!email || !code) {
      res.status(400).json({ error: "email and code required" });
      return;
    }
    if (!matchesAppReviewCredentials(email, code, configured)) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    res.json({ ok: true, ticket: mint() });
  });
}

async function withServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  mountTicketGate(app, () => "ticket_local_ok");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

async function postTicket(baseUrl: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api/auth/app-review-ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

describe("POST /api/auth/app-review-ticket (local gate)", () => {
  it("returns 404 not available when APP_REVIEW_* unset", async () => {
    await withEnv(
      { APP_REVIEW_EMAIL: undefined, APP_REVIEW_CODE: undefined },
      async () => {
        await withServer(async (baseUrl) => {
          const out = await postTicket(baseUrl, {
            email: REVIEW_EMAIL,
            code: REVIEW_CODE,
          });
          assert.equal(out.status, 404);
          assert.equal(out.json.error, "not available");
        });
      },
    );
  });

  it("returns 401 for wrong code when path enabled", async () => {
    await withEnv(
      { APP_REVIEW_EMAIL: REVIEW_EMAIL, APP_REVIEW_CODE: REVIEW_CODE },
      async () => {
        await withServer(async (baseUrl) => {
          const out = await postTicket(baseUrl, {
            email: REVIEW_EMAIL,
            code: "WRONG",
          });
          assert.equal(out.status, 401);
          assert.equal(out.json.error, "invalid credentials");
        });
      },
    );
  });

  it("returns 401 for non-review email even with correct code", async () => {
    await withEnv(
      { APP_REVIEW_EMAIL: REVIEW_EMAIL, APP_REVIEW_CODE: REVIEW_CODE },
      async () => {
        await withServer(async (baseUrl) => {
          const out = await postTicket(baseUrl, {
            email: "fan@example.com",
            code: REVIEW_CODE,
          });
          assert.equal(out.status, 401);
          assert.equal(out.json.error, "invalid credentials");
        });
      },
    );
  });

  it("mints ticket for designated email + correct code", async () => {
    await withEnv(
      { APP_REVIEW_EMAIL: REVIEW_EMAIL, APP_REVIEW_CODE: REVIEW_CODE },
      async () => {
        await withServer(async (baseUrl) => {
          const out = await postTicket(baseUrl, {
            email: "Apple@Stadiumedge.app",
            code: REVIEW_CODE,
          });
          assert.equal(out.status, 200);
          assert.equal(out.json.ok, true);
          assert.equal(out.json.ticket, "ticket_local_ok");
          assert.equal(JSON.stringify(out.json).includes(REVIEW_CODE), false);
        });
      },
    );
  });
});
