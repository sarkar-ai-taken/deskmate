/**
 * Agent Module
 *
 * Provides an abstraction layer for AI agent providers.
 *
 * Usage:
 *   import { createAgentProvider } from "./core/agent";
 *   const agent = createAgentProvider();
 *   const response = await agent.query("Hello");
 *
 * To add a new provider:
 *   1. Create a new file in ./providers/your-provider.ts
 *   2. Implement the AgentProvider interface
 *   3. Register it in ./factory.ts
 *
 * Environment:
 *   AGENT_PROVIDER - Set to override default provider (e.g., "openai", "ollama")
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

// Providers (for direct import if needed)
export { ClaudeCodeProvider } from "./providers/claude-code";
