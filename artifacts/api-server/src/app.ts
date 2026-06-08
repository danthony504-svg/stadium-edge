import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// The API runs behind Replit's proxy (and any load balancer in a multi-instance
// deployment), so the real client address arrives in X-Forwarded-For. Trust it
// so `req.ip` is the actual client IP — this is what makes the per-IP rate
// limits behave per-user instead of collapsing to one shared proxy IP.
app.set("trust proxy", true);

// Express auto-generates a weak ETag for every JSON response. On native,
// expo/fetch surfaces a 304 Not Modified (the OS HTTP cache revalidating a URL a
// previous screen already fetched) as a non-ok response with an EMPTY body — and
// the mobile client's getJson treats any non-2xx as a failure (-> [] fallback).
// The AI Coach re-fetches odds/games that the Home/Props screens already cached,
// so those requests came back 304 and were silently dropped, leaving the chat
// context empty — the coach then truthfully but wrongly reported "no games
// tonight" on a full slate. Live odds must never be served from a stale client
// cache anyway, so disable ETags and mark every /api response no-store: each
// request gets a fresh 200 with a body. Upstream cost is unaffected — the server
// keeps its own in-memory cache (cachedJson) for the actual data providers.
app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Mount the Clerk proxy before body parsers (it streams raw bytes).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
