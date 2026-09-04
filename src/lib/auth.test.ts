import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateSessionToken } from "@/lib/auth";

describe("hashPassword / verifyPassword", () => {
  it("produces a hash that verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("never returns the plaintext as the hash", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
  });
});

describe("generateSessionToken", () => {
  it("returns a 64-character lowercase hex string", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different token on each call", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });
});
