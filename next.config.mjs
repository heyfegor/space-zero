/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Strands SDK is server-only. Keep it out of the client bundle and let
  // Next treat it as an external server package rather than trying to bundle it.
  serverExternalPackages: ["@strands-agents/sdk", "@anthropic-ai/sdk"],
  // Don't let `next dev` auto-generate AGENTS.md / CLAUDE.md — this project has
  // its own docs/ and memory, and a generated root CLAUDE.md would compete.
  agentRules: false,
};

export default nextConfig;
