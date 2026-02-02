import { Bot, InlineKeyboard, InputFile } from "grammy";
import { createLogger } from "../core/logger";
import type {
  MessagingClient,
  MessageHandler,
  OutgoingMessage,
  ApprovalPrompt,
} from "../gateway/types";

const log = createLogger("TelegramClient");

export class TelegramClient implements MessagingClient {
  readonly clientType = "telegram";
  private bot: Bot;
  private handler: MessageHandler | null = null;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  async start(handler: MessageHandler): Promise<void> {
    this.handler = handler;

    // Map commands to IncomingMessage
    this.bot.command("start", (ctx) => this.dispatch(ctx, "start"));
    this.bot.command("screenshot", (ctx) => this.dispatch(ctx, "screenshot"));
    this.bot.command("status", (ctx) => this.dispatch(ctx, "status"));
    this.bot.command("reset", (ctx) => this.dispatch(ctx, "reset"));

    // Text messages
    this.bot.on("message:text", async (ctx) => {
      if (!this.handler) return;
      await this.handler.handleMessage({
        platformMessageId: String(ctx.message.message_id),
        channelId: String(ctx.chat.id),
        userId: String(ctx.from?.id ?? ""),
        clientType: this.clientType,
        text: ctx.message.text,
      });
    });

    // Approval callbacks
    this.bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
      if (!this.handler) return;
      const actionId = ctx.match![1];
      await this.handler.handleApproval(
        { actionId, approved: true },
        String(ctx.chat?.id ?? ""),
      );
      await ctx.answerCallbackQuery({ text: "Approved!" });
    });

    this.bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
      if (!this.handler) return;
      const actionId = ctx.match![1];
      await this.handler.handleApproval(
        { actionId, approved: false },
        String(ctx.chat?.id ?? ""),
      );
      await ctx.answerCallbackQuery({ text: "Rejected" });
    });

    // Start polling
    this.bot.start({
      drop_pending_updates: true,
      onStart: (info) =>
        log.info("Telegram bot started", { username: info.username }),
    });
  }

  private async dispatch(
    ctx: any,
    command: string,
  ): Promise<void> {
    if (!this.handler) return;
    await this.handler.handleMessage({
      platformMessageId: String(ctx.message?.message_id ?? ""),
      channelId: String(ctx.chat.id),
      userId: String(ctx.from?.id ?? ""),
      clientType: this.clientType,
      text: ctx.message?.text ?? "",
      command,
    });
  }

  async sendMessage(message: OutgoingMessage): Promise<string | undefined> {
    const chatId = Number(message.channelId);

    // Image message
    if (message.image) {
      const source =
        typeof message.image === "string"
          ? new InputFile(message.image)
          : new InputFile(message.image);
      const sent = await this.bot.api.sendPhoto(chatId, source, {
        caption: message.imageCaption,
      });
      return String(sent.message_id);
    }

    const text = message.text ?? "";
    const truncated = text.slice(0, 4000);

    // Edit existing message
    if (message.editMessageId) {
      const msgId = Number(message.editMessageId);
      try {
        if (message.parseMode === "markdown") {
          await this.bot.api.editMessageText(chatId, msgId, truncated, {
            parse_mode: "Markdown",
          });
        } else {
          await this.bot.api.editMessageText(chatId, msgId, truncated);
        }
      } catch {
        // If markdown parse fails, retry as plain
        await this.bot.api.editMessageText(chatId, msgId, truncated);
      }
      return message.editMessageId;
    }

    // New message
    const opts: any = {};
    if (message.parseMode === "markdown") {
      opts.parse_mode = "Markdown";
    }
    const sent = await this.bot.api.sendMessage(chatId, truncated, opts);
    return String(sent.message_id);
  }

  async sendApprovalPrompt(prompt: ApprovalPrompt): Promise<void> {
    const chatId = Number(prompt.channelId);
    const keyboard = new InlineKeyboard()
      .text("Approve", `approve:${prompt.actionId}`)
      .text("Reject", `reject:${prompt.actionId}`);

    let emoji = "";
    switch (prompt.type) {
      case "command":
        emoji = "Command";
        break;
      case "write_file":
        emoji = "Write File";
        break;
      case "folder_access":
        emoji = "Folder Access";
        break;
      case "read_file":
        emoji = "Read File";
        break;
      default:
        emoji = "Action";
    }

    await this.bot.api.sendMessage(
      chatId,
      `*Approval Required — ${emoji}*\n\n` +
        `Type: \`${prompt.type}\`\n` +
        `${prompt.description}\n\n` +
        `${prompt.details}\n\n` +
        `Expires in ${prompt.expiresInSeconds}s`,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  }

  async updateApprovalStatus(
    channelId: string,
    _actionId: string,
    approved: boolean,
  ): Promise<void> {
    // The callback query handler already answered; we don't need to
    // edit anything extra here since Grammy's callbackQuery handler
    // will have already been invoked. If we wanted to edit the original
    // approval message we'd need to track message IDs per actionId.
    // For now, the inline callback answer suffices.
    log.debug("Approval status updated", { channelId, approved });
  }

  async stop(): Promise<void> {
    this.bot.stop();
    log.info("Telegram bot stopped");
  }
}
