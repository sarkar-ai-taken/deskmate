/**
 * Gateway Types
 *
 * Shared interfaces for the multi-client gateway architecture.
 * Platform adapters implement MessagingClient; the Gateway implements MessageHandler.
 */

export interface IncomingMessage {
  platformMessageId: string;
  channelId: string;
  userId: string;
  clientType: string;
  text: string;
  command?: string;
}

export interface OutgoingMessage {
  channelId: string;
  text?: string;
  image?: string | Buffer;
  imageCaption?: string;
  editMessageId?: string;
  parseMode?: "markdown" | "plain";
}

export interface ApprovalPrompt {
  channelId: string;
  actionId: string;
  type: string;
  description: string;
  details: string;
  expiresInSeconds: number;
}

export interface ApprovalResponse {
  actionId: string;
  approved: boolean;
}

export interface UserIdentity {
  clientType: string;
  platformUserId: string;
}

export interface MessagingClient {
  readonly clientType: string;
  start(handler: MessageHandler): Promise<void>;
  sendMessage(message: OutgoingMessage): Promise<string | undefined>;
  sendApprovalPrompt(prompt: ApprovalPrompt): Promise<void>;
  updateApprovalStatus(channelId: string, actionId: string, approved: boolean): Promise<void>;
  stop(): Promise<void>;
}

export interface MessageHandler {
  handleMessage(message: IncomingMessage): Promise<void>;
  handleApproval(response: ApprovalResponse, channelId: string): Promise<void>;
}

export interface GatewayConfig {
  botName: string;
  workingDir: string;
  allowedUsers: UserIdentity[];
  systemPrompt?: string;
  maxTurns?: number;
  storagePath?: string;
}
