/**
 * Executor Factory
 *
 * Returns the correct IExecutor implementation based on INSTALL_MODE:
 *   - "native" (default): local Executor with direct OS access
 *   - "container": RemoteExecutor that delegates to the host sidecar over a Unix socket
 */

import type { IExecutor } from "./executor-interface";

export function isContainerMode(): boolean {
  return process.env.INSTALL_MODE === "container";
}

export function createExecutor(workingDir?: string): IExecutor {
  if (isContainerMode()) {
    // Lazy import to avoid pulling in http when not needed
    const { RemoteExecutor } = require("./remote-executor");
    return new RemoteExecutor(workingDir);
  }

  const { Executor } = require("./executor");
  return new Executor(workingDir);
}
