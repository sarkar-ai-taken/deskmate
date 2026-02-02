import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildAllowedUsers } from "../src/cli";

describe("buildAllowedUsers", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ALLOWED_USERS = process.env.ALLOWED_USERS;
    savedEnv.ALLOWED_USER_ID = process.env.ALLOWED_USER_ID;
    delete process.env.ALLOWED_USERS;
    delete process.env.ALLOWED_USER_ID;
  });

  afterEach(() => {
    if (savedEnv.ALLOWED_USERS !== undefined) {
      process.env.ALLOWED_USERS = savedEnv.ALLOWED_USERS;
    } else {
      delete process.env.ALLOWED_USERS;
    }
    if (savedEnv.ALLOWED_USER_ID !== undefined) {
      process.env.ALLOWED_USER_ID = savedEnv.ALLOWED_USER_ID;
    } else {
      delete process.env.ALLOWED_USER_ID;
    }
  });

  it("returns empty array when no env vars set", () => {
    expect(buildAllowedUsers()).toEqual([]);
  });

  it("parses ALLOWED_USERS correctly", () => {
    process.env.ALLOWED_USERS = "telegram:123,discord:456";
    const users = buildAllowedUsers();
    expect(users).toEqual([
      { clientType: "telegram", platformUserId: "123" },
      { clientType: "discord", platformUserId: "456" },
    ]);
  });

  it("handles whitespace and empty entries in ALLOWED_USERS", () => {
    process.env.ALLOWED_USERS = " telegram:123 , , discord:456 ";
    const users = buildAllowedUsers();
    expect(users).toEqual([
      { clientType: "telegram", platformUserId: "123" },
      { clientType: "discord", platformUserId: "456" },
    ]);
  });

  it("handles legacy ALLOWED_USER_ID fallback", () => {
    process.env.ALLOWED_USER_ID = "789";
    const users = buildAllowedUsers();
    expect(users).toEqual([
      { clientType: "telegram", platformUserId: "789" },
    ]);
  });

  it("ignores ALLOWED_USER_ID when value is '0'", () => {
    process.env.ALLOWED_USER_ID = "0";
    expect(buildAllowedUsers()).toEqual([]);
  });

  it("deduplicates telegram entries from ALLOWED_USERS and ALLOWED_USER_ID", () => {
    process.env.ALLOWED_USERS = "telegram:123,discord:456";
    process.env.ALLOWED_USER_ID = "123";
    const users = buildAllowedUsers();
    // Should NOT have telegram:123 twice
    expect(users).toEqual([
      { clientType: "telegram", platformUserId: "123" },
      { clientType: "discord", platformUserId: "456" },
    ]);
  });

  it("adds legacy user when not a duplicate", () => {
    process.env.ALLOWED_USERS = "telegram:123";
    process.env.ALLOWED_USER_ID = "999";
    const users = buildAllowedUsers();
    expect(users).toEqual([
      { clientType: "telegram", platformUserId: "123" },
      { clientType: "telegram", platformUserId: "999" },
    ]);
  });

  it("handles userId containing colons", () => {
    process.env.ALLOWED_USERS = "slack:U:123:456";
    const users = buildAllowedUsers();
    expect(users).toEqual([
      { clientType: "slack", platformUserId: "U:123:456" },
    ]);
  });
});
