import { describe, it, expect } from "vitest";
import { SecurityManager } from "../src/gateway/security";

describe("SecurityManager", () => {
  it("authorizes an exact match", () => {
    const sm = new SecurityManager([
      { clientType: "telegram", platformUserId: "123" },
    ]);
    expect(sm.isAuthorized("telegram", "123")).toBe(true);
  });

  it("rejects an unknown user", () => {
    const sm = new SecurityManager([
      { clientType: "telegram", platformUserId: "123" },
    ]);
    expect(sm.isAuthorized("telegram", "999")).toBe(false);
  });

  it("rejects an unknown clientType", () => {
    const sm = new SecurityManager([
      { clientType: "telegram", platformUserId: "123" },
    ]);
    expect(sm.isAuthorized("discord", "123")).toBe(false);
  });

  it("authorizes with wildcard userId", () => {
    const sm = new SecurityManager([
      { clientType: "telegram", platformUserId: "*" },
    ]);
    expect(sm.isAuthorized("telegram", "anyone")).toBe(true);
    expect(sm.isAuthorized("discord", "anyone")).toBe(false);
  });

  it("authorizes with wildcard clientType", () => {
    const sm = new SecurityManager([
      { clientType: "*", platformUserId: "123" },
    ]);
    expect(sm.isAuthorized("telegram", "123")).toBe(true);
    expect(sm.isAuthorized("discord", "123")).toBe(true);
    expect(sm.isAuthorized("discord", "999")).toBe(false);
  });

  it("authorizes with full wildcard (* / *)", () => {
    const sm = new SecurityManager([
      { clientType: "*", platformUserId: "*" },
    ]);
    expect(sm.isAuthorized("any", "any")).toBe(true);
  });

  it("addUser grants authorization after construction", () => {
    const sm = new SecurityManager([]);
    expect(sm.isAuthorized("telegram", "456")).toBe(false);

    sm.addUser({ clientType: "telegram", platformUserId: "456" });
    expect(sm.isAuthorized("telegram", "456")).toBe(true);
  });
});
