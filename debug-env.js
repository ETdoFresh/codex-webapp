// Debug script to check environment when spawning codex
import { spawn } from 'child_process';

const codexPath = '/Users/etgarcia/temp/codex-webapp/node_modules/@openai/codex-sdk/vendor/aarch64-apple-darwin/codex/codex';

console.log('=== Environment Check ===');
console.log('HOME:', process.env.HOME);
console.log('USER:', process.env.USER);
console.log('LOGNAME:', process.env.LOGNAME);
console.log('PATH:', process.env.PATH?.substring(0, 100) + '...');
console.log('');
console.log('Testing codex login status...');

const child = spawn(codexPath, ['login', 'status'], {
  env: { ...process.env }
});

child.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString().trim());
});

child.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString().trim());
});

child.on('exit', (code) => {
  console.log('Exit code:', code);

  // Now test with exec
  console.log('\nTesting codex exec...');
  const child2 = spawn(codexPath, ['exec', '--experimental-json', 'hello'], {
    env: { ...process.env }
  });

  child2.stdin.end();

  child2.stdout.on('data', (data) => {
    console.log('EXEC STDOUT:', data.toString().trim());
  });

  child2.stderr.on('data', (data) => {
    console.error('EXEC STDERR:', data.toString().trim());
  });

  child2.on('exit', (code) => {
    console.log('Exec exit code:', code);
    process.exit(0);
  });
});

setTimeout(() => {
  console.log('Timeout - killing processes');
  process.exit(1);
}, 10000);
