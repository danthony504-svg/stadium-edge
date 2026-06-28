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

/** ~10k tokens of context headroom with the trimmed system prompt on 30k TPM tiers. */
const DIRECT_CONTEXT_BYTE_BUDGET = 36_000;

const CONTEXT_TRIM_FIELDS = [
  "matchupHistory",
  "playerHistory",
  "realProps",
  "realOdds",
  "mlbPlatoon",
  "mlbGameEnv",
  "matchupInjuries",
  "fightAnalysis",
  "statmuseFacts",
  "realGames",
  "currentSlip",
] as const;

function jsonBytes(v: unknown): number {
  try {
    return v == null ? 0 : JSON.stringify(v).length;
  } catch {
    return -1;
  }
}

function shrinkPlayerHistory(ph: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ph)) {
    if (!v || typeof v !== "object") {
      out[k] = v;
      continue;
    }
    const row = { ...(v as Record<string, unknown>) };
    if (Array.isArray(row.recent) && row.recent.length > 5) {
      row.recent = row.recent.slice(0, 5);
    }
    out[k] = row;
  }
  return out;
}

function shrinkMatchupHistory(mh: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mh)) {
    if (!v || typeof v !== "object") {
      out[k] = v;
      continue;
    }
    const row = { ...(v as Record<string, unknown>) };
    const h2h = row.h2h;
    if (h2h && typeof h2h === "object" && Array.isArray((h2h as { meetings?: unknown[] }).meetings)) {
      const meetings = (h2h as { meetings: unknown[] }).meetings;
      if (meetings.length > 3) {
        row.h2h = { ...(h2h as Record<string, unknown>), meetings: meetings.slice(0, 3) };
      }
    }
    out[k] = row;
  }
  return out;
}

function capRecordEntries(
  value: unknown,
  max: number,
  preferKeys?: Set<string>,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length <= max) return value;
  if (preferKeys && preferKeys.size > 0) {
    const preferred = entries.filter(([k]) => preferKeys.has(k));
    const rest = entries.filter(([k]) => !preferKeys.has(k));
    return Object.fromEntries([...preferred, ...rest].slice(0, max));
  }
  return Object.fromEntries(entries.slice(0, max));
}

/** Shrink client context on direct OpenAI so prompt + context stays under TPM. */
export function trimLockedContextForDirectOpenAI(
  ctx: Record<string, unknown> | undefined,
  opts?: { namedGameLabels?: Set<string> },
): Record<string, unknown> | undefined {
  if (!ctx || typeof ctx !== "object") return ctx;
  let out: Record<string, unknown> = { ...ctx };
  const named = opts?.namedGameLabels;

  const capArray = (key: string, max: number) => {
    const v = out[key];
    if (!Array.isArray(v) || v.length <= max) return;
    if (named && named.size > 0 && (key === "realProps" || key === "realOdds")) {
      const gameOf = (row: Record<string, unknown>): string => {
        if (typeof row.game === "string") return row.game;
        if (row.awayTeam && row.homeTeam) return `${row.awayTeam} @ ${row.homeTeam}`;
        return "";
      };
      const focal = v.filter((row) => named.has(gameOf(row as Record<string, unknown>)));
      out[key] = (focal.length > 0 ? focal : v).slice(0, max);
      return;
    }
    out[key] = v.slice(0, max);
  };

  capArray("realProps", 60);
  capArray("realOdds", 40);
  capArray("realGames", 12);

  if (out.playerHistory && typeof out.playerHistory === "object" && !Array.isArray(out.playerHistory)) {
    let ph = capRecordEntries(out.playerHistory, 8) as Record<string, unknown>;
    ph = shrinkPlayerHistory(ph);
    out.playerHistory = ph;
  }
  if (out.matchupHistory && typeof out.matchupHistory === "object" && !Array.isArray(out.matchupHistory)) {
    let mh = capRecordEntries(out.matchupHistory, named?.size ? named.size : 3, named) as Record<
      string,
      unknown
    >;
    mh = shrinkMatchupHistory(mh);
    out.matchupHistory = mh;
  }

  for (const key of CONTEXT_TRIM_FIELDS) {
    if (jsonBytes(out) <= DIRECT_CONTEXT_BYTE_BUDGET) break;
    const v = out[key];
    if (v == null) continue;
    if (Array.isArray(v)) {
      out[key] = v.slice(0, Math.max(0, Math.floor(v.length / 2)));
      continue;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (entries.length > 1) {
        out[key] = Object.fromEntries(entries.slice(0, Math.ceil(entries.length / 2)));
      } else {
        delete out[key];
      }
      continue;
    }
    delete out[key];
  }

  while (jsonBytes(out) > DIRECT_CONTEXT_BYTE_BUDGET) {
    let dropped = false;
    for (const key of CONTEXT_TRIM_FIELDS) {
      if (jsonBytes(out) <= DIRECT_CONTEXT_BYTE_BUDGET) break;
      if (out[key] != null) {
        delete out[key];
        dropped = true;
        break;
      }
    }
    if (!dropped) break;
  }

  return out;
}
