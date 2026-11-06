import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.trim()) {
  console.log('Remote database verification SKIPPED: DATABASE_URL is not connected. Connect Neon and redeploy before using the API.');
  process.exit(0);
}

// The integration test creates an unpredictable temporary schema and drops
// only that schema. It never seeds, clears, or changes production user tables.
console.log('Verifying the connected Postgres database using independent app instances and a temporary test schema.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['--test', '--test-reporter=tap', 'tests/postgres.integration.test.mjs'], {
  cwd: root,
  env: { ...process.env, TEST_DATABASE_URL: connectionString },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
const collect = chunk => { output = (output + chunk.toString()).slice(-120_000); };
child.stdout.on('data', collect);
child.stderr.on('data', collect);
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 240_000);
timeout.unref();

function redact(value) {
  const secrets = Object.entries(process.env)
    .filter(([key, entry]) => entry && entry.length >= 6 && /(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|POSTGRES_URL)/i.test(key))
    .map(([, entry]) => entry);
  try {
    const url = new URL(connectionString);
    if (url.password) secrets.push(url.password, decodeURIComponent(url.password));
  } catch { /* A malformed connection string will fail the test safely. */ }
  for (const secret of secrets.sort((a, b) => b.length - a.length)) value = value.split(secret).join('[REDACTED]');
  return value.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[REDACTED_DATABASE_URL]');
}

child.once('error', () => {
  clearTimeout(timeout);
  console.error('Remote database verification could not start. The deployment build is stopped.');
  process.exitCode = 1;
});
child.once('close', (code, signal) => {
  clearTimeout(timeout);
  if (output) process.stdout.write(redact(output));
  if (code !== 0 || signal || timedOut) {
    console.error(timedOut
      ? 'Remote database verification timed out. The deployment build is stopped.'
      : 'Remote database verification FAILED. The deployment build is stopped.');
    process.exitCode = 1;
    return;
  }
  console.log('Remote database verification PASSED: real Postgres checks completed and the temporary test schema was cleaned up.');
});
