import { Router, type IRouter } from "express";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { rateLimit } from "../lib/sports";

const router: IRouter = Router();

// Register a real font family so server-side canvas text renders (headless Linux
// has no default canvas font). DejaVu ships with the base image. Registered once
// at module load; failures are swallowed so the route still responds (blank text
// is better than a 500, and the box virtually always has these fonts).
let FONTS_OK = false;
try {
  GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "SlipSans");
  GlobalFonts.registerFromPath("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "SlipSansBold");
  FONTS_OK = true;
} catch {
  FONTS_OK = false;
}
const REG = FONTS_OK ? "SlipSans" : "sans-serif";
const BOLD = FONTS_OK ? "SlipSansBold" : "sans-serif";

type Leg = { pick: string; market: string; game: string; odds: number | null };

// ---- Parlay math (American odds), computed server-side from REAL leg odds so
// the rendered image can never disagree with the slip. Legs without finite odds
// are excluded from the combined price (we never invent a number for them).
const toDecimal = (a: number): number => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const fromDecimal = (d: number): number =>
  d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
const fmtAmerican = (a: number | null): string =>
  a == null ? "—" : a > 0 ? `+${a}` : `${a}`;

router.use("/slip-image", rateLimit({ windowMs: 60_000, max: 30 }));

