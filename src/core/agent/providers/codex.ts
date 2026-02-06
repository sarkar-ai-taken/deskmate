/**
 * Codex (OpenAI) Agent Provider
 *
 * Spawns `codex` CLI in full-auto mode with JSON output.
 * Parses JSONL stdout to extract the final response text.
 *
 * Env: OPENAI_API_KEY
 * Install: https://github.com/openai/codex
 */

import { BaseCliProvider } from "./base-cli";
import { AgentQueryOptions } from "../types";

export class CodexProvider extends BaseCliProvider {
  readonly name = "codex";
  readonly version = "1.0.0";
  protected readonly binary = "codex";

  protected buildArgs(prompt: string, options?: AgentQueryOptions): string[] {
    const args = ["exec", "--full-auto", "--json", prompt];

    if (options?.workingDir) {
      args.push("-C", options.workingDir);
    }

    return args;
  }

  protected buildEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
  }

  protected parseOutput(chunk: string): string {
    // Codex outputs JSONL — each line is a JSON object
    const lines = chunk.split("\n").filter((l) => l.trim());
    const texts: string[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        // Extract text from completed items
        if (event.type === "item.completed" && event.item?.content) {
          for (const block of event.item.content) {
            if (block.type === "output_text" && block.text) {
              texts.push(block.text);
            }
          }
        }
        // Also handle message.completed events
        if (event.type === "message.completed" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "output_text" && block.text) {
              texts.push(block.text);
            }
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }

    return texts.join("");
  }

  protected extractFinalText(fullOutput: string): string {
    // Try to parse JSONL and find the last completed text
    const lines = fullOutput.split("\n").filter((l) => l.trim());
    let lastText = "";

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "item.completed" && event.item?.content) {
          for (const block of event.item.content) {
            if (block.type === "output_text" && block.text) {
              lastText = block.text;
            }
          }
        }
        if (event.type === "message.completed" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "output_text" && block.text) {
              lastText = block.text;
            }
          }
        }
      } catch {
        // Not JSON — use raw text as fallback
        if (!lastText) lastText = line;
      }
    }

    return lastText.trim() || fullOutput.trim();
  }
}
