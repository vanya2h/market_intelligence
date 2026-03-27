/**
 * Trade Idea Direction Extractor
 *
 * Small Claude call that extracts the directional bias (LONG / SHORT / FLAT)
 * from a synthesized market brief. Uses minimal tokens for cost efficiency.
 */

import { callLlm } from "../../llm.js";
import type { Direction } from "./composite-target.js";

const SYSTEM_PROMPT = `Given a market brief, extract the directional bias.

Rules:
- LONG: the brief expresses upward bias, a long setup, or bullish lean
- SHORT: the brief expresses downward bias, a short setup, or bearish lean
- FLAT: the brief is neutral, has mixed/conflicting signals, or explicitly recommends staying flat/sideline

Respond with ONLY one word: LONG, SHORT, or FLAT`;

export async function extractDirection(
  brief: string,
): Promise<Direction> {
  const response = await callLlm({
    system: SYSTEM_PROMPT,
    user: brief,
    maxTokens: 32,
  });

  const dir = response.text.trim();

  if (dir !== "LONG" && dir !== "SHORT" && dir !== "FLAT") {
    throw new Error(`Unexpected direction from LLM: ${dir}`);
  }

  return dir;
}
