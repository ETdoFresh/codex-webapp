import { spawn } from 'child_process';

const codexPath = '/Users/etgarcia/temp/codex-webapp/node_modules/@openai/codex-sdk/vendor/aarch64-apple-darwin/codex/codex';
const args = ['exec', '--experimental-json', '--sandbox', 'workspace-write', '--cd', '/Users/etgarcia/temp/codex-webapp/workspaces/478d4417-086d-46c7-84c9-c3d801b22fb1', '--skip-git-repo-check'];

console.log('Spawning codex with args:', args);
console.log('Environment HOME:', process.env.HOME);

const child = spawn(codexPath, args, {
  env: { ...process.env }
});

child.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString());
});

child.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString());
});

child.on('error', (err) => {
  console.error('Spawn error:', err);
});

child.on('exit', (code) => {
  console.log('Exit code:', code);
});

// Write input
child.stdin.write('hello\n');
child.stdin.end();

setTimeout(() => {
  if (!child.killed) {
    console.log('Killing process after timeout');
    child.kill();
  }
}, 15000);
