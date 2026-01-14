/**
 * Claude Code Agent Provider
 *
 * Uses the Claude Agent SDK (@anthropic-ai/claude-agent-sdk) to process requests.
 * This provider leverages Claude Code's built-in tools (Bash, Read, Write, etc.)
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentProvider,
  AgentResponse,
  AgentStreamEvent,
  AgentQueryOptions,
} from "../types";
import { createLogger } from "../../logger";

const log = createLogger("ClaudeCodeProvider");

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = "claude-code";
  readonly version = "1.0.0";

  private defaultTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];

  async query(prompt: string, options?: AgentQueryOptions): Promise<AgentResponse> {
    let result = "";
    let sessionId: string | undefined;

    for await (const event of this.queryStream(prompt, options)) {
      if (event.type === "done" && event.response) {
        return event.response;
      }
      if (event.type === "text" && event.text) {
        result = event.text;
      }
    }

    return { text: result, sessionId };
  }

  async *queryStream(
    prompt: string,
    options?: AgentQueryOptions
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    const queryOptions: any = {
      systemPrompt: options?.systemPrompt,
      cwd: options?.workingDir || process.env.WORKING_DIR || process.env.HOME || "/",
      allowedTools: options?.allowedTools || this.defaultTools,
      permissionMode: "bypassPermissions",
      maxTurns: options?.maxTurns || 10,
    };

    // Resume session if provided
    if (options?.sessionId) {
      queryOptions.resume = options.sessionId;
      log.debug("Resuming session", { sessionId: options.sessionId });
    }

    let result = "";
    let sessionId: string | undefined;
    let usedTools = false;

    try {
      yield { type: "thinking" };

      for await (const message of query({ prompt, options: queryOptions })) {
        log.debug("Agent message", { type: message.type, subtype: (message as any).subtype });

        // Capture session ID from init message
        if (message.type === "system" && (message as any).subtype === "init") {
          sessionId = (message as any).session_id;
          log.debug("Got session ID", { sessionId });
        }

        // Handle result messages
        if ("result" in message && message.result) {
          result = message.result;
        }

        // Handle assistant text messages
        if (message.type === "assistant" && "content" in message) {
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                result = block.text;
                yield { type: "text", text: block.text };
              }
              if (block.type === "tool_use") {
                usedTools = true;
                yield {
                  type: "tool_use",
                  toolName: block.name,
                  toolInput: block.input,
                };
              }
            }
          }
        }

        // Handle tool results
        if (message.type === "user" && "content" in message) {
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result") {
                yield {
                  type: "tool_result",
                  toolResult: typeof block.content === "string"
                    ? block.content
                    : JSON.stringify(block.content),
                };
              }
            }
          }
        }
      }

      yield {
        type: "done",
        response: {
          text: result || "Task completed (no output)",
          sessionId,
          usedTools,
        },
      };
    } catch (error: any) {
      log.error("Query failed", { error: error.message });
      yield { type: "error", error: error.message };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if claude CLI is available
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      await execAsync("which claude");
      return true;
    } catch {
      log.warn("Claude Code CLI not found");
      return false;
    }
  }
}
