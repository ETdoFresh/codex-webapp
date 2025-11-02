import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import database from "../db";
import { decryptSecret } from "../utils/secretVault";
import type { UserAuthFileRecord } from "../types/database";

const providerDirectoryMap: Record<UserAuthFileRecord["provider"], string> = {
  codex: ".codex",
  claude: ".claude",
  droid: ".droid",
  copilot: ".copilot",
};

const baseAuthDirectory = path.join(os.tmpdir(), "codex-webapp", "user-auth");

const ensureDirectory = (target: string) => {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
};

const writeAuthFile = (targetPath: string, content: string) => {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, { encoding: "utf8", mode: 0o600 });
};

export const getUserAuthHome = (userId: string): string => {
  const home = path.join(baseAuthDirectory, userId);
  ensureDirectory(home);
  return home;
};

const removeIfExists = (target: string) => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[codex-webapp] failed to remove auth directory ${target}:`,
      error instanceof Error ? error.message : error,
    );
  }
};

export const synchronizeUserAuthFiles = (userId: string): {
  homeDir: string;
  env: Record<string, string>;
} => {
  const homeDir = getUserAuthHome(userId);
  const files = database.listUserAuthFiles(userId);

  const providersWithFiles = new Set<UserAuthFileRecord["provider"]>();

  for (const record of files) {
    providersWithFiles.add(record.provider);
  }

  for (const [provider, folder] of Object.entries(providerDirectoryMap) as Array<
    [UserAuthFileRecord["provider"], string]
  >) {
    const providerDir = path.join(homeDir, folder);
    if (!providersWithFiles.has(provider)) {
      removeIfExists(providerDir);
    }
  }

  const clearedProviders = new Set<UserAuthFileRecord["provider"]>();

  for (const record of files) {
    const providerDirName = providerDirectoryMap[record.provider];
    const providerDir = path.join(homeDir, providerDirName);
    if (!clearedProviders.has(record.provider)) {
      removeIfExists(providerDir);
      clearedProviders.add(record.provider);
    }

    ensureDirectory(providerDir);

    const decrypted = decryptSecret(
      record.encryptedContent,
      record.encryptedIv,
      record.encryptedTag,
    );

    if (!decrypted) {
      console.warn(
        `[codex-webapp] unable to decrypt auth file ${record.fileName} for user ${userId}`,
      );
      continue;
    }

    const filePath = path.join(providerDir, record.fileName);
    writeAuthFile(filePath, decrypted);
  }

  // NOTE: Do NOT override HOME - let codex CLI use the real user's HOME
  // where authentication files (.codex/auth.json, .claude/, etc.) are located
  const env: Record<string, string> = {};

  if (process.platform === "win32") {
    env.USERPROFILE = homeDir;
    env.APPDATA = path.join(homeDir, "AppData", "Roaming");
    ensureDirectory(env.APPDATA);
  }

  return { homeDir, env };
};

/**
 * Exports user auth files as base64-encoded environment variables for container deployment
 */
export const exportAuthFilesAsEnvVars = (
  userId: string,
): Record<string, string> => {
  const files = database.listUserAuthFiles(userId);
  const envVars: Record<string, string> = {};

  for (const record of files) {
    const decrypted = decryptSecret(
      record.encryptedContent,
      record.encryptedIv,
      record.encryptedTag,
    );

    if (!decrypted) {
      console.warn(
        `[codex-webapp] unable to decrypt auth file ${record.fileName} for user ${userId}`,
      );
      continue;
    }

    // Create env var key: AUTH_FILE_{PROVIDER}_{FILENAME}
    const providerUpper = record.provider.toUpperCase();
    const fileNameSafe = record.fileName
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toUpperCase();
    const envKey = `AUTH_FILE_${providerUpper}_${fileNameSafe}`;

    // Base64 encode the file content
    const base64Content = Buffer.from(decrypted, "utf8").toString("base64");

    // Store both the content and the provider directory
    envVars[envKey] = base64Content;
    envVars[`${envKey}_DIR`] = providerDirectoryMap[record.provider];
    envVars[`${envKey}_NAME`] = record.fileName;
  }

  return envVars;
};
