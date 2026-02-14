/**
 * Base CLI Agent Provider
 *
 * Abstract base class for providers that spawn a CLI subprocess.
 * Handles process lifecycle, stdout streaming, and availability checks.
 * Subclasses override buildArgs(), parseOutput(), and extractFinalText().
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import {
  AgentProvider,
  AgentResponse,
  AgentStreamEvent,
  AgentQueryOptions,
} from "../types";
import { createLogger } from "../../logger";
import { isContainerMode } from "../../executor-factory";

export abstract class BaseCliProvider implements AgentProvider {
  abstract readonly name: string;
  abstract readonly version: string;

  /** CLI binary name (e.g. "codex", "gemini", "opencode") */
  protected abstract readonly binary: string;

  private _log?: ReturnType<typeof createLogger>;

  protected get log(): ReturnType<typeof createLogger> {
    if (!this._log) {
      this._log = createLogger(this.name);
    }
    return this._log;
  }

  /**
   * Build CLI arguments for the given prompt and options.
   * Subclasses must implement this.
   */
  protected abstract buildArgs(
    prompt: string,
    options?: AgentQueryOptions
  ): string[];

  /**
   * Parse a raw stdout chunk into text for streaming.
   * Default: return the chunk as-is. Override for JSONL etc.
   */
  protected parseOutput(chunk: string): string {
    return chunk;
  }

  /**
   * Extract the final response text from the accumulated output.
   * Default: return the full output trimmed. Override for structured parsing.
   */
  protected extractFinalText(fullOutput: string): string {
    return fullOutput.trim();
  }

  /**
   * Build environment variables to pass to the subprocess.
   * Override to inject provider-specific env vars (e.g. API keys).
   */
  protected buildEnv(): Record<string, string | undefined> {
    return { ...process.env };
  }

  async query(
    prompt: string,
    options?: AgentQueryOptions
  ): Promise<AgentResponse> {
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
    // In container mode, delegate to sidecar to spawn the CLI on the host
    if (isContainerMode()) {
      yield* this.queryStreamRemote(prompt, options);
      return;
    }

    const args = this.buildArgs(prompt, options);
    const env = this.buildEnv();

    this.log.info("Spawning CLI", { binary: this.binary, args });

    let child: ChildProcess;
    try {
      child = spawn(this.binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
        cwd: options?.workingDir || process.env.WORKING_DIR || process.env.HOME || "/",
      });
    } catch (error: any) {
      this.log.error("Failed to spawn process", { error: error.message });
      yield { type: "error", error: `Failed to spawn ${this.binary}: ${error.message}` };
      return;
    }

    yield { type: "thinking" };

    let fullOutput = "";
    let stderr = "";

    // Collect output via async iteration
    const outputPromise = new Promise<void>((resolve, reject) => {
      child.stdout!.on("data", (data: Buffer) => {
        const chunk = data.toString();
        fullOutput += chunk;
        const parsed = this.parseOutput(chunk);
        if (parsed) {
          // We don't yield from inside a callback — we'll emit the final result
        }
      });

      child.stderr!.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", reject);
      child.on("close", () => resolve());
    });

    try {
      await outputPromise;
    } catch (error: any) {
      this.log.error("Process error", { error: error.message });
      yield { type: "error", error: error.message };
      return;
    }

    const exitCode = child.exitCode;
    if (exitCode !== 0 && exitCode !== null) {
      const errorMsg = stderr.trim() || `${this.binary} exited with code ${exitCode}`;
      this.log.error("Process failed", { exitCode, stderr: stderr.slice(0, 500) });
      yield { type: "error", error: errorMsg };
      return;
    }

    const text = this.extractFinalText(fullOutput);

    if (text) {
      yield { type: "text", text };
    }

    yield {
      type: "done",
      response: {
        text: text || "Task completed (no output)",
      },
    };
  }

  /**
   * Spawn the CLI agent on the host via the sidecar /spawn-cli-agent endpoint.
   */
  private async *queryStreamRemote(
    prompt: string,
    options?: AgentQueryOptions
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    const args = this.buildArgs(prompt, options);
    const env = this.buildEnv();

    this.log.info("Spawning CLI via sidecar", { binary: this.binary, args });
    yield { type: "thinking" };

    try {
      const { RemoteExecutor } = require("../../core/remote-executor");
      const remote = new RemoteExecutor();
      const result: { output: string; stderr: string; exitCode: number | null } =
        await remote.request("POST", "/spawn-cli-agent", {
          binary: this.binary,
          args,
          env,
          cwd: options?.workingDir || process.env.WORKING_DIR || process.env.HOME || "/",
        });

      if (result.exitCode !== 0 && result.exitCode !== null) {
        const errorMsg = result.stderr.trim() || `${this.binary} exited with code ${result.exitCode}`;
        this.log.error("Remote process failed", { exitCode: result.exitCode });
        yield { type: "error", error: errorMsg };
        return;
      }

      const text = this.extractFinalText(result.output);

      if (text) {
        yield { type: "text", text };
      }

      yield {
        type: "done",
        response: {
          text: text || "Task completed (no output)",
        },
      };
    } catch (error: any) {
      this.log.error("Remote spawn failed", { error: error.message });
      yield { type: "error", error: error.message };
    }
  }

  async isAvailable(): Promise<boolean> {
    // In container mode, the binary lives on the host — skip local check
    if (isContainerMode()) {
      return true;
    }

    try {
      execSync(`which ${this.binary}`, { stdio: "ignore" });
      return true;
    } catch {
      this.log.warn(`${this.binary} CLI not found`);
      return false;
    }
  }
}
