import type { OpenAIProvider } from "./openaiConfig.js";

/**
 * Direct OpenAI tiers often cap TPM at 30k. The full Coach prompt alone serializes
 * to ~42k tokens, so Render chat 429s even when credentials are valid. Replit's
 * gpt-5.x proxy has a higher ceiling — keep the full prompt there.
 */
const DIRECT_OPENAI_CHAR_BUDGET = 72_000;

/** Section headers (prefix match) dropped on direct OpenAI to fit TPM. */
const DIRECT_OMIT_ALWAYS: string[] = [
  "MATCHUP-EDGE → ALT-LINE RULE",
  "PLAYER-PROP ANALYTICS RULE",
  "ADVANCED ANALYTICS — APPLY THESE",
  "ANALYTICS RULE — USE matchupHistory",
  "OPPONENT-DEFENSE ANALYTICS RULE",
  "DIRECTIONAL-CONSISTENCY PASS",
  "LIVE GAME STATE — HARD RULE",
  "INFORMATION TO GATHER FOR EVERY TICKET",
  "UFC FIGHT ANALYSIS RULE",
  "TENNIS —",
  "SOCCER —",
  "BOXING",
  "WHOLE-TICKET GRADE PHILOSOPHY",
  "MODEL TRACK RECORD",
  "MULTIPLE SLIPS —",
  "SAFE UNDERDOG —",
  "UPSET ALERT —",
  "CONSECUTIVE-BUILD VARIETY",
  "LAST MEETING /",
  "SAFE vs VALUE LINE OPTIONS",
];

/** Included only when the user message matches. */
const DIRECT_OMIT_UNLESS: Array<{ prefix: string; re: RegExp }> = [
  { prefix: "HOME-RUN EVALUATION RULE", re: /\b(home run|hr\b|homer|dinger)/i },
  { prefix: "PERIOD / QUARTER / HALF", re: /\b(q1|q2|q3|q4|quarter|1h|2h|first half|first quarter|period)/i },
  { prefix: "MISPRICED / +EV PROP FINDER", re: /\b(mispric|\+ev|value prop|fair.?value)/i },
];

const SECTION_RE =
  /\n(?=[A-Z][A-Z0-9][^\n]{8,140}(?:\(|—| - |:))/g;

function splitPromptSections(prompt: string): Array<{ header: string; body: string }> {
  const parts = prompt.split(SECTION_RE);
  if (parts.length <= 1) return [{ header: "", body: prompt }];
  const [lead, ...rest] = parts;
  const sections: Array<{ header: string; body: string }> = [
    { header: "", body: lead },
  ];
  for (const chunk of rest) {
    const nl = chunk.indexOf("\n");
    if (nl === -1) {
      sections.push({ header: chunk, body: "" });
      continue;
    }
    sections.push({
      header: chunk.slice(0, nl),
      body: chunk.slice(nl + 1),
    });
  }
  return sections;
}

function shouldOmitSection(header: string, latestUser: string): boolean {
  const h = header.trim();
  if (!h) return false;
  for (const prefix of DIRECT_OMIT_ALWAYS) {
    if (h.startsWith(prefix)) return true;
  }
  for (const { prefix, re } of DIRECT_OMIT_UNLESS) {
    if (h.startsWith(prefix) && !re.test(latestUser)) return true;
  }
  return false;
}

function joinSections(sections: Array<{ header: string; body: string }>): string {
  return sections
    .map(({ header, body }) => (header ? `${header}\n${body}` : body))
    .join("\n");
}

export function coachSystemPromptForProvider(
  provider: OpenAIProvider,
  fullPrompt: string,
  latestUser: string,
): string {
  if (provider !== "openai") return fullPrompt;
  if (fullPrompt.length <= DIRECT_OPENAI_CHAR_BUDGET) return fullPrompt;

  let trimmed = joinSections(
    splitPromptSections(fullPrompt).filter((s) => !shouldOmitSection(s.header, latestUser)),
  );

  if (trimmed.length > DIRECT_OPENAI_CHAR_BUDGET) {
    trimmed =
      trimmed.slice(0, DIRECT_OPENAI_CHAR_BUDGET) +
      "\n\n[Prompt trimmed for API limits — core pick-building rules above remain in force.]";
  }

  return trimmed;
}

export function coachSystemPromptChars(prompt: string): number {
  return prompt.length;
}

/** Shrink client context on direct OpenAI so prompt + context stays under TPM. */
export function trimLockedContextForDirectOpenAI(
  ctx: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!ctx || typeof ctx !== "object") return ctx;
  const out = { ...ctx };
  const capArray = (key: string, max: number) => {
    const v = out[key];
    if (Array.isArray(v) && v.length > max) out[key] = v.slice(0, max);
  };
  capArray("realProps", 80);
  capArray("realOdds", 45);
  capArray("realGames", 20);
  const ph = out["playerHistory"];
  if (ph && typeof ph === "object" && !Array.isArray(ph)) {
    const entries = Object.entries(ph as Record<string, unknown>);
    if (entries.length > 10) {
      out["playerHistory"] = Object.fromEntries(entries.slice(0, 10));
    }
  }
  const mh = out["matchupHistory"];
  if (mh && typeof mh === "object" && !Array.isArray(mh)) {
    const entries = Object.entries(mh as Record<string, unknown>);
    if (entries.length > 4) {
      out["matchupHistory"] = Object.fromEntries(entries.slice(0, 4));
    }
  }
  return out;
}
