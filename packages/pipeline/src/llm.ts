/**
 * Shared Claude LLM client with retry logic for transient API errors.
 */

import pRetry from "p-retry";
import { APIError } from "@anthropic-ai/sdk";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface LlmResponse {
  text: string;
  stopReason: string;
}

function isOverloaded(error: unknown): error is APIError {
  return typeof error === "object" && error !== null && "status" in error && error.status === 529;
}

export async function callLlm(req: LlmRequest): Promise<LlmResponse> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return pRetry(
    async () => {
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: req.maxTokens,
        messages: [{ role: "user", content: req.user }],
        system: req.system,
      });

      const block = message.content[0]!;
      return {
        text: block.type === "text" ? block.text : "[no text response]",
        stopReason: message.stop_reason ?? "unknown",
      };
    },
    {
      retries: 3,
      minTimeout: 2_000,
      shouldRetry: ({ error }) => isOverloaded(error),
      onFailedAttempt: ({ attemptNumber, retriesLeft }) => {
        console.warn(`[llm] 529 overloaded, retrying (attempt ${attemptNumber}/${retriesLeft + attemptNumber})`);
      },
    },
  );
}
