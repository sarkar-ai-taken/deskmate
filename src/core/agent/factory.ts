/**
 * Agent Provider Factory
 *
 * Creates agent provider instances based on configuration.
 * Ships with claude-code as the default provider.
 * Users can register custom providers via registerProvider().
 */

import {
  AgentProvider,
  AgentProviderType,
  AgentProviderConfig,
} from "./types";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { createLogger } from "../logger";

const log = createLogger("AgentFactory");

// Registry of available providers — extensible via registerProvider()
const providerRegistry = new Map<AgentProviderType, new () => AgentProvider>([
  ["claude-code", ClaudeCodeProvider],
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

  return "claude-code";
}

/**
 * Get list of available provider types
 */
export function getAvailableProviders(): AgentProviderType[] {
  return Array.from(providerRegistry.keys());
}

/**
 * Register a custom agent provider.
 *
 * Example:
 *   registerProvider("my-agent", MyAgentProvider);
 *   // then set AGENT_PROVIDER=my-agent in .env
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
