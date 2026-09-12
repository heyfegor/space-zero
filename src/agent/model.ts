/**
 * Space Zero — model provider factory (architecture §3).
 *
 * The agent and tool layers NEVER reference a concrete provider; they receive
 * whatever getModel() returns. Swapping providers is an env change, no code
 * change. Anthropic is the development/demo default so AWS is off the critical
 * path. OpenAI and Bedrock are dynamically imported so their (optional) SDK
 * packages are not required unless actually selected.
 *
 * Server-only. Reads secrets from the environment; must never be imported into
 * a client component.
 */

import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import type { Model } from "@strands-agents/sdk";

export type ModelProvider = "anthropic" | "openai" | "bedrock" | "google";

function providerFromEnv(): ModelProvider {
  const raw = (process.env.MODEL_PROVIDER ?? "anthropic").toLowerCase();
  if (raw === "anthropic" || raw === "openai" || raw === "bedrock" || raw === "google")
    return raw;
  throw new Error(
    `Unknown MODEL_PROVIDER "${raw}". Expected "anthropic", "openai", "bedrock", or "google".`,
  );
}

const modelId = () => process.env.MODEL_ID ?? "claude-sonnet-4-6";
const maxTokens = () => Number(process.env.MODEL_MAX_TOKENS ?? "1024");

/**
 * Returns a Strands Model for the configured provider. Throws a clear,
 * actionable error when required credentials are missing.
 */
export async function getModel(): Promise<Model> {
  const provider = providerFromEnv();

  switch (provider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example).",
        );
      }
      return new AnthropicModel({
        apiKey,
        modelId: modelId(),
        maxTokens: maxTokens(),
      });
    }

    case "openai": {
      // Optional dependency — only needed when this provider is selected.
      const { OpenAIModel } = await import("@strands-agents/sdk/models/openai");
      if (!process.env.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY is not set but MODEL_PROVIDER=openai.",
        );
      }
      return new OpenAIModel({ modelId: modelId(), maxTokens: maxTokens() });
    }

    case "bedrock": {
      // Requires AWS account access + Bedrock model access. Credentials come from
      // the AWS default provider chain (env, SSO, shared config). The region is
      // passed explicitly so the app does not silently depend on ambient AWS_REGION.
      const { BedrockModel } = await import("@strands-agents/sdk/models/bedrock");
      const region = process.env.AWS_REGION;
      if (!region) {
        throw new Error(
          "AWS_REGION is not set but MODEL_PROVIDER=bedrock. Add it to .env.local (see .env.example).",
        );
      }
      return new BedrockModel({ region, modelId: modelId(), maxTokens: maxTokens() });
    }

    case "google": {
      // Temporary provider. Optional dependency — only needed when selected.
      const { GoogleModel } = await import("@strands-agents/sdk/models/google");
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY is not set but MODEL_PROVIDER=google. Add it to .env.local (see .env.example).",
        );
      }
      // Never reuse the Anthropic default model id here; Gemini needs a Gemini id,
      // and its max-output knob lives under params (not a top-level maxTokens).
      return new GoogleModel({
        apiKey,
        modelId: process.env.MODEL_ID ?? "gemini-3.6-flash",
        params: { maxOutputTokens: maxTokens() },
      });
    }
  }
}

/** The active provider name, for health/observability responses. */
export function activeProvider(): ModelProvider {
  return providerFromEnv();
}
