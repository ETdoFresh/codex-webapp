#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

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

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '..');

const frontendUrl = mode === 'dev' ? 'http://localhost:5173' : 'http://localhost:4173';
const backendUrl = 'http://localhost:4000';
const proxyPort = process.env.PORT ?? '3000';

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
    env: { PORT: '4000' },
    readyCheck: {
      url: `${backendUrl}/health`,
      validateStatus: (status) => status >= 200 && status < 300,
      label: 'backend health endpoint'
    }
  },
  {
    name: 'proxy',
    cwd: path.join(rootDir, 'proxy'),
    script: mode,
    env: {
      FRONTEND_URL: frontendUrl,
      BACKEND_URL: backendUrl,
      PORT: proxyPort
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
      }
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
