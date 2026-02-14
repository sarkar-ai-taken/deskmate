/**
 * IExecutor Interface
 *
 * Abstraction over command execution, file I/O, and system operations.
 * In native mode, backed by the local Executor.
 * In container mode, backed by RemoteExecutor that talks to the host sidecar.
 */

import type { ExecutionResult, FileInfo } from "./executor";

export type { ExecutionResult, FileInfo };

export interface IExecutor {
  executeCommand(command: string, cwd?: string): Promise<ExecutionResult>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  listDirectory(dirPath?: string): Promise<FileInfo[]>;
  getSystemInfo(): Promise<Record<string, string>>;
  getWorkingDir(): string;
  setWorkingDir(dir: string): void;
  takeScreenshot(): Promise<string | null>;
  getRecentScreenshots(since: Date): Promise<string[]>;
  cleanupScreenshots(): Promise<void>;
  getScreenshotDir(): string;
}
