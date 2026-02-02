import { createLogger } from "../core/logger";
import type { UserIdentity } from "./types";

const log = createLogger("SecurityManager");

export class SecurityManager {
  /** Map<clientType, Set<platformUserId>> — wildcard "*" matches any user */
  private allowList = new Map<string, Set<string>>();

  constructor(allowedUsers: UserIdentity[]) {
    for (const u of allowedUsers) {
      this.addUser(u);
    }
    log.info("SecurityManager initialized", { userCount: allowedUsers.length });
  }

  addUser(identity: UserIdentity): void {
    const { clientType, platformUserId } = identity;
    if (!this.allowList.has(clientType)) {
      this.allowList.set(clientType, new Set());
    }
    this.allowList.get(clientType)!.add(platformUserId);
    log.debug("User added to allowlist", { clientType, platformUserId });
  }

  isAuthorized(clientType: string, platformUserId: string): boolean {
    // Check wildcard first
    const wildcardSet = this.allowList.get("*");
    if (wildcardSet?.has("*") || wildcardSet?.has(platformUserId)) {
      return true;
    }

    const clientSet = this.allowList.get(clientType);
    if (!clientSet) return false;

    return clientSet.has("*") || clientSet.has(platformUserId);
  }
}