router.post("/slip-image", (req, res): void => {
  const body = (req.body ?? {}) as { legs?: unknown; stake?: unknown };
  const rawLegs = Array.isArray(body.legs) ? body.legs : [];
  const legs: Leg[] = rawLegs
    .slice(0, 40)
    .map((l): Leg | null => {
      if (!l || typeof l !== "object") return null;
      const o = l as Record<string, unknown>;
      const pick = typeof o.pick === "string" ? o.pick : "";
      if (!pick) return null;
      // Match the client's parlay math exactly: 0 is NOT a real price (it breaks
      // the decimal conversion), so treat it as "no odds" rather than inventing a
      // number. Only finite, non-zero American prices count toward the combined.
      const oddsNum =
        typeof o.odds === "number" && Number.isFinite(o.odds) && o.odds !== 0 ? o.odds : null;
      return {
        pick,
        market: typeof o.market === "string" ? o.market : "",
        game: typeof o.game === "string" ? o.game : "",
        odds: oddsNum,
      };
    })
    .filter((l): l is Leg => l !== null);

  if (legs.length === 0) {
    res.status(400).json({ error: "No legs provided" });
    return;
  }

  // Never invent a stake — use exactly what the client sent. A real $0 slip must
  // render $0 / "to win $0.00", not a fabricated $10. Only a non-numeric/NaN
  // value (never produced by the app) falls back to 0.
  const stake =
    typeof body.stake === "number" && Number.isFinite(body.stake) && body.stake >= 0
      ? body.stake
      : 0;

  const priced = legs.filter((l) => l.odds != null) as (Leg & { odds: number })[];
  const decimal = priced.reduce((acc, l) => acc * toDecimal(l.odds), 1);
  const combined = priced.length > 0 ? fromDecimal(decimal) : null;
  const payout = priced.length > 0 ? stake * decimal : stake;
  const toWin = payout - stake;
  const impliedPct = priced.length > 0 ? (1 / decimal) * 100 : 0;

  // ---- Geometry ----
  const W = 760;
  const PAD = 32;
  const scale = 2;
  const innerW = W - PAD * 2;
  const HEADER_H = 116;
  const ROW_H = 58;
  const SUM_ROW = 34;
  const SUM_H = 16 + SUM_ROW * 3 + 64 + 16; // 3 stat rows + a tall "to win" box
  const FOOT_H = 40;
  const listTop = HEADER_H + 8;
  const listH = legs.length * ROW_H;
  const sumTop = listTop + listH + 18;
  const H = sumTop + SUM_H + FOOT_H;

  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  const rr = (x: number, y: number, w: number, h: number, r: number): void => {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  const fit = (text: string, maxW: number, font: string): string => {
    ctx.font = font;
    let t = String(text ?? "");
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
  };

  // ---- Background ----
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b1426");
  bg.addColorStop(1, "#070c16");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 40, 0, W / 2, 40, 360);
  glow.addColorStop(0, "rgba(56,189,248,0.12)");
  glow.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 220);

  // ---- Header ----
  ctx.textAlign = "left";
  ctx.fillStyle = "#38bdf8";
  ctx.font = `30px ${BOLD}`;
  ctx.fillText("STADIUM EDGE", PAD, 52);
  ctx.fillStyle = "#94a3b8";
  ctx.font = `15px ${REG}`;
  ctx.fillText(
    `BET SLIP · ${legs.length} ${legs.length === 1 ? "LEG" : "LEGS"}`,
    PAD,
    78,
  );
  ctx.textAlign = "right";
  ctx.fillStyle = "#64748b";
  ctx.font = `13px ${REG}`;
  ctx.fillText(
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    W - PAD,
    52,
  );
  // header divider
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H - 8);
  ctx.lineTo(W - PAD, HEADER_H - 8);
  ctx.stroke();

  // ---- Legs ----
  legs.forEach((leg, i) => {
    const y = listTop + i * ROW_H;
    const oddsTxt = fmtAmerican(leg.odds);
    ctx.textAlign = "right";
    ctx.font = `17px ${BOLD}`;
    ctx.fillStyle = leg.odds != null && leg.odds > 0 ? "#22c55e" : "#38bdf8";
    ctx.fillText(oddsTxt, W - PAD, y + 24);
    const oddsW = ctx.measureText(oddsTxt).width;

    const textMaxW = innerW - oddsW - 24;
    ctx.textAlign = "left";
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(fit(leg.pick, textMaxW, `17px ${BOLD}`), PAD, y + 22);
    const sub = [leg.market, leg.game].filter(Boolean).join(" · ");
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(fit(sub, textMaxW, `13px ${REG}`), PAD, y + 42);

    ctx.strokeStyle = "rgba(148,163,184,0.14)";
    ctx.beginPath();
    ctx.moveTo(PAD, y + ROW_H - 1);
    ctx.lineTo(W - PAD, y + ROW_H - 1);
    ctx.stroke();
  });

  // ---- Summary ----
  let sy = sumTop + 24;
  const statRow = (label: string, value: string, valueColor: string): void => {
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.font = `14px ${REG}`;
    ctx.fillText(label, PAD, sy);
    ctx.textAlign = "right";
    ctx.fillStyle = valueColor;
    ctx.font = `16px ${BOLD}`;
    ctx.fillText(value, W - PAD, sy);
    sy += SUM_ROW;
  };
  statRow("Combined odds", fmtAmerican(combined), "#f1f5f9");
  statRow("Implied win probability", `${impliedPct.toFixed(1)}%`, "#f1f5f9");
  statRow("Stake", `$${stake.toFixed(0)}`, "#f1f5f9");

  // "To win" highlight box
  const boxY = sy - 12;
  const boxH = 52;
  ctx.fillStyle = "rgba(34,197,94,0.12)";
  rr(PAD, boxY, innerW, boxH, 12);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.fillStyle = "#22c55e";
  ctx.font = `16px ${BOLD}`;
  ctx.fillText("To win", PAD + 16, boxY + 33);
  ctx.textAlign = "right";
  ctx.font = `24px ${BOLD}`;
  ctx.fillText(`$${toWin.toFixed(2)}`, W - PAD - 16, boxY + 35);

  // ---- Footer ----
  ctx.textAlign = "center";
  ctx.fillStyle = "#475569";
  ctx.font = `12px ${REG}`;
  ctx.fillText(
    "Real sportsbook odds at time of generation · For entertainment only",
    W / 2,
    H - 16,
  );

  const png = canvas.toBuffer("image/png").toString("base64");
  res.json({ png });
});

export default router;
