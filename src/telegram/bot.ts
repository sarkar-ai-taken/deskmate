import { Bot, InlineKeyboard, InputFile } from "grammy";
import { Executor } from "../core/executor";
import { approvalManager, PendingAction } from "../core/approval";
import { createAgentProvider, AgentProvider } from "../core/agent";
import { createLogger } from "../core/logger";

const log = createLogger("TelegramBot");

const BOT_NAME = process.env.BOT_NAME || "Deskmate";

const SCREENSHOT_DIR = process.env.TMPDIR ? `${process.env.TMPDIR}deskmate-screenshots` : "/tmp/deskmate-screenshots";

const SYSTEM_PROMPT = `You are a local machine assistant named ${BOT_NAME}. Users will ask you to perform tasks on their computer via Telegram.

You have access to tools to execute commands, read/write files, and explore the filesystem. Use them to help users accomplish their tasks.

SCREENSHOT CAPABILITY:
When the user asks to see the screen, take a screenshot, or wants visual feedback, use this command:
  mkdir -p ${SCREENSHOT_DIR} && screencapture -x ${SCREENSHOT_DIR}/screenshot-$(date +%s).png && echo "Screenshot saved"
The screenshot will automatically be sent to the user via Telegram after your response.

IMPORTANT RULES:
- Be concise in your responses (Telegram messages should be brief)
- Use the available tools to accomplish tasks
- For dangerous operations, explain what you're about to do before doing it
- Never use sudo unless explicitly asked
- Keep responses under 4000 characters (Telegram limit)
- When asked for screenshots, always use the screencapture command above`;

