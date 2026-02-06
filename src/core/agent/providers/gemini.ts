/**
 * Gemini CLI Agent Provider
 *
 * Spawns `gemini` CLI with prompt mode.
 * Plain text output — base class defaults handle everything.
 *
 * Env: GEMINI_API_KEY (or GOOGLE_API_KEY)
 * Install: https://github.com/google-gemini/gemini-cli
 */

import { BaseCliProvider } from "./base-cli";
import { AgentQueryOptions } from "../types";

export class GeminiProvider extends BaseCliProvider {
  readonly name = "gemini";
  readonly version = "1.0.0";
  protected readonly binary = "gemini";

  protected buildArgs(prompt: string, options?: AgentQueryOptions): string[] {
    return ["-p", prompt, "--yolo"];
  }

  protected buildEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    };
  }
}
