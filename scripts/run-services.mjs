#!/usr/bin/env node

/**
 * Orchestrates the local development environment by validating Node.js version,
 * then sequentially starting the frontend, backend, and reverse-proxy npm scripts,
 * waiting for each service to become ready before launching the next, and managing
 * graceful shutdown of all spawned processes on termination signals or unexpected exits.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const INSPECT_RERUN_FLAG = 'CODEX_RUN_SERVICES_RERUN';

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

const applySanitizedNodeOptions = () => {
  const sanitized = sanitizeNodeOptions(process.env.NODE_OPTIONS);
  if (sanitized === undefined) {
    delete process.env.NODE_OPTIONS;
  } else {
    process.env.NODE_OPTIONS = sanitized;
  }
  delete process.env[INSPECT_RERUN_FLAG];
};

const maybeRerunWithoutInspector = async () => {
  const hasInspector = process.execArgv.some((arg) => arg.startsWith('--inspect'));

  if (hasInspector && !process.env[INSPECT_RERUN_FLAG]) {
    console.warn(
      '[orchestrator] detected --inspect flag; restarting without inspector to avoid port conflicts'
    );

    const scriptPath = fileURLToPath(import.meta.url);
    const env = { ...process.env };
    const sanitized = sanitizeNodeOptions(env.NODE_OPTIONS);
    if (sanitized === undefined) {
      delete env.NODE_OPTIONS;
    } else {
      env.NODE_OPTIONS = sanitized;
    }
    env[INSPECT_RERUN_FLAG] = '1';

    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...process.argv.slice(2)], {
        stdio: 'inherit',
        env
      });

      child.on('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`re-run terminated by signal ${signal}`));
          return;
        }
        resolve(typeof code === 'number' ? code : 0);
      });

      child.on('error', (error) => {
        reject(new Error(`failed to re-run orchestrator without inspector: ${error.message}`));
      });
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      return 1;
    });

    process.exit(exitCode);
  }

  applySanitizedNodeOptions();
};

await maybeRerunWithoutInspector();

const MINIMUM_NODE_VERSION = 18;
const [nodeMajor] = process.versions.node
  .split('.')
  .map((part) => Number.parseInt(part, 10));

if (Number.isNaN(nodeMajor) || nodeMajor < MINIMUM_NODE_VERSION) {
  console.error(
    `[orchestrator] Node.js ${MINIMUM_NODE_VERSION}.x or newer is required (current: ${process.versions.node})`
  );
  process.exit(1);
}

const mode = process.argv[2] ?? 'dev';
if (!['dev', 'start'].includes(mode)) {
  console.error('[orchestrator] usage: npm run dev|start');
  process.exit(1);
}

const npmCommand = 'npm';
const useShell = process.platform === 'win32';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '..');

const frontendUrl = mode === 'dev' ? 'http://localhost:5173' : 'http://localhost:4173';
const backendUrl = 'http://localhost:4000';
const reverseProxyPort = process.env.PORT ?? '3000';

const resolveCodexPath = () => {
  if (process.env.CODEX_PATH && process.env.CODEX_PATH.trim() !== '') {
    return process.env.CODEX_PATH;
  }

  const locatorCommand = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locatorCommand, ['codex'], { encoding: 'utf8' });
  if (result.error) {
    return null;
  }

  if (result.status === 0) {
    const candidates = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');

    const normalizeWindowsPath = (rawPath) => {
      if (process.platform !== 'win32' || rawPath === '') {
        return rawPath;
      }

      const hasExtension = /\.[^.\\/:]+$/.test(rawPath);
      const candidates = hasExtension
        ? [rawPath]
        : [`${rawPath}.cmd`, `${rawPath}.exe`, `${rawPath}.bat`, rawPath];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }

      return rawPath;
    };

    for (const candidate of candidates) {
      const normalized = normalizeWindowsPath(candidate);
      if (existsSync(normalized)) {
        return normalized;
      }
    }
  }

  return null;
};

const detectedCodexPath = resolveCodexPath();

const services = [
  {
    name: 'frontend',
    cwd: path.join(rootDir, 'frontend'),
    script: mode,
    env: {},
    readyCheck: {
      url: frontendUrl,
      validateStatus: (status) => status >= 200 && status < 500,
      label: 'frontend dev server'
    }
  },
  {
    name: 'backend',
    cwd: path.join(rootDir, 'backend'),
    script: mode,
    env: {
      PORT: '4000',
      ...(detectedCodexPath ? { CODEX_PATH: detectedCodexPath } : {})
    },
    readyCheck: {
      url: `${backendUrl}/health`,
      validateStatus: (status) => status >= 200 && status < 300,
      label: 'backend health endpoint'
    }
  },
  {
    name: 'reverse-proxy',
    cwd: path.join(rootDir, 'reverse-proxy'),
    script: mode,
    env: {
      FRONTEND_URL: frontendUrl,
      BACKEND_URL: backendUrl,
      PORT: reverseProxyPort
    }
  }
];

const processes = new Map();
let shuttingDown = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForAvailability = async (serviceName, { url, validateStatus, label }) => {
  if (!url) {
    return;
  }

  const attempts = 40;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (validateStatus(response.status)) {
        console.log(`[orchestrator] ${serviceName} ready (${label})`);
        return;
      }

      console.log(
        `[orchestrator] waiting for ${serviceName} (${label}) - received ${response.status} ${response.statusText} (attempt ${attempt}/${attempts})`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      console.log(
        `[orchestrator] waiting for ${serviceName} (${label}) - ${message} (attempt ${attempt}/${attempts})`
      );
    }

    await wait(500);
  }

  throw new Error(
    `[orchestrator] ${serviceName} failed to become ready after ${attempts} attempts (${label})`
  );
};

const spawnService = (service) => {
  console.log(`[orchestrator] starting ${service.name} (${service.script})`);
  const child = spawn(
    npmCommand,
    ['run', service.script],
    {
      cwd: service.cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...service.env
      },
      shell: useShell
    }
  );

  processes.set(service.name, child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ?? code;
    console.error(`[orchestrator] ${service.name} exited unexpectedly (${reason ?? 'unknown'})`);
    shutdown(typeof code === 'number' ? code : 1);
  });

  child.on('error', (error) => {
    console.error(`[orchestrator] failed to start ${service.name}: ${error.message}`);
    shutdown(1);
  });

  return child;
};

const shutdown = (code = 0) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of processes.values()) {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  }

  setTimeout(() => process.exit(code), 500);
};

process.on('SIGINT', () => {
  console.log('[orchestrator] received SIGINT');
  shutdown(0);
});

process.on('SIGTERM', () => {
  console.log('[orchestrator] received SIGTERM');
  shutdown(0);
});

try {
  const [frontend, backend, proxy] = services;

  spawnService(frontend);
  await waitForAvailability(frontend.name, frontend.readyCheck);

  spawnService(backend);
  await waitForAvailability(backend.name, backend.readyCheck);

  spawnService(proxy);
  console.log(
    `[orchestrator] proxy started with FRONTEND_URL=${proxy.env.FRONTEND_URL} BACKEND_URL=${proxy.env.BACKEND_URL} PORT=${proxy.env.PORT}`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
