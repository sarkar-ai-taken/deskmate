// @ts-nocheck - Required due to MCP SDK type inference issue (TS2589)
// See: https://github.com/modelcontextprotocol/sdk/issues - deep type instantiation with Zod schemas
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Executor } from "../core/executor";
import { approvalManager } from "../core/approval";
import { createStderrLogger } from "../core/logger";

const log = createStderrLogger("MCP");

export async function startMcpServer(): Promise<void> {
  const executor = new Executor();

  const server = new McpServer({
    name: "sarkar-local-agent",
    version: "1.0.0",
  });

  // Tool: Execute shell command
  server.tool(
    "execute_command",
    "Execute a shell command on the local machine. Requires approval for potentially dangerous commands.",
    {
      command: z.string().describe("The shell command to execute"),
      working_dir: z.string().optional().describe("Working directory (defaults to configured dir)"),
    },
    async ({ command, working_dir }) => {
      log.info("Tool invoked: execute_command", { command, working_dir });

      const approved = await approvalManager.requestApproval(
        "command",
        `Execute: ${command}`,
        { command, workingDir: working_dir || executor.getWorkingDir() },
        { autoApprove: true }
      );

      if (!approved) {
        log.warn("Command not approved", { command });
        return {
          content: [{ type: "text" as const, text: "Command was not approved or timed out." }],
        };
      }

      const result = await executor.executeCommand(command, working_dir);

      log.debug("Tool completed: execute_command", { success: result.success, exitCode: result.exitCode });
      return {
        content: [{ type: "text" as const, text: `Exit code: ${result.exitCode}\n\n${result.output}` }],
        isError: !result.success,
      };
    }
  );

  // Tool: Read file
  server.tool(
    "read_file",
    "Read the contents of a file",
    {
      path: z.string().describe("Path to the file (absolute or relative to working dir)"),
    },
    async ({ path }) => {
      log.info("Tool invoked: read_file", { path });
      try {
        const content = await executor.readFile(path);
        log.debug("Tool completed: read_file", { path, size: content.length });
        return {
          content: [{ type: "text" as const, text: content }],
        };
      } catch (error: any) {
        log.error("Tool failed: read_file", { path, error: error.message });
        return {
          content: [{ type: "text" as const, text: `Error reading file: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Write file
  server.tool(
    "write_file",
    "Write content to a file. Requires approval.",
    {
      path: z.string().describe("Path to the file (absolute or relative to working dir)"),
      file_content: z.string().describe("Content to write to the file"),
    },
    async ({ path, file_content }) => {
      log.info("Tool invoked: write_file", { path, contentLength: file_content.length });

      const approved = await approvalManager.requestApproval(
        "write_file",
        `Write to: ${path}`,
        { path, contentPreview: file_content.slice(0, 200) }
      );

      if (!approved) {
        log.warn("File write not approved", { path });
        return {
          content: [{ type: "text" as const, text: "File write was not approved or timed out." }],
        };
      }

      try {
        await executor.writeFile(path, file_content);
        log.debug("Tool completed: write_file", { path, size: file_content.length });
        return {
          content: [{ type: "text" as const, text: `Successfully wrote ${file_content.length} bytes to ${path}` }],
        };
      } catch (error: any) {
        log.error("Tool failed: write_file", { path, error: error.message });
        return {
          content: [{ type: "text" as const, text: `Error writing file: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: List directory
  server.tool(
    "list_directory",
    "List files and directories in a path",
    {
      path: z.string().optional().describe("Path to list (defaults to working directory)"),
    },
    async ({ path }) => {
      log.info("Tool invoked: list_directory", { path });
      try {
        const files = await executor.listDirectory(path);
        const output = files
          .map((f) => {
            const type = f.isDirectory ? "dir" : "file";
            const size = f.isDirectory ? "" : ` (${formatBytes(f.size)})`;
            return `[${type}] ${f.name}${size}`;
          })
          .join("\n");

        log.debug("Tool completed: list_directory", { path, itemCount: files.length });
        return {
          content: [{ type: "text" as const, text: output || "(empty directory)" }],
        };
      } catch (error: any) {
        log.error("Tool failed: list_directory", { path, error: error.message });
        return {
          content: [{ type: "text" as const, text: `Error listing directory: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: Get system info
  server.tool(
    "get_system_info",
    "Get information about the local system",
    {},
    async () => {
      log.info("Tool invoked: get_system_info");
      const info = await executor.getSystemInfo();
      const output = Object.entries(info)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");

      log.debug("Tool completed: get_system_info");
      return {
        content: [{ type: "text" as const, text: output }],
      };
    }
  );

  // Tool: List pending approvals
  server.tool(
    "list_pending_approvals",
    "List actions waiting for approval",
    {},
    async () => {
      log.info("Tool invoked: list_pending_approvals");
      const pending = approvalManager.getPendingActions();

      log.debug("Tool completed: list_pending_approvals", { pendingCount: pending.length });
      if (pending.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No pending approvals" }],
        };
      }

      const output = pending
        .map((a) => `[${a.id}] ${a.type}: ${a.description}`)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: output }],
      };
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("MCP Server started", { transport: "stdio" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
