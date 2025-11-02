#!/usr/bin/env node

/**
 * Cross-platform MCP launcher for chrome-devtools-mcp
 * Works on both macOS/Linux and Windows
 */

const { spawn } = require('child_process');
const process = require('process');

const isWindows = process.platform === 'win32';

// On Windows, we need to use cmd /c to run npx
// On macOS/Linux, we can run npx directly
const command = isWindows ? 'cmd' : 'npx';
const args = isWindows
  ? ['/c', 'npx', '-y', 'chrome-devtools-mcp@latest']
  : ['-y', 'chrome-devtools-mcp@latest'];

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: false,
  windowsHide: true
});

child.on('error', (err) => {
  console.error('Failed to start chrome-devtools-mcp:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
