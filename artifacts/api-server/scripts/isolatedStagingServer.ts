/**
 * Isolated staging process for this SHA. It mounts the game, history, and
 * simulate routers without the production app's database, Clerk, or Render
 * process. PORT defaults to 8099. This is not a production deploy.
 */
import express from "express";
import gamesRouter from "../src/routes/games.ts";
import historyRouter from "../src/routes/history.ts";
import simulateRouter from "../src/routes/simulate.ts";

const port = Number(process.env.PORT || 8099);
const app = express();
app.use(express.json({ limit: "4mb" }));
const simulateStarts: Array<{ atMs: number; path: string }> = [];
app.use((req, _res, next) => {
  const log = {
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
  };
  (req as express.Request & { log: typeof log }).log = log;
  if (req.method === "POST" && req.originalUrl.includes("/sports/simulate/game-outcome")) {
    simulateStarts.push({ atMs: Date.now(), path: req.originalUrl.split("?")[0] ?? req.originalUrl });
  }
  next();
});
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, role: "isolated-staging", sha: process.env.STAGING_SHA ?? null });
});
app.get("/api/staging/simulate-starts", (_req, res) => {
  res.json({ starts: simulateStarts });
});
app.post("/api/staging/simulate-starts/reset", (_req, res) => {
  simulateStarts.length = 0;
  res.json({ ok: true });
});

/**
 * Board for the isolated pipeline. Prices are a staging fixture at -110,
 * not sportsbook closes. ODDS_API_KEY is unset, so this route does not call
 * the Odds API. `priceSource` is `staging-fixture`.
 */
app.get("/api/sports/odds", async (req, res) => {
  const sport = String(req.query.sport ?? "nfl").toLowerCase();
  const gamesRes = await fetch(
    `http://127.0.0.1:${port}/api/sports/games?sport=${encodeURIComponent(sport)}`,
  );
  const games = gamesRes.ok ? await gamesRes.json() : [];
  const book = (price: number, point?: number) => [
    { book: "staging-fixture", price, ...(point != null ? { point } : {}) },
  ];
  const rows = (Array.isArray(games) ? games : [])
    .filter((g) => g && typeof g === "object" && g.homeTeam && g.awayTeam && g.startsAt)
    .map((g) => ({
      id: `staging-${g.id}`,
      sport,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      commenceTime: g.startsAt,
      priceSource: "staging-fixture",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: g.homeTeam, price: -110, books: book(-110) },
            { name: g.awayTeam, price: -110, books: book(-110) },
          ],
        },
        {
          key: "spreads",
          outcomes: [
            { name: g.homeTeam, price: -110, point: -3.5, books: book(-110, -3.5) },
            { name: g.awayTeam, price: -110, point: 3.5, books: book(-110, 3.5) },
          ],
        },
        {
          key: "spreads_q3",
          outcomes: [
            { name: g.homeTeam, price: -110, point: -0.5, books: book(-110, -0.5) },
            { name: g.awayTeam, price: -110, point: 0.5, books: book(-110, 0.5) },
          ],
        },
      ],
    }));
  res.json(rows);
});
app.use("/api", gamesRouter);
app.use("/api", historyRouter);
app.use("/api", simulateRouter);

app.listen(port, () => {
  console.log(`isolated staging listening on ${port}`);
});