export async function startTelegramBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUserId = parseInt(process.env.ALLOWED_USER_ID || "0", 10);

  if (!token || !allowedUserId) {
    throw new Error("TELEGRAM_BOT_TOKEN and ALLOWED_USER_ID required for Telegram bot");
  }

  const bot = new Bot(token);
  const executor = new Executor();
  const workingDir = process.env.WORKING_DIR || process.env.HOME || "/";

  // Create the agent provider (abstracted - can be swapped)
  const agentProvider: AgentProvider = createAgentProvider();
  log.info("Using agent provider", { name: agentProvider.name, version: agentProvider.version });

  // Verify provider is available
  const providerAvailable = await agentProvider.isAvailable();
  if (!providerAvailable) {
    log.warn("Agent provider may not be fully available", { provider: agentProvider.name });
  }

  // Store session IDs per chat for context/memory
  const chatSessions = new Map<number, string>();

  // Register Telegram as an approval notifier
  approvalManager.addNotifier(async (action: PendingAction) => {
    // This will be called when approval is needed
    // We send a Telegram message for the user to approve/reject
    try {
      const keyboard = new InlineKeyboard()
        .text("✅ Approve", `approve:${action.id}`)
        .text("❌ Reject", `reject:${action.id}`);

      let emoji = "🔐";
      let details = "";

      switch (action.type) {
        case "command":
          emoji = "⚡";
          details = `\`\`\`bash\n${action.details.command}\n\`\`\``;
          break;
        case "write_file":
          emoji = "📝";
          details = `Path: \`${action.details.path}\`\nPreview: ${(action.details.contentPreview || "").slice(0, 100)}...`;
          break;
        case "folder_access":
          emoji = "📁";
          details = `Folder: \`${action.details.baseFolder}\`\nFile: \`${action.details.path}\``;
          break;
        case "read_file":
          emoji = "👁️";
          details = `Path: \`${action.details.path}\``;
          break;
        default:
          details = JSON.stringify(action.details, null, 2);
      }

      const timeLeft = Math.ceil((action.expiresAt.getTime() - Date.now()) / 1000);

      await bot.api.sendMessage(
        allowedUserId,
        `${emoji} *Approval Required*\n\n` +
        `Type: \`${action.type}\`\n` +
        `${action.description}\n\n` +
        `${details}\n\n` +
        `⏱️ Expires in ${timeLeft}s`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );

      log.info("Approval notification sent to Telegram", { actionId: action.id, type: action.type });
    } catch (error) {
      log.error("Failed to send Telegram notification", { error: (error as Error).message });
    }
  });

  // Auth middleware
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== allowedUserId) {
      console.log(`Unauthorized: ${ctx.from?.id}`);
      return;
    }
    await next();
  });

  // Commands
  bot.command("start", (ctx) =>
    ctx.reply(
      `👋 *${BOT_NAME} Ready*\n\n` +
        "Send me any task and I'll execute it on your local machine.\n\n" +
        "I remember our conversation, so you can ask follow-up questions!\n\n" +
        "*Examples:*\n" +
        "• `list all docker containers`\n" +
        "• `what's using port 3000?`\n" +
        "• `show disk usage`\n" +
        "• `take a screenshot`\n\n" +
        "*Commands:*\n" +
        "• /screenshot - Take a screenshot\n" +
        "• /status - System info\n" +
        "• /reset - Clear memory & start fresh",
      { parse_mode: "Markdown" }
    )
  );

  // Quick screenshot command
  bot.command("screenshot", async (ctx) => {
    const chatId = ctx.chat.id;
    await ctx.reply("📸 Taking screenshot...");

    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const fs = await import("fs/promises");
      const path = await import("path");
      const execAsync = promisify(exec);

      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
      const filename = `screenshot-${Date.now()}.png`;
      const filepath = path.join(SCREENSHOT_DIR, filename);

      await execAsync(`screencapture -x "${filepath}"`);

      await bot.api.sendPhoto(chatId, new InputFile(filepath), {
        caption: "📸 Screenshot",
      });

      await fs.unlink(filepath).catch(() => {});
      log.info("Screenshot command completed", { chatId });
    } catch (error: any) {
      log.error("Screenshot command failed", { error: error.message });
      await ctx.reply(`❌ Screenshot failed: ${error.message}`);
    }
  });

  bot.command("status", async (ctx) => {
    const pending = approvalManager.getPendingActions();
    const info = await executor.getSystemInfo();
    const hasSession = chatSessions.has(ctx.chat.id);
    await ctx.reply(
      `🖥️ *System Status*\n\n` +
        `• Host: ${info.hostname || "unknown"}\n` +
        `• Platform: ${info.platform}\n` +
        `• Agent: ${agentProvider.name} v${agentProvider.version}\n` +
        `• Pending approvals: ${pending.length}\n` +
        `• Working dir: \`${executor.getWorkingDir()}\`\n` +
        `• Session active: ${hasSession ? "Yes ✅" : "No"}`,
      { parse_mode: "Markdown" }
    );
  });

  // Reset session - start fresh conversation
  bot.command("reset", async (ctx) => {
    const chatId = ctx.chat.id;
    const hadSession = chatSessions.has(chatId);
    chatSessions.delete(chatId);
    log.info("Session reset", { chatId, hadSession });
    await ctx.reply(
      hadSession
        ? "🔄 Session cleared! Starting fresh conversation."
        : "ℹ️ No active session to clear.",
    );
  });

  // Approval callbacks
  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const actionId = ctx.match![1];
    const success = approvalManager.approve(actionId);
    await ctx.answerCallbackQuery({ text: success ? "Approved!" : "Action not found" });
    if (success) {
      await ctx.editMessageText("✅ *Approved* - executing...", { parse_mode: "Markdown" });
    }
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const actionId = ctx.match![1];
    approvalManager.reject(actionId);
    await ctx.answerCallbackQuery({ text: "Rejected" });
    await ctx.editMessageText("❌ *Rejected*", { parse_mode: "Markdown" });
  });

  // Helper to send screenshots
  async function sendScreenshots(chatId: number, since: Date): Promise<number> {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      await fs.mkdir(SCREENSHOT_DIR, { recursive: true }).catch(() => {});
      const files = await fs.readdir(SCREENSHOT_DIR).catch(() => [] as string[]);
      let sent = 0;

      for (const file of files) {
        if (!file.endsWith(".png")) continue;
        const filepath = path.join(SCREENSHOT_DIR, file);
        const stats = await fs.stat(filepath).catch(() => null);
        if (stats && stats.mtime >= since) {
          log.info("Sending screenshot", { filepath });
          await bot.api.sendPhoto(chatId, new InputFile(filepath), {
            caption: "📸 Screenshot",
          });
          // Clean up after sending
          await fs.unlink(filepath).catch(() => {});
          sent++;
        }
      }
      return sent;
    } catch (error: any) {
      log.error("Failed to send screenshots", { error: error.message });
      return 0;
    }
  }

  // Main message handler - uses abstract agent provider
  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const chatId = ctx.chat.id;
    const thinkingMsg = await ctx.reply("🤔 Thinking...");

    // Record time before execution for screenshot detection
    const executionStartTime = new Date();

    // Get existing session for this chat (if any)
    const existingSessionId = chatSessions.get(chatId);
    log.info("Received message", {
      userId: ctx.from?.id,
      chatId,
      hasSession: !!existingSessionId,
      message: userMessage.slice(0, 100),
    });

    try {
      let result = "";
      let lastUpdate = Date.now();
      let newSessionId: string | undefined;

      // Use the abstract agent provider
      for await (const event of agentProvider.queryStream(userMessage, {
        systemPrompt: SYSTEM_PROMPT,
        workingDir,
        sessionId: existingSessionId,
        maxTurns: 10,
      })) {
        log.debug("Agent event", { type: event.type });

        switch (event.type) {
          case "text":
            if (event.text) {
              result = event.text;
            }
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

        // Update thinking message periodically to show progress
        if (Date.now() - lastUpdate > 3000) {
          try {
            await ctx.api.editMessageText(chatId, thinkingMsg.message_id, "⏳ Working...");
            lastUpdate = Date.now();
          } catch {
            // Ignore edit errors
          }
        }
      }

      // Store the session ID for future messages
      if (newSessionId) {
        chatSessions.set(chatId, newSessionId);
        log.info("Session stored", { chatId, sessionId: newSessionId });
      }

      // Send final result
      const finalMessage = result || "Task completed (no output)";
      const truncated = finalMessage.slice(0, 4000); // Telegram limit

      log.info("Agent completed", { resultLength: finalMessage.length, hasSession: !!newSessionId });

      await ctx.api.editMessageText(chatId, thinkingMsg.message_id, truncated, {
        parse_mode: "Markdown",
      }).catch(async () => {
        // If Markdown fails, try without
        await ctx.api.editMessageText(chatId, thinkingMsg.message_id, truncated);
      });

      // Check for and send any screenshots taken during execution
      const screenshotsSent = await sendScreenshots(chatId, executionStartTime);
      if (screenshotsSent > 0) {
        log.info("Screenshots sent", { count: screenshotsSent });
      }
    } catch (error: any) {
      log.error("Agent error", { error: error.message });
      // If session error, clear the session and retry might help
      if (error.message?.includes("session")) {
        chatSessions.delete(chatId);
        log.warn("Cleared invalid session", { chatId });
      }
      await ctx.api.editMessageText(
        chatId,
        thinkingMsg.message_id,
        `❌ Error: ${error.message}`
      );
    }
  });

  // Start polling
  console.log("🤖 Starting Telegram bot...");
  bot.start({
    drop_pending_updates: true,  // Don't process old updates on restart
    onStart: (info) => console.log(`✅ Telegram bot @${info.username} running (${agentProvider.name})`),
  });
}
