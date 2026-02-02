import { EventEmitter } from "events";
import { createLogger } from "./logger";
import { getProtectedFolderPatterns, extractBaseFolder } from "./platform";

const log = createLogger("Approval");

export interface PendingAction {
  id: string;
  type: "command" | "write_file" | "folder_access" | "read_file";
  description: string;
  details: Record<string, any>;
  createdAt: Date;
  expiresAt: Date;
  resolve: (approved: boolean) => void;
}

// Protected folders that require approval (platform-aware)
const PROTECTED_FOLDERS = getProtectedFolderPatterns();

export type ApprovalNotifier = (action: PendingAction) => Promise<void>;

export class ApprovalManager extends EventEmitter {
  private pendingActions = new Map<string, PendingAction>();
  private notifiers: ApprovalNotifier[] = [];
  private autoApprovePatterns: RegExp[] = [];
  private defaultTimeoutMs = 5 * 60 * 1000; // 5 minutes
  private approvedFolders = new Set<string>(); // Folders approved in this session
  private requireApprovalForAll: boolean;

  constructor() {
    super();
    this.requireApprovalForAll = process.env.REQUIRE_APPROVAL_FOR_ALL === "true";

    // Load pre-approved folders from env
    const allowedFolders = process.env.ALLOWED_FOLDERS?.split(":").filter(Boolean) || [];
    allowedFolders.forEach(folder => this.approvedFolders.add(folder));
  }

  // Check if a path requires folder access approval
  isProtectedPath(filePath: string): boolean {
    // If folder is already approved in this session, no approval needed
    for (const approved of this.approvedFolders) {
      if (filePath.startsWith(approved)) {
        return false;
      }
    }

    // Check against protected folder patterns
    return PROTECTED_FOLDERS.some(pattern => pattern.test(filePath));
  }

  // Mark a folder as approved for this session
  approveFolder(folderPath: string): void {
    this.approvedFolders.add(folderPath);
    log.info("Folder approved for session", { folderPath });
  }

  // Request approval for folder access
  async requestFolderAccess(filePath: string): Promise<boolean> {
    if (!this.isProtectedPath(filePath)) {
      return true; // Not protected, no approval needed
    }

    // Extract the base protected folder from the path
    const baseFolder = extractBaseFolder(filePath) || filePath;

    const approved = await this.requestApproval(
      "folder_access",
      `Access to ${baseFolder}`,
      { path: filePath, baseFolder },
      { autoApprove: false, timeoutMs: 2 * 60 * 1000 } // 2 minute timeout
    );

    if (approved) {
      this.approveFolder(baseFolder);
    }

    return approved;
  }

  addNotifier(notifier: ApprovalNotifier): void {
    this.notifiers.push(notifier);
  }

  addAutoApprovePattern(pattern: RegExp): void {
    this.autoApprovePatterns.push(pattern);
  }

  private shouldAutoApprove(action: PendingAction): boolean {
    // If require approval for all is set, never auto-approve
    if (this.requireApprovalForAll) {
      return false;
    }

    // Folder access always requires explicit approval
    if (action.type === "folder_access") {
      return false;
    }

    if (action.type === "command") {
      const cmd = action.details.command as string;
      // Safe read-only commands
      const safeCommands = [
        /^ls\b/,
        /^pwd$/,
        /^whoami$/,
        /^date$/,
        /^cat\s/,
        /^head\s/,
        /^tail\s/,
        /^wc\s/,
        /^du\s/,
        /^df\s/,
        /^echo\s/,
        /^which\s/,
        /^type\s/,
        /^file\s/,
        /^stat\s/,
        /^uname/,
        /^hostname$/,
        /^uptime$/,
        /^ps\b/,
        /^top\s+-l\s+1/,
        /^docker\s+ps/,
        /^docker\s+images/,
        /^git\s+status/,
        /^git\s+log/,
        /^git\s+branch/,
        /^git\s+diff/,
        /^npm\s+list/,
        /^node\s+-v/,
        /^python\s+--version/,
      ];

      for (const pattern of [...safeCommands, ...this.autoApprovePatterns]) {
        if (pattern.test(cmd)) {
          return true;
        }
      }
    }
    return false;
  }

  async requestApproval(
    type: "command" | "write_file" | "folder_access" | "read_file",
    description: string,
    details: Record<string, any>,
    options?: { autoApprove?: boolean; timeoutMs?: number }
  ): Promise<boolean> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;

    const action: PendingAction = {
      id,
      type,
      description,
      details,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
      resolve: () => {}, // Will be set below
    };

    // Check for auto-approve
    if (options?.autoApprove !== false && this.shouldAutoApprove(action)) {
      log.info("Action auto-approved", { id, type, description });
      log.debug("Auto-approved action details", { details });
      this.emit("auto-approved", action);
      return true;
    }

    log.info("Approval requested", { id, type, description, expiresAt: action.expiresAt });

    // Create a promise that will be resolved when approved/rejected
    const approvalPromise = new Promise<boolean>((resolve) => {
      action.resolve = resolve;
    });

    this.pendingActions.set(id, action);

    // Set up timeout
    const timeout = setTimeout(() => {
      if (this.pendingActions.has(id)) {
        log.warn("Approval request expired", { id, type, description });
        this.pendingActions.delete(id);
        action.resolve(false);
        this.emit("expired", action);
      }
    }, timeoutMs);

    // Notify all registered notifiers
    for (const notifier of this.notifiers) {
      try {
        await notifier(action);
      } catch (error) {
        console.error("Notifier error:", error);
      }
    }

    this.emit("pending", action);

    // Wait for approval
    const result = await approvalPromise;

    clearTimeout(timeout);
    this.pendingActions.delete(id);

    return result;
  }

  approve(actionId: string): boolean {
    const action = this.pendingActions.get(actionId);
    if (action) {
      log.info("Action approved", { id: actionId, type: action.type, description: action.description });
      action.resolve(true);
      this.emit("approved", action);
      return true;
    }
    log.warn("Attempted to approve unknown action", { actionId });
    return false;
  }

  reject(actionId: string): boolean {
    const action = this.pendingActions.get(actionId);
    if (action) {
      log.info("Action rejected", { id: actionId, type: action.type, description: action.description });
      action.resolve(false);
      this.emit("rejected", action);
      return true;
    }
    log.warn("Attempted to reject unknown action", { actionId });
    return false;
  }

  getPendingActions(): PendingAction[] {
    return Array.from(this.pendingActions.values());
  }

  getPendingAction(id: string): PendingAction | undefined {
    return this.pendingActions.get(id);
  }
}

// Singleton instance
export const approvalManager = new ApprovalManager();
