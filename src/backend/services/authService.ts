import crypto from "node:crypto";
import { promisify } from "node:util";
import database from "../db";
import type { LoginSessionRecord, UserRecord } from "../types/database";

const scrypt = promisify(crypto.scrypt);

const SALT_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_USERNAME = "etdofresh";
const TEMP_PASSWORD_BYTES = 12;

const PASSWORD_STRENGTH_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function isPasswordStrong(password: string): boolean {
  return PASSWORD_STRENGTH_REGEX.test(password);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH_BYTES);
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH_BYTES)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [saltHex, keyHex] = storedHash.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  let derived: Buffer;
  try {
    derived = (await scrypt(password, salt, expected.length)) as Buffer;
  } catch {
    return false;
  }

  if (derived.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(derived, expected);
}

export function validatePasswordStrength(password: string): void {
  if (!isPasswordStrong(password)) {
    throw new Error(
      "Password must be at least 8 characters and include a letter and number.",
    );
  }
}

export async function ensureDefaultAdmin(): Promise<{
  username: string;
  password: string;
} | null> {
  const existing = database.getUserByUsername(DEFAULT_ADMIN_USERNAME);
  if (existing) {
    return null;
  }

  const temporaryPassword = crypto.randomBytes(TEMP_PASSWORD_BYTES).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);
  const user = database.createUser({
    username: DEFAULT_ADMIN_USERNAME,
    passwordHash,
    isAdmin: true,
  });

  console.warn(
    `[codex-webapp] Created default admin user '${user.username}'. Temporary password: ${temporaryPassword}`,
  );

  return { username: user.username, password: temporaryPassword };
}

export function calculateSessionExpiry(ttlMs: number = SESSION_TTL_MS): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

export function getDefaultSessionTtlMs(): number {
  return SESSION_TTL_MS;
}

export function issueLoginSession(
  userId: string,
  ttlMs: number = SESSION_TTL_MS,
): LoginSessionRecord {
  const expiresAt = calculateSessionExpiry(ttlMs);
  return database.createLoginSession({ userId, expiresAt });
}

export function revokeLoginSession(sessionId: string): void {
  database.deleteLoginSession(sessionId);
}

export function pruneExpiredLoginSessions(): number {
  return database.deleteExpiredLoginSessions(new Date().toISOString());
}

export function sanitizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeUsername(input: string): string {
  return input.trim();
}

export function findUserByUsername(username: string): UserRecord | null {
  return database.getUserByUsername(sanitizeUsername(username));
}

export function listUsers(): UserRecord[] {
  return database.listUsers();
}

export function getUserById(userId: string): UserRecord | null {
  return database.getUserById(userId);
}
