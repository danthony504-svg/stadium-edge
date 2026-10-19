/** Pure ask parsing shared by market locks and props-only routing. */
export function footballSkillPropFamilies(text: string): {
  rush: boolean;
  pass: boolean;
  rec: boolean;
} | null {
  // Do not turn an explicit game-line request into a player-prop ticket.
  if (/\b(?:no|without)\s+(?:player\s+)?props?\b|\bgame\s*lines?\s+only\b|\bsides?\s+only\b/i.test(text)) return null;
  const explicitProps = /\bprops?\b/i.test(text);
  // Bare gerunds are common phone asks: "10 leg rushing and receiving".
  // Short "pass" alone is conversational ("pass on NBA"), not stat intent.
  const rush = /\brushing\b/i.test(text) || (explicitProps && /\brush\b/i.test(text));
  const pass = /\bpassing\b(?!\s+on\b)/i.test(text) || (explicitProps && /\bpass\b/i.test(text));
  const rec = /\breceiving\b/i.test(text) || (explicitProps && /\breceiv(?:e|er)?\b|\breceptions?\b/i.test(text));
  return rush || pass || rec ? { rush, pass, rec } : null;
}
