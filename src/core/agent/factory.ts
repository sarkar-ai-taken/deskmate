/**
 * Agent Provider Factory
 *
 * Creates agent provider instances based on configuration.
 * Add new providers here as they are implemented.
 */

import {
  AgentProvider,
  AgentProviderType,
  AgentProviderConfig,
} from "./types";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { createLogger } from "../logger";

const log = createLogger("AgentFactory");

// Registry of available providers
const providerRegistry: Map<AgentProviderType, new () => AgentProvider> = new Map([
  ["claude-code", ClaudeCodeProvider],
  // Add more providers here:
  // ["openai", OpenAIProvider],
  // ["anthropic-direct", AnthropicDirectProvider],
  // ["ollama", OllamaProvider],
]);

/**
 * Create an agent provider based on configuration
 */
export function createAgentProvider(config?: AgentProviderConfig): AgentProvider {
  const providerType = config?.type || getDefaultProviderType();

  log.info("Creating agent provider", { type: providerType });

  const ProviderClass = providerRegistry.get(providerType);

  if (!ProviderClass) {
    const available = Array.from(providerRegistry.keys()).join(", ");
    throw new Error(
      `Unknown agent provider: ${providerType}. Available: ${available}`
    );
  }

  return new ProviderClass();
}

/**
 * Get the default provider type from environment or fallback
 */
export function getDefaultProviderType(): AgentProviderType {
  const envProvider = process.env.AGENT_PROVIDER as AgentProviderType | undefined;

  if (envProvider && providerRegistry.has(envProvider)) {
    return envProvider;
  }

  // Default to claude-code
  return "claude-code";
}

/**
 * Get list of available provider types
 */
export function getAvailableProviders(): AgentProviderType[] {
  return Array.from(providerRegistry.keys());
}

/**
 * Register a custom provider
 */
export function registerProvider(
  type: AgentProviderType,
  providerClass: new () => AgentProvider
): void {
  log.info("Registering custom provider", { type });
  providerRegistry.set(type, providerClass);
}

/**
 * Check if a provider type is available
 */
export function isProviderAvailable(type: AgentProviderType): boolean {
  return providerRegistry.has(type);
}
