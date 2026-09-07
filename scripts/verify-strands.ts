/**
 * Space Zero — Strands runtime verification (temporary, NOT production).
 *
 * Lives in scripts/ per project convention. Runs against the repo-root
 * dependencies. Proves, against the installed @strands-agents/sdk version:
 *   1. tool()          — a custom tool with Zod input validation
 *   2. AnthropicModel  — the direct-Anthropic provider (no AWS/Bedrock)
 *   3. agent.stream()  — streamed agent invocation
 *
 * Run:  node scripts/verify-strands.ts     (Node 24 strips TS types natively)
 * With a live model call:  ANTHROPIC_API_KEY=sk-ant-... node scripts/verify-strands.ts
 *
 * check_authority here is a trivial deterministic stand-in only. If the API key
 * is absent, the script still verifies imports/registration/construction and
 * reports the exact remaining runtime blocker instead of substituting anything.
 */

import { readFileSync } from "node:fs";
import { Agent, tool } from "@strands-agents/sdk";
import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import { z } from "zod";

const line = (s = "") => console.log(s);
const ok = (s: string) => console.log(`  [PASS] ${s}`);
const info = (s: string) => console.log(`  [info] ${s}`);

let toolWasCalled = false;
let toolCalledWith: { amount: number; allowance: number } | null = null;

const authoritySchema = z.object({
  amount: z.number().describe("The proposed spend amount"),
  allowance: z.number().describe("The maximum allowed amount"),
});

const checkAuthority = tool({
  name: "check_authority",
  description:
    "Deterministically decide whether a proposed spend is within the allowed " +
    "amount. Returns permitted=true when amount <= allowance, else false.",
  inputSchema: authoritySchema,
  callback: ({ amount, allowance }) => {
    toolWasCalled = true;
    toolCalledWith = { amount, allowance };
    const permitted = amount <= allowance;
    return {
      permitted,
      amount,
      allowance,
      reason: permitted
        ? `${amount} is within the allowance of ${allowance}`
        : `${amount} exceeds the allowance of ${allowance}`,
    };
  },
});

function pkgVersion(pkg: string): string {
  try {
    // scripts/ is one level under the repo root, where node_modules lives.
    const url = new URL(`../node_modules/${pkg}/package.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")).version;
  } catch {
    return "(unknown)";
  }
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b && typeof (b as { text?: unknown }).text === "string"
        ? (b as { text: string }).text
        : "",
    )
    .join("");
}

async function main() {
  line("=== Space Zero — Strands runtime verification ===");
  line();

  info(`@strands-agents/sdk  = ${pkgVersion("@strands-agents/sdk")}`);
  info(`@anthropic-ai/sdk    = ${pkgVersion("@anthropic-ai/sdk")}`);
  info(`zod                  = ${pkgVersion("zod")}`);
  info(`node                 = ${process.version}`);
  line();

  ok(`tool() constructed: name="${checkAuthority.name}"`);

  const parsedGood = authoritySchema.safeParse({ amount: 96, allowance: 150 });
  const parsedBad = authoritySchema.safeParse({
    amount: "not-a-number",
    allowance: 150,
  });
  if (parsedGood.success && !parsedBad.success) {
    ok("Zod inputSchema accepts valid input and rejects invalid input");
  } else {
    throw new Error("Zod inputSchema did not validate as expected");
  }
  line();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = new AnthropicModel({
    apiKey: apiKey ?? "MISSING",
    modelId: "claude-sonnet-4-6",
    maxTokens: 512,
  });
  ok("AnthropicModel constructed (provider = Anthropic direct, no Bedrock)");

  const agent = new Agent({
    model,
    tools: [checkAuthority],
    systemPrompt:
      "You are a deterministic operator. When asked whether a spend is " +
      "permitted, you MUST call the check_authority tool and report its " +
      "result. Answer in one short sentence.",
  });
  ok("Agent constructed with model + tool");
  line();

  if (!apiKey) {
    line("--- RUNTIME (model call) SKIPPED ---");
    info("ANTHROPIC_API_KEY is not set in the environment.");
    info(
      "PASSED without a network call: imports, tool() registration, Zod " +
        "validation, AnthropicModel + Agent construction.",
    );
    info(
      "Exact remaining runtime blocker: set ANTHROPIC_API_KEY, then re-run.",
    );
    line();
    line(
      "RESULT: COMPILE / IMPORT / REGISTRATION VERIFIED — model call pending credentials.",
    );
    return;
  }

  const prompt =
    "A disruption needs a rebooking that costs 96. The recovery allowance " +
    "is 150. Is this within authority?";
  line(`User: ${prompt}`);
  line("Streamed event types:");

  const stream = agent.stream(prompt);
  const eventTypes: Record<string, number> = {};
  let eventCount = 0;

  let next = await stream.next();
  while (!next.done) {
    const event = next.value as { type?: string };
    const t = event.type ?? "(untyped)";
    eventTypes[t] = (eventTypes[t] ?? 0) + 1;
    eventCount++;
    next = await stream.next();
  }
  const result = next.value;
  line(
    "  " +
      Object.entries(eventTypes)
        .map(([t, n]) => `${t}×${n}`)
        .join("  "),
  );
  line();

  ok(`agent.stream() yielded ${eventCount} event(s) across the loop`);
  if (toolWasCalled) {
    ok(
      `check_authority was invoked with ${JSON.stringify(toolCalledWith)}`,
    );
  } else {
    info("Tool was NOT invoked by the model on this run.");
  }

  const finalText = extractText(
    (result as { lastMessage?: { content?: unknown } })?.lastMessage?.content,
  );
  if (finalText.trim()) {
    ok(`Final assistant message: "${finalText.trim()}"`);
  } else {
    info("No text content found on the final message.");
  }
  line();

  const passed = eventCount > 0 && toolWasCalled && finalText.trim().length > 0;
  line(
    passed
      ? "RESULT: FULL END-TO-END FLOW VERIFIED."
      : "RESULT: streamed, but one signal was weak — see notes above.",
  );
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    line();
    console.error("VERIFICATION FAILED:", err?.stack ?? err?.message ?? err);
    process.exit(1);
  });
