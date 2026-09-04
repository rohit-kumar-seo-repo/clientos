import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 64 lowercase hex characters — matches AdminSession.token's VarChar(64). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}
