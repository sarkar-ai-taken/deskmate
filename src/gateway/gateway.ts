import { createLogger } from "../core/logger";
import { Executor } from "../core/executor";
import { approvalManager, PendingAction } from "../core/approval";
import { createAgentProvider, AgentProvider } from "../core/agent";
import { getScreenshotHint } from "../core/platform";
import { SecurityManager } from "./security";
import { SessionManager } from "./session";
import type {
  MessagingClient,
  MessageHandler,
  IncomingMessage,
  ApprovalResponse,
  GatewayConfig,
} from "./types";

const log = createLogger("Gateway");

const SCREENSHOT_DIR = process.env.TMPDIR
  ? `${process.env.TMPDIR}deskmate-screenshots`
  : "/tmp/deskmate-screenshots";

export class Gateway implements MessageHandler {
  private clients = new Map<string, MessagingClient>();
  private security: SecurityManager;
  private sessions: SessionManager;
  private executor: Executor;
  private agentProvider: AgentProvider;
  private config: GatewayConfig;
  private systemPrompt: string;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.security = new SecurityManager(config.allowedUsers);
    this.sessions = new SessionManager({
      storagePath: config.storagePath,
    });
    this.executor = new Executor(config.workingDir);
    this.agentProvider = createAgentProvider();
    this.systemPrompt =
      config.systemPrompt ||
      `You are a local machine assistant named ${config.botName}. Users will ask you to perform tasks on their computer.

You have access to tools to execute commands, read/write files, and explore the filesystem. Use them to help users accomplish their tasks.

SCREENSHOT CAPABILITY:
When the user asks to see the screen, take a screenshot, or wants visual feedback, use this command:
  ${getScreenshotHint(SCREENSHOT_DIR)}
The screenshot will automatically be sent to the user after your response.

IMPORTANT RULES:
- Be concise in your responses
- Use the available tools to accomplish tasks
- For dangerous operations, explain what you're about to do before doing it
- Never use sudo unless explicitly asked
- Keep responses under 4000 characters
- When asked for screenshots, always use the screenshot command above`;
  }

  registerClient(client: MessagingClient): void {
    if (this.clients.has(client.clientType)) {
      throw new Error(`Client type "${client.clientType}" is already registered`);
    }
    this.clients.set(client.clientType, client);
    log.info("Client registered", { clientType: client.clientType });
  }

  async start(): Promise<void> {
    if (this.clients.size === 0) {
      throw new Error("No clients registered. Register at least one MessagingClient before starting.");
    }

    // Verify agent provider
    log.info("Using agent provider", {
      name: this.agentProvider.name,
      version: this.agentProvider.version,
    });
    const available = await this.agentProvider.isAvailable();
    if (!available) {
      log.warn("Agent provider may not be fully available", { provider: this.agentProvider.name });
    }

    // Register approval notifier that broadcasts to clients with recent activity
    approvalManager.addNotifier(async (action: PendingAction) => {
      await this.broadcastApproval(action);
    });

    // Start all clients
    for (const client of this.clients.values()) {
      await client.start(this);
      log.info("Client started", { clientType: client.clientType });
    }

    log.info("Gateway started", { clients: Array.from(this.clients.keys()) });
  }

  async stop(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.stop();
    }
    this.sessions.stop();
    if (this.agentProvider.cleanup) {
      await this.agentProvider.cleanup();
    }
    log.info("Gateway stopped");
  }

  // ── MessageHandler implementation ───────────────────────────────────

  async handleMessage(msg: IncomingMessage): Promise<void> {
    // Auth check
    if (!this.security.isAuthorized(msg.clientType, msg.userId)) {
      log.debug("Unauthorized message dropped", {
        clientType: msg.clientType,
        userId: msg.userId,
      });
      return;
    }

    if (msg.command) {
      await this.handleCommand(msg);
    } else {
      await this.handleAgentQuery(msg);
    }
  }

  async handleApproval(response: ApprovalResponse, channelId: string): Promise<void> {
    const { actionId, approved } = response;

    let success: boolean;
    if (approved) {
      success = approvalManager.approve(actionId);
    } else {
      success = approvalManager.reject(actionId);
    }

    // Update approval UI on all clients that have the channel
    for (const client of this.clients.values()) {
      try {
        await client.updateApprovalStatus(channelId, actionId, approved);
      } catch {
        // Client may not own this channel — ignore
      }
    }

    if (!success) {
      log.warn("Approval action not found", { actionId });
    }
  }

  // ── Commands ────────────────────────────────────────────────────────

  private async handleCommand(msg: IncomingMessage): Promise<void> {
    const client = this.clients.get(msg.clientType);
    if (!client) return;

    switch (msg.command) {
      case "start":
        await client.sendMessage({
          channelId: msg.channelId,
          text:
            `*${this.config.botName} Ready*\n\n` +
            "Send me any task and I'll execute it on your local machine.\n\n" +
            "I remember our conversation, so you can ask follow-up questions!\n\n" +
            "*Examples:*\n" +
            "- `list all docker containers`\n" +
            "- `what's using port 3000?`\n" +
            "- `show disk usage`\n" +
            "- `take a screenshot`\n\n" +
            "*Commands:*\n" +
            "- /screenshot - Take a screenshot\n" +
            "- /status - System info\n" +
            "- /reset - Clear memory & start fresh",
          parseMode: "markdown",
        });
        break;

      case "screenshot":
        await this.handleScreenshotCommand(msg, client);
        break;

      case "status":
        await this.handleStatusCommand(msg, client);
        break;

      case "reset":
        await this.handleResetCommand(msg, client);
        break;

      default:
        log.debug("Unknown command", { command: msg.command });
    }
  }

  private async handleScreenshotCommand(
    msg: IncomingMessage,
    client: MessagingClient,
  ): Promise<void> {
    await client.sendMessage({ channelId: msg.channelId, text: "Taking screenshot..." });

    try {
      const filepath = await this.executor.takeScreenshot();
      if (filepath) {
        await client.sendMessage({
          channelId: msg.channelId,
          image: filepath,
          imageCaption: "Screenshot",
        });
        // Clean up
        const fs = await import("fs/promises");
        await fs.unlink(filepath).catch(() => {});
      } else {
        await client.sendMessage({
          channelId: msg.channelId,
          text: "Screenshot failed.",
        });
      }
    } catch (error: any) {
      log.error("Screenshot command failed", { error: error.message });
      await client.sendMessage({
        channelId: msg.channelId,
        text: `Screenshot failed: ${error.message}`,
      });
    }
  }

  private async handleStatusCommand(
    msg: IncomingMessage,
    client: MessagingClient,
  ): Promise<void> {
    const pending = approvalManager.getPendingActions();
    const info = await this.executor.getSystemInfo();
    const hasSession = this.sessions.has(msg.clientType, msg.channelId);

    await client.sendMessage({
      channelId: msg.channelId,
      text:
        `*System Status*\n\n` +
        `- Host: ${info.hostname || "unknown"}\n` +
        `- Platform: ${info.platform}\n` +
        `- Agent: ${this.agentProvider.name} v${this.agentProvider.version}\n` +
        `- Pending approvals: ${pending.length}\n` +
        `- Working dir: \`${this.executor.getWorkingDir()}\`\n` +
        `- Session active: ${hasSession ? "Yes" : "No"}`,
      parseMode: "markdown",
    });
  }

  private async handleResetCommand(
    msg: IncomingMessage,
    client: MessagingClient,
  ): Promise<void> {
    const had = this.sessions.delete(msg.clientType, msg.channelId);
    log.info("Session reset", { clientType: msg.clientType, channelId: msg.channelId, had });

    await client.sendMessage({
      channelId: msg.channelId,
      text: had
        ? "Session cleared! Starting fresh conversation."
        : "No active session to clear.",
    });
  }

  // ── Agent query loop ────────────────────────────────────────────────

  private async handleAgentQuery(msg: IncomingMessage): Promise<void> {
    const client = this.clients.get(msg.clientType);
    if (!client) return;

    // Send "Thinking..." placeholder
    const thinkingId = await client.sendMessage({
      channelId: msg.channelId,
      text: "Thinking...",
    });

    const executionStartTime = new Date();
    const existingSessionId = this.sessions.get(msg.clientType, msg.channelId);

    log.info("Received message", {
      clientType: msg.clientType,
      userId: msg.userId,
      channelId: msg.channelId,
      hasSession: !!existingSessionId,
      message: msg.text.slice(0, 100),
    });

    try {
      let result = "";
      let lastUpdate = Date.now();
      let newSessionId: string | undefined;

      for await (const event of this.agentProvider.queryStream(msg.text, {
        systemPrompt: this.systemPrompt,
        workingDir: this.config.workingDir,
        sessionId: existingSessionId,
        maxTurns: this.config.maxTurns ?? 10,
      })) {
        switch (event.type) {
          case "text":
            if (event.text) result = event.text;
            break;
          case "tool_use":
            log.debug("Tool use", { tool: event.toolName });
            break;
          case "done":
            if (event.response) {
              result = event.response.text;
              newSessionId = event.response.sessionId;
            }
            break;
          case "error":
            throw new Error(event.error || "Unknown agent error");
        }

        // Periodic progress update
        if (thinkingId && Date.now() - lastUpdate > 3000) {
          try {
            await client.sendMessage({
              channelId: msg.channelId,
              text: "Working...",
              editMessageId: thinkingId,
            });
            lastUpdate = Date.now();
          } catch {
            // Ignore edit errors
          }
        }
      }

      // Store session
      if (newSessionId) {
        this.sessions.set(msg.clientType, msg.channelId, newSessionId);
        log.info("Session stored", { channelId: msg.channelId, sessionId: newSessionId });
      }

      // Send final result
      const finalMessage = result || "Task completed (no output)";
      const truncated = finalMessage.slice(0, 4000);

      log.info("Agent completed", { resultLength: finalMessage.length, hasSession: !!newSessionId });

      // Try markdown first, fall back to plain
      try {
        await client.sendMessage({
          channelId: msg.channelId,
          text: truncated,
          editMessageId: thinkingId,
          parseMode: "markdown",
        });
      } catch {
        await client.sendMessage({
          channelId: msg.channelId,
          text: truncated,
          editMessageId: thinkingId,
          parseMode: "plain",
        });
      }

      // Send any screenshots taken during execution
      await this.sendScreenshots(client, msg.channelId, executionStartTime);
    } catch (error: any) {
      log.error("Agent error", { error: error.message });

      if (error.message?.includes("session")) {
        this.sessions.delete(msg.clientType, msg.channelId);
        log.warn("Cleared invalid session", { channelId: msg.channelId });
      }

      await client.sendMessage({
        channelId: msg.channelId,
        text: `Error: ${error.message}`,
        editMessageId: thinkingId,
      });
    }
  }

  // ── Screenshots ─────────────────────────────────────────────────────

  private async sendScreenshots(
    client: MessagingClient,
    channelId: string,
    since: Date,
  ): Promise<void> {
    try {
      const screenshots = await this.executor.getRecentScreenshots(since);
      const fs = await import("fs/promises");

      for (const filepath of screenshots) {
        await client.sendMessage({
          channelId,
          image: filepath,
          imageCaption: "Screenshot",
        });
        await fs.unlink(filepath).catch(() => {});
      }

      if (screenshots.length > 0) {
        log.info("Screenshots sent", { count: screenshots.length });
      }
    } catch (error: any) {
      log.error("Failed to send screenshots", { error: error.message });
    }
  }

  // ── Approval broadcasting ───────────────────────────────────────────

  private async broadcastApproval(action: PendingAction): Promise<void> {
    const timeLeft = Math.ceil((action.expiresAt.getTime() - Date.now()) / 1000);

    let details = "";
    switch (action.type) {
      case "command":
        details = `Command: \`${action.details.command}\``;
        break;
      case "write_file":
        details = `Path: \`${action.details.path}\`\nPreview: ${(action.details.contentPreview || "").slice(0, 100)}...`;
        break;
      case "folder_access":
        details = `Folder: \`${action.details.baseFolder}\`\nFile: \`${action.details.path}\``;
        break;
      case "read_file":
        details = `Path: \`${action.details.path}\``;
        break;
      default:
        details = JSON.stringify(action.details, null, 2);
    }

    // Send to all clients that have recently-active channels
    const recentChannels = this.sessions.getRecentChannels(30 * 60 * 1000);

    // Group by clientType
    const channelsByClient = new Map<string, string[]>();
    for (const { clientType, channelId } of recentChannels) {
      if (!channelsByClient.has(clientType)) {
        channelsByClient.set(clientType, []);
      }
      channelsByClient.get(clientType)!.push(channelId);
    }

    for (const [clientType, channelIds] of channelsByClient) {
      const client = this.clients.get(clientType);
      if (!client) continue;

      for (const channelId of channelIds) {
        try {
          await client.sendApprovalPrompt({
            channelId,
            actionId: action.id,
            type: action.type,
            description: action.description,
            details,
            expiresInSeconds: timeLeft,
          });
        } catch (error: any) {
          log.error("Failed to send approval prompt", {
            clientType,
            channelId,
            error: error.message,
          });
        }
      }
    }
  }
}
