#!/usr/bin/env node

/**
 * Cross-platform dependency installer used by the root `npm install` script.
 * Sequentially runs `npm install` in the frontend, backend, and reverse-proxy
 * directories. When invoked with global `NODE_OPTIONS` that enable the Node.js
 * inspector, the script re-launches itself without the `--inspect*` flags so
 * Windows hosts with a busy inspector port (e.g. 9228/9229) can proceed.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INSPECT_RERUN_FLAG = 'CODEX_INSTALL_DEPS_RERUN';

const sanitizeNodeOptions = (value) => {
  if (!value || value.trim() === '') {
    return undefined;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  const filtered = tokens.filter((token) => !token.startsWith('--inspect'));

  if (filtered.length === 0) {
    return undefined;
  }

  return filtered.join(' ');
};

const createSanitizedEnv = () => {
  const env = { ...process.env };
  const sanitized = sanitizeNodeOptions(env.NODE_OPTIONS);

  if (sanitized === undefined) {
    delete env.NODE_OPTIONS;
  } else {
    env.NODE_OPTIONS = sanitized;
  }

  return env;
};

const rerunWithoutInspector = async (scriptPath) => {
  const env = createSanitizedEnv();
  env[INSPECT_RERUN_FLAG] = '1';

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Re-run terminated by signal ${signal}`));
        return;
      }

      resolve(typeof code === 'number' ? code : 0);
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to re-run installer without inspector: ${error.message}`));
    });
  });
};

const runInstall = (target, npmCommand, useShell) =>
  new Promise((resolve, reject) => {
    console.log(`[install] Installing dependencies for ${target.name}`);

    const child = spawn(npmCommand, ['install'], {
      cwd: target.cwd,
      stdio: 'inherit',
      env: createSanitizedEnv(),
      shell: useShell
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to start npm install for ${target.name}: ${error.message}`));
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      reject(new Error(`npm install for ${target.name} failed (${reason})`));
    });
  });

const main = async () => {
  const scriptPath = fileURLToPath(import.meta.url);
  const dirname = path.dirname(scriptPath);
  const rootDir = path.resolve(dirname, '..');

  if (
    process.execArgv.some((arg) => arg.startsWith('--inspect')) &&
    !process.env[INSPECT_RERUN_FLAG]
  ) {
    try {
      const exitCode = await rerunWithoutInspector(scriptPath);
      process.exit(exitCode);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  const useShell = process.platform === 'win32';
  const npmCommand = 'npm';

  const targets = [
    { name: 'frontend', cwd: path.join(rootDir, 'frontend') },
    { name: 'backend', cwd: path.join(rootDir, 'backend') },
    { name: 'reverse-proxy', cwd: path.join(rootDir, 'reverse-proxy') }
  ];

  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    await runInstall(target, npmCommand, useShell);
  }

  console.log('[install] All dependencies installed successfully');
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
