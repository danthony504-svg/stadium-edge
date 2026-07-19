import { fetch as expoFetch } from "expo/fetch";

import { API_BASE } from "@/lib/api";
import type { SlipLegInput } from "@/lib/slipLegAnalysis";
import { parseSlipLegsJson } from "@/lib/slipLegAnalysis";

export type ExtractedSlipLeg = SlipLegInput;

/** Vision extract — returns only legs legible in the uploaded slip photo(s). */
export async function extractSlipLegsFromImages(
  imageDataUrls: string[],
  signal?: AbortSignal,
): Promise<ExtractedSlipLeg[]> {
  if (!imageDataUrls.length) return [];
  const res = await expoFetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content:
            "Read every leg on this bet slip. Output ONLY a single line starting with SLIP_LEGS_JSON: followed by a JSON array of objects with pick (string), odds (American number), and optional game/market/sport. Never invent a leg or price that is not legible.",
        },
      ],
      imageDataUrls: imageDataUrls.slice(0, 3),
      slipExtractOnly: true,
    }),
    signal,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { legs?: ExtractedSlipLeg[]; text?: string };
  if (Array.isArray(data.legs) && data.legs.length) return data.legs;
  if (typeof data.text === "string") {
    const parsed = parseSlipLegsJson(data.text);
    if (parsed?.length) return parsed;
  }
  return [];
}

export { parseSlipLegsJson };
