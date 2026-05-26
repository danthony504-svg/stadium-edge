import { Router, type IRouter } from "express";
import OpenAI from "openai";
import { SendChatMessageBody } from "@workspace/api-zod";
import { rateLimit } from "../lib/sports.js";

const router: IRouter = Router();

// Cap expensive AI calls: ~20 chats per IP per minute.
router.use("/chat", rateLimit({ windowMs: 60_000, max: 20 }));

const SYSTEM_PROMPT = `You are Stadium Edge, an AI sports betting analyst.
You help users analyze parlays, picks, and live games across NFL, NBA, MLB, NHL, Soccer, NCAAF, NCAAB, and UFC.
You weigh: odds value, recent player form, coach tendencies, referee leans, injury impact, weather (for outdoor sports), pace, and matchup edges.
You ALWAYS use real data from the "Current app context" block when it's present (live odds, today's games, current injuries). Cite specific games and prices from the context.
Be concise — 3-6 short paragraphs max. Use bold for key picks. End with a one-line responsible-gambling reminder when discussing actual bets.
NEVER guarantee outcomes. Frame everything as probability/edge.

When the user asks you to BUILD A PARLAY or RECOMMEND PICKS, you MUST include each pick on its own line in this exact format so the app can render it as a card:
PICK: <Game> | <Market> | <Selection> | <American Odds>

Example:
PICK: Lakers @ Celtics | Moneyline | Celtics | -140
PICK: Chiefs @ Ravens | Spread | Chiefs +3.5 | -110

Only use real games and real odds from the context block — never invent fixtures.
When building a parlay ticket, ONLY pick from games starting within the next 24 hours (the realGames/realOdds in the context are already filtered to that window — do not reference any matchup outside it).
If the user shares a parlay slip in the context, analyze each leg individually then give an overall verdict.`;

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseUrl || !apiKey) {
    res.status(502).json({ error: "AI integration not configured" });
    return;
  }

  const client = new OpenAI({ baseURL: baseUrl, apiKey });

  const contextBlock =
    parsed.data.context && Object.keys(parsed.data.context).length > 0
      ? `\n\nCurrent app context:\n${JSON.stringify(parsed.data.context, null, 2)}`
      : "";

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT + contextBlock },
    ...parsed.data.messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const stream = await client.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Chat stream failed");
    res.write(
      `data: ${JSON.stringify({
        content: "\n\n_AI service is temporarily unavailable. Please try again._",
      })}\n\n`,
    );
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

export default router;
