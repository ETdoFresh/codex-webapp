import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const servicesDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(servicesDir, "..");
const srcRoot = path.resolve(backendRoot, "..");
const projectRoot = path.resolve(srcRoot, "..");
const defaultRoot = projectRoot;
const artifactsDir = path.join(projectRoot, "var", "deploy-artifacts");

fs.mkdirSync(artifactsDir, { recursive: true });

const sanitizeKey = (key: string): string => {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error("Invalid artifact key");
  }
  return key;
};

const TAR_EXCLUDES = [".git", "node_modules", "dist", "var", "workspaces", ".cache"];

export const createWorkspaceArchive = async (options?: {
  workspaceRoot?: string;
}): Promise<{
  key: string;
  path: string;
  size: number;
}> => {
  const workspaceRoot = options?.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : defaultRoot;

  const timestamp = Date.now();
  const key = `workspace-${timestamp}.tar.gz`;
  const outputPath = path.join(artifactsDir, key);

  const args = ["-czf", outputPath];
  TAR_EXCLUDES.forEach((exclude) => {
    args.push("--exclude", exclude);
  });
  args.push("-C", workspaceRoot, ".");

  await new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", args, { stdio: "ignore" });
    tar.on("error", (error) => reject(error));
    tar.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with code ${code}`));
      }
    });
  });

  const stats = await fsPromises.stat(outputPath);
  return { key, path: outputPath, size: stats.size }; 
};

export const getArtifactPath = (key: string): string => {
  const sanitized = sanitizeKey(key);
  return path.join(artifactsDir, sanitized);
};

export const removeArtifact = async (key: string): Promise<void> => {
  const artifactPath = getArtifactPath(key);
  await fsPromises.rm(artifactPath, { force: true });
};
