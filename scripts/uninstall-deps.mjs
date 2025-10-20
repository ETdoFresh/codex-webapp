#!/usr/bin/env node

/**
 * Cross-platform dependency cleanup script invoked by `npm run uninstall`.
 * Removes the `node_modules` directories for each service so that the next
 * `npm run install` starts from a clean slate—useful when native modules were
 * built on a different platform.
 */

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, '..');

const targets = [
  { name: 'frontend', dir: path.join(rootDir, 'frontend', 'node_modules') },
  { name: 'backend', dir: path.join(rootDir, 'backend', 'node_modules') },
  { name: 'reverse-proxy', dir: path.join(rootDir, 'reverse-proxy', 'node_modules') }
];

const removeDirectory = async (target) => {
  try {
    await rm(target.dir, { recursive: true, force: true });
    console.log(`[uninstall] Removed ${target.name} node_modules`);
  } catch (error) {
    throw new Error(
      `Failed to remove ${target.name} dependencies (${target.dir}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

try {
  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    await removeDirectory(target);
  }

  console.log('[uninstall] Dependency directories removed. Run `npm run install` to reinstall.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
