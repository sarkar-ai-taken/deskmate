/**
 * Agent Provider Abstraction
 *
 * This module defines the interface for AI agent providers.
 * Implement this interface to add support for different AI backends
 * (Claude Code, OpenAI, local LLMs, etc.)
 */

export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentResponse {
  /** The text response from the agent */
  text: string;
  /** Session ID for conversation continuity (if supported) */
  sessionId?: string;
  /** Whether the agent used any tools */
  usedTools?: boolean;
  /** Raw response data (provider-specific) */
  raw?: unknown;
}

export interface AgentStreamEvent {
  type: "thinking" | "text" | "tool_use" | "tool_result" | "done" | "error";
  /** Partial text content */
  text?: string;
  /** Tool being used */
  toolName?: string;
  /** Tool input */
  toolInput?: unknown;
  /** Tool result */
  toolResult?: string;
  /** Error message */
  error?: string;
  /** Final response (on "done" event) */
  response?: AgentResponse;
}

export interface AgentQueryOptions {
  /** System prompt to set agent behavior */
  systemPrompt?: string;
  /** Working directory for command execution */
  workingDir?: string;
  /** Session ID to resume a previous conversation */
  sessionId?: string;
  /** Maximum turns/iterations for the agent */
  maxTurns?: number;
  /** Allowed tools (provider-specific) */
  allowedTools?: string[];
  /** Additional provider-specific options */
  providerOptions?: Record<string, unknown>;
}

export interface AgentProvider {
  /** Provider name for identification */
  readonly name: string;

  /** Provider version */
  readonly version: string;

  /**
   * Process a user message and return a response
   * @param prompt The user's message
   * @param options Query options
   * @returns The agent's response
   */
  query(prompt: string, options?: AgentQueryOptions): Promise<AgentResponse>;

  /**
   * Process a user message with streaming
   * @param prompt The user's message
   * @param options Query options
   * @yields Stream events as the agent processes
   */
  queryStream(
    prompt: string,
    options?: AgentQueryOptions
  ): AsyncGenerator<AgentStreamEvent, void, unknown>;

  /**
   * Check if the provider is properly configured and available
   * @returns true if the provider is ready to use
   */
  isAvailable(): Promise<boolean>;

  /**
   * Clean up resources (sessions, connections, etc.)
   */
  cleanup?(): Promise<void>;
}

/** Built-in types. Use registerProvider() to add custom types. */
export type AgentProviderType = "claude-code" | "codex" | "gemini" | "opencode" | (string & {});

export interface AgentProviderConfig {
  /** The provider type to use */
  type: AgentProviderType;
  /** API key (if required) */
  apiKey?: string;
  /** Model name/ID */
  model?: string;
  /** Base URL for API (for self-hosted or custom endpoints) */
  baseUrl?: string;
  /** Additional provider-specific configuration */
  options?: Record<string, unknown>;
}
