/**
 * OpenCode Agent Provider
 *
 * Spawns `opencode` CLI to process prompts.
 * Supports session continuity via the -c flag.
 * OpenCode manages its own authentication — no API key needed in .env.
 *
 * Install: https://github.com/opencode-ai/opencode
 */

import { BaseCliProvider } from "./base-cli";
import {
  AgentQueryOptions,
  AgentStreamEvent,
} from "../types";

export class OpenCodeProvider extends BaseCliProvider {
  readonly name = "opencode";
  readonly version = "1.0.0";
  protected readonly binary = "opencode";

  private continueSession = false;

  protected buildArgs(prompt: string, options?: AgentQueryOptions): string[] {
    const args = ["run"];

    // If we have a previous session, use -c to continue
    if (options?.sessionId === "opencode-continue" || this.continueSession) {
      args.push("-c");
    }

    args.push(prompt);
    return args;
  }

  async *queryStream(
    prompt: string,
    options?: AgentQueryOptions
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    for await (const event of super.queryStream(prompt, options)) {
      if (event.type === "done" && event.response) {
        // Inject session ID so next query uses -c flag
        this.continueSession = true;
        yield {
          ...event,
          response: {
            ...event.response,
            sessionId: "opencode-continue",
          },
        };
      } else {
        yield event;
      }
    }
  }
}
