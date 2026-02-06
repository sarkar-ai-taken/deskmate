/**
 * Agent Module
 *
 * Provides an abstraction layer for AI agent providers.
 * Ships with claude-code as the default (and recommended) provider.
 *
 * Usage:
 *   import { createAgentProvider } from "./core/agent";
 *   const agent = createAgentProvider();
 *   const response = await agent.query("Hello");
 *
 * To add a custom provider:
 *   1. Implement the AgentProvider interface
 *   2. Call registerProvider("my-agent", MyProvider)
 *   3. Set AGENT_PROVIDER=my-agent in .env
 *
 * Environment:
 *   AGENT_PROVIDER - Set to override default provider (default: "claude-code")
 */

// Types
export type {
  AgentProvider,
  AgentProviderType,
  AgentProviderConfig,
  AgentMessage,
  AgentResponse,
  AgentStreamEvent,
  AgentQueryOptions,
} from "./types";

// Factory
export {
  createAgentProvider,
  getDefaultProviderType,
  getAvailableProviders,
  registerProvider,
  isProviderAvailable,
} from "./factory";

// Built-in providers
export { ClaudeCodeProvider } from "./providers/claude-code";
export { BaseCliProvider } from "./providers/base-cli";
export { CodexProvider } from "./providers/codex";
export { GeminiProvider } from "./providers/gemini";
export { OpenCodeProvider } from "./providers/opencode";
