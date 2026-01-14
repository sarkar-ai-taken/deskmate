import { Bot, InlineKeyboard } from "grammy";
import { Executor } from "../core/executor";
import { approvalManager, PendingAction } from "../core/approval";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../core/logger";

const log = createLogger("TelegramBot");

const BOT_NAME = process.env.BOT_NAME || "Sarkar Local Agent";

const SYSTEM_PROMPT = `You are a local machine assistant named ${BOT_NAME}. Users will ask you to perform tasks on their computer via Telegram.

You have access to tools to execute commands, read/write files, and explore the filesystem. Use them to help users accomplish their tasks.

IMPORTANT RULES:
- Be concise in your responses (Telegram messages should be brief)
- Use the available tools to accomplish tasks
- For dangerous operations, explain what you're about to do before doing it
- Never use sudo unless explicitly asked
- Keep responses under 4000 characters (Telegram limit)`;

export async function startTelegramBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUserId = parseInt(process.env.ALLOWED_USER_ID || "0", 10);

  if (!token || !allowedUserId) {
    throw new Error("TELEGRAM_BOT_TOKEN and ALLOWED_USER_ID required for Telegram bot");
  }

  const bot = new Bot(token);
  const executor = new Executor();
  const workingDir = process.env.WORKING_DIR || process.env.HOME || "/";

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
        "• `show disk usage`\n\n" +
        "*Commands:*\n" +
        "• /status - System info\n" +
        "• /reset - Clear memory & start fresh",
      { parse_mode: "Markdown" }
    )
  );

  bot.command("status", async (ctx) => {
    const pending = approvalManager.getPendingActions();
    const info = await executor.getSystemInfo();
    const hasSession = chatSessions.has(ctx.chat.id);
    await ctx.reply(
      `🖥️ *System Status*\n\n` +
        `• Host: ${info.hostname || "unknown"}\n` +
        `• Platform: ${info.platform}\n` +
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

  // Main message handler - use Claude Agent SDK with sessions
  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const chatId = ctx.chat.id;
    const thinkingMsg = await ctx.reply("🤔 Thinking...");

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

      // Build query options - resume if we have an existing session
      const queryOptions: any = {
        systemPrompt: SYSTEM_PROMPT,
        cwd: workingDir,
        allowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        maxTurns: 10,
      };

      // If we have an existing session, resume it
      if (existingSessionId) {
        queryOptions.resume = existingSessionId;
        log.debug("Resuming session", { sessionId: existingSessionId });
      }

      // Use Claude Agent SDK to process the request
      for await (const message of query({
        prompt: userMessage,
        options: queryOptions,
      })) {
        log.debug("Agent message", { type: message.type, subtype: (message as any).subtype });

        // Capture session ID from init message
        if (message.type === "system" && (message as any).subtype === "init") {
          newSessionId = (message as any).session_id;
          log.debug("Got session ID", { sessionId: newSessionId });
        }

        // Collect the final result
        if ("result" in message && message.result) {
          result = message.result;
        }

        // Handle assistant text messages
        if (message.type === "assistant" && "content" in message) {
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                result = block.text;
              }
            }
          }
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
    onStart: (info) => console.log(`✅ Telegram bot @${info.username} running`),
  });
}
