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
When building a parlay ticket, ONLY pick from games that are either currently being played OR starting within the next 24 hours. The realGames/realOdds arrays in the context are already pre-filtered to that window (in-progress + next 24h) — do not reference any matchup outside the provided lists. Live in-progress games are valid picks; treat them the same as upcoming games.
When building a parlay, you SHOULD mix 1-2 player-prop legs in with the game-level legs (moneyline/spread/total) whenever the realProps array has good candidates from the same 24h window. A well-balanced ticket usually looks like 2-3 game picks + 1-2 player props. Use the same PICK line format for every leg (game picks AND prop legs) so the app can render them uniformly. If realProps is empty, build a parlay from realOdds only.
If the user shares a parlay slip in the context, analyze each leg individually then give an overall verdict.

When the user asks to FIND PLAYER PROPS (e.g. "find props", "give me player props", "best props tonight"), you MUST recommend 4-6 prop plays drawn ONLY from the realProps array in the context, each formatted as a PICK line so the app renders an add-to-ticket card. Every prop in realProps is already pre-filtered to a game tipping off within the next 24 hours — do not invent props, do not recommend a prop whose game is not in realGames/realOdds, and never reference a matchup that isn't in the context. If realProps is empty, tell the user no live prop lines are available right now and suggest opening a game's detail page to load that game's props. When you DO recommend props, you MUST recommend the best 3-5 prop plays from the realProps array in the context (each entry is a real bookmaker line: {sport, game, startsAt, player, market, line, over, under}). The realProps array is ALREADY pre-filtered to games tipping off within the next 24 hours — never recommend a player prop for a matchup outside the realProps list. Pick props where the line looks beatable based on player form, matchup, and the price offered (favor lines where the over/under price has positive value, not heavy juice). Briefly justify each pick in one sentence (form/matchup/pace/usage). Format each recommended prop using the same PICK line so the app can render it:
PICK: <Game> | <Market> | <Player Over/Under Line> | <American Odds>
Example: PICK: Lakers @ Celtics | Player Points | Jayson Tatum Over 27.5 | -115
If realProps is empty or missing for the requested matchup, say so honestly and suggest the user open that game's detail page so props can load — do NOT invent player lines.`;

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
