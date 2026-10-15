/**
 * Isolated staging process for this SHA. It mounts the game, history, and
 * simulate routers without the production app's database, Clerk, or Render
 * process. PORT defaults to 8099. This is not a production deploy.
 */
import express from "express";
import gamesRouter from "../src/routes/games.ts";
import historyRouter from "../src/routes/history.ts";
import simulateRouter from "../src/routes/simulate.ts";

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use((req, _res, next) => {
  const log = {
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
  };
  (req as express.Request & { log: typeof log }).log = log;
  next();
});
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, role: "isolated-staging", sha: process.env.STAGING_SHA ?? null });
});
app.use("/api", gamesRouter);
app.use("/api", historyRouter);
app.use("/api", simulateRouter);

const port = Number(process.env.PORT || 8099);
app.listen(port, () => {
  console.log(`isolated staging listening on ${port}`);
});
