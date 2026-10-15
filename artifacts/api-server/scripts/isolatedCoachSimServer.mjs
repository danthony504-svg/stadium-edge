/**
 * Tip-SHA isolated Coach sim server (no DATABASE_URL).
 * Mounts only /api/sports/simulate* from this checkout; other paths 404
 * (caller should proxy or dual-fetch for odds/props).
 *
 *   PORT=8787 node --import ./test/register-hooks.mjs ./scripts/isolatedCoachSimServer.mjs
 */
import express from "express";
import simulateRouter from "../src/routes/simulate.ts";
import historyRouter from "../src/routes/history.ts";
import defenseRouter from "../src/routes/defense.ts";
import propsRouter from "../src/routes/props.ts";
import liveOddsRouter from "../src/routes/liveOdds.ts";

const port = Number(process.env.PORT || 8787);
const app = express();
app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "5mb" }));

app.get("/api/healthz", (_req, res) => {
  res.json({
    status: "ok",
    isolated: true,
    role: "coach-sim",
    sha: process.env.REVIEWED_SHA || null,
  });
});

app.use("/api", simulateRouter);
app.use("/api", historyRouter);
app.use("/api", defenseRouter);
app.use("/api", propsRouter);
app.use("/api", liveOddsRouter);

app.listen(port, () => {
  console.log(`[isolated-coach-sim] listening on ${port} sha=${process.env.REVIEWED_SHA || "?"}`);
});
