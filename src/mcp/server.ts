// @ts-nocheck - Required due to MCP SDK type inference issue (TS2589)
// See: https://github.com/modelcontextprotocol/sdk/issues - deep type instantiation with Zod schemas
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as os from "os";
import { createExecutor } from "../core/executor-factory";
import { approvalManager } from "../core/approval";
import { createStderrLogger } from "../core/logger";
import { HealthManager, formatHealthStatus } from "../core/health";
import { SkillRegistry, SkillExecutor } from "../core/skills";
import { CronScheduler } from "../core/cron";
import { createAgentProvider } from "../core/agent";

const log = createStderrLogger("MCP");

export async function startMcpServer(): Promise<void> {
  const executor = createExecutor();

  const server = new McpServer({
    name: "deskmate",
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
        const resolvedPath = require("path").isAbsolute(path)
          ? path
          : require("path").join(executor.getWorkingDir(), path);
        const approved = await approvalManager.requestFolderAccess(resolvedPath);
        if (!approved) {
          return {
            content: [{ type: "text" as const, text: `Access to ${resolvedPath} was not approved` }],
            isError: true,
          };
        }
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
        const resolvedPath = path
          ? require("path").isAbsolute(path)
            ? path
            : require("path").join(executor.getWorkingDir(), path)
          : executor.getWorkingDir();
        const approved = await approvalManager.requestFolderAccess(resolvedPath);
        if (!approved) {
          return {
            content: [{ type: "text" as const, text: `Access to ${resolvedPath} was not approved` }],
            isError: true,
          };
        }
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

  // Tool: Get health status
  server.tool(
    "get_health",
    "Get system health status including resource metrics, agent availability, and subsystem status",
    {},
    async () => {
      log.info("Tool invoked: get_health");

      // Standalone MCP mode: lightweight resource-only check
      const healthManager = new HealthManager();
      try {
        const status = await healthManager.checkNow();
        const text = formatHealthStatus(status);
        log.debug("Tool completed: get_health");
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error: any) {
        // Fallback: basic resource info
        const loadAvg = os.loadavg();
        const cpuCount = os.cpus().length;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const text =
          `CPU Load: ${Math.round((loadAvg[0] / cpuCount) * 100)}%\n` +
          `Memory: ${Math.round(((totalMem - freeMem) / totalMem) * 100)}% (${Math.round((totalMem - freeMem) / (1024 * 1024))} MB / ${Math.round(totalMem / (1024 * 1024))} MB)\n` +
          `Process Uptime: ${Math.round(process.uptime())}s\n` +
          `Node Heap: ${Math.round(process.memoryUsage().heapUsed / (1024 * 1024))} MB`;
        return {
          content: [{ type: "text" as const, text }],
        };
      } finally {
        healthManager.stop();
      }
    }
  );

  // Tool: List skills
  server.tool(
    "list_skills",
    "List all registered skills with their descriptions and parameters",
    {},
    async () => {
      log.info("Tool invoked: list_skills");
      const registry = new SkillRegistry();
      registry.load();

      const skills = registry.list();
      if (skills.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No skills registered. Create a skills.json file to define skills." }],
        };
      }

      const output = skills
        .map((s) => `${s.name}: ${s.description}`)
        .join("\n");

      log.debug("Tool completed: list_skills", { count: skills.length });
      return {
        content: [{ type: "text" as const, text: output }],
      };
    }
  );

  // Tool: Run a skill
  server.tool(
    "run_skill",
    "Run a named skill with optional parameters",
    {
      name: z.string().describe("The skill name to run"),
      params: z.record(z.string()).optional().describe("Key-value parameters for the skill"),
    },
    async ({ name, params }) => {
      log.info("Tool invoked: run_skill", { name, params });

      const registry = new SkillRegistry();
      registry.load();

      const skill = registry.get(name);
      if (!skill) {
        return {
          content: [{ type: "text" as const, text: `Skill "${name}" not found` }],
          isError: true,
        };
      }

      const agentProvider = createAgentProvider();
      const skillExecutor = new SkillExecutor({
        executor,
        agentProvider,
        skillLookup: (n) => registry.get(n),
      });

      try {
        const result = await skillExecutor.execute(skill, params || {});
        const stepsSummary = result.steps
          .map(
            (s) =>
              `Step ${s.stepIndex + 1} (${s.type}): ${s.success ? "OK" : "FAILED"}\n${s.output.slice(0, 1000)}`,
          )
          .join("\n\n");

        const text =
          `Skill ${name}: ${result.success ? "Completed" : "Failed"}\n` +
          `Duration: ${result.totalDurationMs}ms\n\n${stepsSummary}`;

        log.debug("Tool completed: run_skill", { name, success: result.success });
        return {
          content: [{ type: "text" as const, text: text.slice(0, 4000) }],
          isError: !result.success,
        };
      } catch (error: any) {
        log.error("Tool failed: run_skill", { name, error: error.message });
        return {
          content: [{ type: "text" as const, text: `Skill execution error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: List cron jobs
  server.tool(
    "list_cron_jobs",
    "List all configured cron jobs with their schedules and status",
    {},
    async () => {
      log.info("Tool invoked: list_cron_jobs");

      const scheduler = new CronScheduler();
      scheduler.start();
      const jobs = scheduler.getJobStates();
      scheduler.stop();

      if (jobs.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No cron jobs configured. Create a crons.json file to define jobs." }],
        };
      }

      const output = jobs
        .map((j) => {
          const status = !j.enabled
            ? "disabled"
            : j.lastSuccess === null
              ? "pending"
              : j.lastSuccess
                ? "ok"
                : "failed";
          const lastRun = j.lastRunAt ? j.lastRunAt.toLocaleString() : "never";
          return `${j.name} (${j.schedule}): ${status} | Last: ${lastRun} | Runs: ${j.runCount} | Fails: ${j.failCount}`;
        })
        .join("\n");

      log.debug("Tool completed: list_cron_jobs", { count: jobs.length });
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
