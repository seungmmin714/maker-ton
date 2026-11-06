import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backendOrigin, configureBackend } from '../scripts/configure-backend.mjs';

test('backend setup rejects invalid destinations and accepts HTTPS or local development origins', () => {
  assert.equal(backendOrigin('https://api.example.com/'), 'https://api.example.com');
  assert.equal(backendOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  for (const value of [undefined, '<BACKEND_URL>', 'https://backend-url-required.invalid',
    'http://api.example.com', 'https://user:password@api.example.com',
    'https://api.example.com/api', 'https://api.example.com/?key=secret']) {
    assert.throws(() => backendOrigin(value));
  }
});

test('backend setup updates production and development targets while preserving unrelated environment values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maker-ton-config-'));
  try {
    await writeFile(join(root, 'vercel.json'), JSON.stringify({ rewrites: [
      { source: '/api/:path*', destination: 'https://backend-url-required.invalid/api/:path*' },
      { source: '/nfc/:device', destination: '/index.html' },
    ] }));
    const original = 'PRIVATE_SERVER_VALUE=private-test-value\nBACKEND_URL=https://old.example.com\nVITE_SUPABASE_URL=https://test.supabase.co\n';
    await writeFile(join(root, '.env'), original);
    await configureBackend('https://new.example.com/', root);
    const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
    assert.equal(config.rewrites[0].destination, 'https://new.example.com/api/:path*');
    assert.equal(config.rewrites[1].destination, '/index.html');
    assert.equal(await readFile(join(root, '.env'), 'utf8'), original.replace('https://old.example.com', 'https://new.example.com'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
