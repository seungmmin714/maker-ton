import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createApp, createConfig } from '../server/index.mjs';
import { createSqliteDatabase } from '../server/database.mjs';

const INITIAL = Date.parse('2026-11-06T05:00:00.000Z');
const DAY = 86_400_000;
const shape = { shape: 4, shape_status: 'selected', excretion_type: 'stool' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR4cAAAAASUVORK5CYII=';

test('async transactions isolate other requests and roll back across await boundaries', async t => {
  const db = await createSqliteDatabase(':memory:');
  t.after(() => db.close());
  await db.exec('CREATE TABLE counter (value INTEGER NOT NULL); INSERT INTO counter VALUES (0);');
  let signalStarted, finishTransaction;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { finishTransaction = resolve; });
  const pending = db.transaction(async () => {
    await db.prepare('UPDATE counter SET value=1').run();
    signalStarted();
    await gate;
    assert.equal((await db.prepare('SELECT value FROM counter').get()).value, 1);
    throw new Error('intentional rollback');
  });
  const rolledBack = assert.rejects(pending, /intentional rollback/);
  await started;
  let readFinished = false;
  const unrelatedRead = db.prepare('SELECT value FROM counter').get().then(row => { readFinished = true; return row; });
  const secondTransaction = db.transaction(async () => {
    assert.equal((await db.prepare('SELECT value FROM counter').get()).value, 0);
    await db.prepare('UPDATE counter SET value=2').run();
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readFinished, false, 'Other requests must not see uncommitted writes.');
  finishTransaction();
  await rolledBack;
  assert.equal((await unrelatedRead).value, 0);
  await secondTransaction;
  assert.equal((await db.prepare('SELECT value FROM counter').get()).value, 2);
});

test('an injected async database avoids local file creation and exposes the async handler', async t => {
  const database = await createSqliteDatabase(':memory:');
  const app = await createApp({ database, dbPath: '/not-a-writable-deployment-directory/database.sqlite', demoEnabled: true });
  t.after(() => app.close());
  assert.equal(app.handler.constructor.name, 'AsyncFunction');
  assert.equal(app.server.listeners('request')[0], app.handler);
  assert.equal((await inject(app, '/api/health')).data.ok, true);
  assert.equal((await database.prepare('SELECT count(*) AS count FROM devices').get()).count, 2);
});

test('Vercel requires durable storage and health checks query the database', async t => {
  await assert.rejects(createApp({ vercel: true, databaseUrl: '', dbPath: ':memory:' }), /DATABASE_URL is required/);
  const app = await createApp({ dbPath: ':memory:', databaseUrl: '', vercel: false });
  t.after(() => app.close());
  assert.equal((await inject(app, '/api/health')).status, 200);
  await app.db.close();
  const health = await inject(app, '/api/health');
  assert.equal(health.status, 503); assert.equal(health.data.code, 'DATABASE_UNAVAILABLE');
});

test('Vercel rate limits separate platform client IPs, while local requests cannot spoof forwarded IPs', async t => {
  for (const vercel of [true, false]) {
    const database = await createSqliteDatabase(':memory:');
    const app = await createApp({ database, vercel }); t.after(() => app.close());
    const attempt = ip => inject(app, '/api/auth/login', { method: 'POST', body: { email: 'invalid' }, headers: { 'x-vercel-forwarded-for': ip } });
    for (let index = 0; index < 25; index++) assert.equal((await attempt('198.51.100.1')).status, 400);
    assert.equal((await attempt('198.51.100.1')).status, 429);
    assert.equal((await attempt('198.51.100.2')).status, vercel ? 400 : 429);
  }
});

// The workspace disallows binding network ports. Exercise the complete HTTP
// listener with Node streams, including headers, cookies, bodies and responses.
async function inject(app, path, { method = 'GET', body, user, headers = {}, raw } = {}) {
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body));
  const request = Readable.from(payload ? [Buffer.from(payload)] : []);
  request.url = path; request.method = method; request.socket = { remoteAddress: '127.0.0.1' };
  request.headers = Object.fromEntries(Object.entries({ host: 'test.local', ...(payload ? { 'content-length': String(Buffer.byteLength(payload)) } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(user ? { cookie: user.cookie, 'x-csrf-token': user.csrf } : {}), ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  const chunks = [], responseHeaders = new Headers();
  const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.headersSent = false; response.statusCode = 200;
  response.setHeader = (name, value) => responseHeaders.set(name, value);
  response.writeHead = (status, values) => { response.statusCode = status; response.headersSent = true; for (const [k, v] of Object.entries(values || {})) responseHeaders.set(k, v); return response; };
  const finished = new Promise((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  app.server.emit('request', request, response);
  await finished;
  const text = Buffer.concat(chunks).toString(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.statusCode, data, headers: responseHeaders };
}

async function harness(t, options = {}) {
  let time = INITIAL;
  const app = (await createApp({ dbPath: ':memory:', demoEnabled: true, deviceToken: 'device-test-token', pairingCode: 'join-test-code',
    apiKey: '', model: '', secureCookie: false, publicOrigin: '', now: () => time, ...options }));
  t.after(() => app.close());
  const call = (path, options) => inject(app, path, options);
  async function register(label) {
    const result = await call('/api/auth/register', { method: 'POST', body: { name: label, email: `${label}@example.com`, password: 'password-1234', consent: true } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { id: result.data.user.id, cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrfToken, response: result };
  }
  async function joinReal(user) {
    assert.equal((await call('/api/devices/join', { method: 'POST', user, body: { device_id: 'toilet-01', code: 'join-test-code' } })).status, 200);
  }
  function event(id, ageSec = 120, overrides = {}) {
    const end = time - ageSec * 1000;
    return { session_id: id, device_id: 'toilet-01', measurement_status: 'completed', started_at: new Date(end - 180_000).toISOString(),
      ended_at: new Date(end).toISOString(), completed_at: new Date(end + 30_000).toISOString(), sitting_sec: 180,
      time_source: 'sensor', clock_status: 'synced', stool_color: 'brown', urine_color: 'pale_yellow', color_status: 'measured', spectral_raw: [12, 20, 31], env: { temp_c: 22 }, is_demo: false, ...overrides };
  }
  async function ingest(body) {
    return call('/api/device/events', { method: 'POST', body, headers: { Authorization: 'Bearer device-test-token' } });
  }
  async function claim(user, id, input = {}) {
    return call(`/api/sessions/${id}/claim`, { method: 'POST', user, body: { ...shape, request_id: `request-${id}`, ...input } });
  }
  return { ...app, call, register, joinReal, event, ingest, claim, now: () => time, advance: ms => { time += ms; } };
}

function authenticatedResponse(result) {
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { id: result.data.user.id, cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrfToken, response: result };
}

test('profile lists are private to explicit groups, lazily migrate old accounts, and never expose credentials or payments', async t => {
  const h = await harness(t), a = await h.register('profile-old'), b = await h.register('profile-unrelated');
  // Simulate a pre-profile account persisted in an existing deployment.
  const oldGroup = (await h.db.prepare('SELECT group_id FROM profile_members WHERE user_id=?').get(a.id)).group_id;
  await h.db.prepare('DELETE FROM profile_members WHERE user_id=?').run(a.id);
  await h.db.prepare('DELETE FROM profile_groups WHERE id=?').run(oldGroup);
  const results = await Promise.all([
    h.call('/api/auth/me', { user: a }), h.call('/api/profiles', { user: a }), h.call('/api/profiles', { user: a }),
  ]);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('set-cookie'), null, 'read-only profile restore cannot overwrite a freshly switched browser cookie');
    assert.deepEqual(result.data.profiles, [{ id: a.id, name: 'profile-old', is_current: true }]);
    assert.deepEqual(result.data.plan, { mode: 'free', profileCount: 1, paymentEnabled: false });
    assert.ok(!JSON.stringify(result.data.profiles).includes('email'));
  }
  assert.equal((await h.db.prepare('SELECT count(*) AS count FROM profile_members WHERE user_id=?').get(a.id)).count, 1);
  assert.deepEqual((await h.call('/api/profiles', { user: b })).data.profiles.map(p => p.id), [b.id]);
  assert.equal((await h.call('/api/profiles')).status, 401);
  assert.equal((await h.call('/api/payments', { method: 'POST', user: a })).status, 404);
});

test('new family profiles require consent and CSRF, share device access only, and rotate just this browser session', async t => {
  const h = await harness(t), a = await h.register('profile-parent');
  const otherPhone = authenticatedResponse(await h.call('/api/auth/login', { method: 'POST', body: { email: 'profile-parent@example.com', password: 'password-1234' } }));
  await h.joinReal(a);
  await h.call('/api/devices/toilet-01/checkins', { method: 'POST', user: a });
  await h.call('/api/demo/seed', { method: 'POST', user: a });
  const aRecord = (await h.call('/api/records', { user: a })).data.records[0];
  const aMeal = (await h.call('/api/meals', { user: a })).data.meals[0];
  const body = { name: '가족 프로필', email: 'profile-family@example.com', password: 'separate-family-password', consent: true };
  assert.equal((await h.call('/api/profiles/register', { method: 'POST', user: a, body: { ...body, consent: false } })).data.code, 'CONSENT_REQUIRED');
  assert.equal((await h.call('/api/profiles/register', { method: 'POST', user: a, body, headers: { 'X-CSRF-Token': 'wrong' } })).data.code, 'CSRF_REJECTED');
  assert.equal((await h.call('/api/profiles/register', { method: 'POST', user: a, body, headers: { Origin: 'https://evil.example' } })).data.code, 'ORIGIN_REJECTED');
  const b = authenticatedResponse(await h.call('/api/profiles/register', { method: 'POST', user: a, body }));
  assert.notEqual(a.cookie, b.cookie); assert.notEqual(a.csrf, b.csrf);
  assert.equal((await h.call('/api/auth/me', { user: a })).status, 401, 'old submitting session is revoked');
  assert.equal((await h.call('/api/auth/me', { user: otherPhone })).data.user.id, a.id, 'separate phone stays on its own profile');
  assert.deepEqual(b.response.data.plan, { mode: 'free', profileCount: 2, paymentEnabled: false });
  assert.deepEqual(b.response.data.devices.map(d => d.id), ['toilet-01', 'demo-toilet']);
  assert.equal((await h.db.prepare('SELECT count(*) AS count FROM checkins WHERE user_id=?').get(b.id)).count, 0);
  assert.equal((await h.call('/api/records', { user: b })).data.records.length, 0);
  assert.equal((await h.call('/api/meals', { user: b })).data.meals.length, 0);
  assert.equal((await h.call('/api/insights', { user: b })).data.record_count, 0);
  assert.equal((await h.call(`/api/records/${aRecord.id}`, { method: 'PATCH', user: b, body: shape })).status, 404);
  assert.equal((await h.call(`/api/records/${aRecord.id}`, { method: 'DELETE', user: b })).status, 404);
  assert.equal((await h.call(`/api/meals/${aMeal.id}`, { method: 'DELETE', user: b })).status, 404);
  const denied = await h.call('/api/profiles/switch', { method: 'POST', user: b, body: { profile_id: a.id, password: body.password } });
  assert.equal(denied.status, 403); assert.equal(denied.data.code, 'INVALID_PROFILE_PASSWORD');
  assert.equal(denied.headers.get('set-cookie'), null);
  assert.equal((await h.call('/api/auth/me', { user: b })).data.user.id, b.id);
  const back = authenticatedResponse(await h.call('/api/profiles/switch', { method: 'POST', user: b, body: { profile_id: a.id, password: 'password-1234' } }));
  assert.equal(back.id, a.id);
  assert.equal((await h.call('/api/records', { user: back })).data.records.length, 7);
  assert.equal((await h.call('/api/auth/me', { user: b })).status, 401);
  assert.equal((await h.call('/api/auth/me', { user: otherPhone })).status, 200);
});

test('linking verifies the target password, preserves its records, blocks other groups, and stale tabs fail closed', async t => {
  const h = await harness(t), a = await h.register('profile-a'), b = await h.register('profile-b'), c = await h.register('profile-c');
  await h.joinReal(a); await h.call('/api/demo/seed', { method: 'POST', user: b });
  const wrong = await h.call('/api/profiles/link', { method: 'POST', user: a, body: { email: 'profile-b@example.com', password: 'wrong-password' } });
  const absent = await h.call('/api/profiles/link', { method: 'POST', user: a, body: { email: 'missing@example.com', password: 'wrong-password' } });
  assert.equal(wrong.status, 403); assert.deepEqual(wrong.data, absent.data);
  assert.equal(wrong.headers.get('set-cookie'), null);
  const linked = authenticatedResponse(await h.call('/api/profiles/link', { method: 'POST', user: a, body: { email: 'profile-b@example.com', password: 'password-1234' } }));
  assert.equal(linked.id, b.id);
  assert.equal((await h.call('/api/records', { user: linked })).data.records.length, 7, 'existing target records are preserved');
  assert.equal((await h.call('/api/auth/me', { user: b })).status, 200);
  assert.deepEqual(linked.response.data.devices.map(d => d.id), ['toilet-01', 'demo-toilet']);
  for (const profile of linked.response.data.profiles) assert.deepEqual(Object.keys(profile).sort(), ['id', 'is_current', 'name']);
  const outside = await h.call('/api/profiles/switch', { method: 'POST', user: linked, body: { profile_id: c.id, password: 'password-1234' } });
  assert.equal(outside.status, 403); assert.equal(outside.data.code, 'INVALID_PROFILE_PASSWORD');
  const merging = await h.call('/api/profiles/link', { method: 'POST', user: c, body: { email: 'profile-b@example.com', password: 'password-1234' } });
  assert.equal(merging.status, 409); assert.equal(merging.data.code, 'PROFILE_GROUP_CONFLICT');
  assert.equal((await h.call('/api/auth/me', { user: c })).data.user.id, c.id);
  const staleRead = await h.call('/api/records', { user: linked, headers: { 'X-Profile-ID': a.id } });
  assert.equal(staleRead.status, 409); assert.equal(staleRead.data.code, 'PROFILE_CHANGED');
  assert.equal(staleRead.data.records, undefined);
  const staleMutation = await h.call('/api/account', { method: 'DELETE', user: linked, headers: { 'X-Profile-ID': a.id, 'X-CSRF-Token': a.csrf } });
  assert.equal(staleMutation.status, 409); assert.equal(staleMutation.data.code, 'PROFILE_CHANGED', 'identity mismatch checked before stale CSRF');
  assert.equal((await h.call('/api/auth/me', { user: linked, headers: { 'X-Profile-ID': a.id } })).data.user.id, b.id, 'identity restore bypasses expected-profile guard');
  assert.equal((await h.call('/api/auth/me', { user: b })).status, 200, 'stale request did not delete target');
});

test('concurrent links cannot merge unrelated families and profile deletion preserves surviving members', async t => {
  const h = await harness(t), a = await h.register('race-profile-a'), b = await h.register('race-profile-b'), c = await h.register('race-profile-c');
  const body = { email: 'race-profile-b@example.com', password: 'password-1234' };
  const results = await Promise.all([a, c].map(user => h.call('/api/profiles/link', { method: 'POST', user, body })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winnerIndex = results.findIndex(result => result.status === 200), source = [a, c][winnerIndex], loser = [a, c][1 - winnerIndex];
  const linked = authenticatedResponse(results[winnerIndex]);
  assert.deepEqual(new Set(linked.response.data.profiles.map(p => p.id)), new Set([source.id, b.id]));
  assert.equal((await h.call('/api/auth/me', { user: source })).status, 401);
  assert.equal((await h.call('/api/auth/me', { user: loser })).status, 200);
  const sourcePhone = authenticatedResponse(await h.call('/api/auth/login', { method: 'POST', body: { email: winnerIndex === 0 ? 'race-profile-a@example.com' : 'race-profile-c@example.com', password: 'password-1234' } }));
  assert.equal((await h.call('/api/account', { method: 'DELETE', user: linked })).status, 200);
  assert.equal((await h.call('/api/auth/me', { user: b })).status, 401);
  assert.deepEqual((await h.call('/api/profiles', { user: sourcePhone })).data.profiles.map(p => p.id), [source.id]);
  assert.equal((await h.call('/api/account', { method: 'DELETE', user: sourcePhone })).status, 200);
  assert.equal((await h.db.prepare('SELECT count(*) AS count FROM profile_groups').get()).count, 1, 'only unrelated survivor group remains');
});

test('two switches from the same browser cannot both consume an old authenticated session', async t => {
  const h = await harness(t), a = await h.register('switch-race-a'), b = await h.register('switch-race-b');
  const linked = authenticatedResponse(await h.call('/api/profiles/link', { method: 'POST', user: a, body: { email: 'switch-race-b@example.com', password: 'password-1234' } }));
  const results = await Promise.all([1, 2].map(() => h.call('/api/profiles/switch', { method: 'POST', user: linked, body: { profile_id: a.id, password: 'password-1234' } })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  const current = authenticatedResponse(results.find(result => result.status === 200));
  assert.equal(current.id, a.id);
  assert.equal((await h.call('/api/auth/me', { user: linked })).status, 401);
  assert.equal((await h.call('/api/auth/me', { user: b })).status, 200);
});

test('persistent cookie auth, consent, CSRF, origin and account isolation', async t => {
  const h = await harness(t);
  const a = await h.register('alice');
  assert.match(a.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000/);
  assert.equal(a.response.data.config.claimWindowSec, 600);
  assert.deepEqual(a.response.data.devices.map(d => d.id), ['demo-toilet']);
  const passwordHash = (await h.db.prepare('SELECT password_hash FROM users WHERE id=?').get(a.id)).password_hash;
  assert.ok(!passwordHash.includes('password-1234'));
  const storedToken = (await h.db.prepare('SELECT token_hash FROM auth_sessions WHERE user_id=?').get(a.id)).token_hash;
  assert.notEqual(storedToken, a.cookie.split('=')[1]);
  assert.equal((await h.call('/api/auth/me', { user: a })).data.user.id, a.id);
  assert.equal((await h.call('/api/auth/me')).status, 401);
  assert.equal((await h.call('/api/demo/seed', { method: 'POST', user: a, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await h.call('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: { email: 'alice@example.com', password: 'password-1234' } })).status, 403);
  assert.equal((await h.call('/api/auth/register', { method: 'POST', body: { name: 'b', email: 'b@example.com', password: 'password-1234', consent: false } })).data.code, 'CONSENT_REQUIRED');
  const b = await h.register('bob');
  assert.equal((await h.call('/api/demo/seed', { method: 'POST', user: a })).status, 200);
  assert.equal((await h.call('/api/records', { user: b })).data.records.length, 0);
  assert.equal((await h.call('/api/meals', { user: b })).data.meals.length, 0);
  assert.equal((await h.call('/api/auth/logout', { method: 'POST', user: a })).status, 200);
  assert.equal((await h.call('/api/auth/me', { user: a })).status, 401);
  assert.equal((await h.call('/api/auth/me', { user: b })).status, 200);
});

test('599 and 600 seconds eligible, 601 seconds and future/unknown clocks excluded using ended_at', async t => {
  const h = await harness(t), a = await h.register('boundary'); await h.joinReal(a);
  for (const age of [599, 600, 601]) assert.equal((await h.ingest(h.event(`s${age}`, age))).status, 200);
  await h.ingest(h.event('future', -5));
  await h.ingest(h.event('future-confirm', 10));
  await h.ingest(h.event('unsynced', 100, { clock_status: 'unknown' }));
  await h.ingest(h.event('delayed', 1200, { completed_at: new Date(h.now()).toISOString() }));
  const context = await h.call('/api/devices/toilet-01/context', { user: a });
  assert.equal(context.status, 200);
  assert.deepEqual(context.data.candidates.map(r => r.id), ['s599', 's600']);
  assert.equal(context.data.expired_count, 2);
  assert.deepEqual(Object.keys(context.data.candidates[0]).sort(), ['ended_at', 'id', 'is_demo', 'sitting_sec', 'started_at']);
  assert.equal((await h.claim(a, 's600')).status, 200);
  assert.equal((await h.claim(a, 's601')).status, 410);
  assert.equal((await h.claim(a, 'future')).data.code, 'SESSION_TIME_INVALID');
  assert.equal((await h.claim(a, 'unsynced')).data.code, 'SESSION_TIME_INVALID');
  assert.equal((await h.claim(a, 'future-confirm')).data.code, 'SESSION_TIME_INVALID');
  h.advance(2000);
  assert.equal((await h.claim(a, 's599')).status, 410, 'revalidates after candidate list expires');
  assert.equal((await h.claim(a, 's600')).status, 200, 'saved retry remains successful after cutoff');
});

test('two simultaneous claims yield one owner, checkins reserve nothing, no private record access', async t => {
  const h = await harness(t), a = await h.register('alpha'), b = await h.register('bravo');
  await h.joinReal(a); await h.joinReal(b);
  assert.equal((await h.call('/api/devices/toilet-01/checkins', { method: 'POST', user: a })).status, 200);
  await h.ingest(h.event('race'));
  const results = await Promise.all([h.claim(a, 'race'), h.claim(b, 'race')]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const owner = results[0].status === 200 ? a : b, other = owner === a ? b : a;
  assert.equal((await h.call('/api/records', { user: owner })).data.records.length, 1);
  assert.equal((await h.call('/api/records', { user: other })).data.records.length, 0);
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: other })).data.candidates.length, 0);
  assert.equal((await h.call('/api/records/race', { method: 'PATCH', user: other, body: shape })).status, 404);
  assert.equal((await h.call('/api/records/race', { method: 'DELETE', user: other })).status, 404);
  assert.equal((await h.claim(owner, 'race', { shape: 7 })).data.record.shape, 4, 'retry does not rewrite original input');
  await h.ingest(h.event('next'));
  assert.equal((await h.db.prepare('SELECT user_id FROM sessions WHERE id=?').get('next')).user_id, null);
});

test('real device membership, event token, terminal events and heartbeat ordering', async t => {
  const h = await harness(t), a = await h.register('sensor');
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).status, 403);
  assert.equal((await h.call('/api/device/events', { method: 'POST', body: h.event('denied') })).status, 401);
  await h.joinReal(a);
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.state, 'offline');
  const progress = h.event('ordered', 0, { measurement_status: 'measuring', ended_at: null, completed_at: null, sitting_sec: null });
  assert.equal((await h.ingest(progress)).status, 200);
  const context = (await h.call('/api/devices/toilet-01/context', { user: a })).data;
  assert.equal(context.state, 'measuring'); assert.equal(context.active_started_at, progress.started_at);
  assert.equal((await h.claim(a, 'ordered')).data.code, 'SESSION_NOT_COMPLETE');
  await h.ingest(h.event('ordered')); await h.claim(a, 'ordered');
  await h.ingest(progress);
  await h.ingest(h.event('ordered', 120, { stool_color: 'black', user_id: 'attacker' }));
  const row = (await h.db.prepare('SELECT * FROM sessions WHERE id=?').get('ordered'));
  assert.equal(row.measurement_status, 'completed'); assert.equal(row.user_id, a.id); assert.equal(row.stool_color, 'brown');
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id=?').get('ordered')).n, 1);
  h.advance(30_000); assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.state, 'idle');
  h.advance(1); assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.state, 'offline');
  await h.call('/api/device/heartbeat', { method: 'POST', body: { device_id: 'toilet-01' }, headers: { Authorization: 'Bearer device-test-token' } });
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.state, 'idle');
});

test('short measurements discard, missing duration stays null, invalid shapes/time are rejected', async t => {
  const h = await harness(t), a = await h.register('validation'); await h.joinReal(a);
  const end = h.now() - 120_000;
  await h.ingest(h.event('too-short', 120, { started_at: new Date(end - 19_000).toISOString(), sitting_sec: 19 }));
  assert.equal((await h.claim(a, 'too-short')).status, 409);
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.candidates.length, 0);
  assert.equal((await h.ingest(h.event('unobserved', 120, { started_at: null, sitting_sec: 100, time_source: 'unknown' }))).status, 400);
  await h.ingest(h.event('missing', 120, { started_at: null, sitting_sec: null, time_source: 'unknown' }));
  assert.equal((await h.claim(a, 'missing', { shape: 0 })).status, 400);
  assert.equal((await h.claim(a, 'missing', { excretion_type: 'urine' })).status, 400);
  const claimed = await h.claim(a, 'missing', { shape: null, shape_status: 'not_applicable', excretion_type: 'urine' });
  assert.equal(claimed.status, 200); assert.equal(claimed.data.record.sitting_sec, null);
  const report = (await h.call('/api/insights', { user: a })).data;
  assert.equal(report.record_count, 0); assert.equal(report.average_sitting_sec, null);
  await h.ingest(h.event('unsynced-progress', 0, { measurement_status: 'measuring', ended_at: null, completed_at: null, sitting_sec: null, clock_status: 'unknown' }));
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.active_started_at, null, 'unsynced clock cannot drive a live elapsed timer');
});

test('delete and account removal cannot resurrect records from delayed device replay', async t => {
  const h = await harness(t), a = await h.register('deletion'), b = await h.register('remaining'); await h.joinReal(a); await h.joinReal(b);
  await h.ingest(h.event('remove-one')); await h.claim(a, 'remove-one');
  assert.equal((await h.call('/api/records/remove-one', { method: 'DELETE', user: a })).status, 200);
  await h.ingest(h.event('remove-one'));
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: b })).data.candidates.length, 0);
  await h.ingest(h.event('remove-all')); await h.claim(a, 'remove-all');
  await h.call('/api/demo/seed', { method: 'POST', user: a });
  assert.equal((await h.call('/api/account', { method: 'DELETE', user: a })).status, 200);
  await h.ingest(h.event('remove-all'));
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(a.id)).n, 0);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM meals WHERE user_id=?').get(a.id)).n, 0);
  assert.equal((await h.call('/api/auth/me', { user: a })).status, 401);
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: b })).data.candidates.length, 0);
});

test('demo scenarios, idempotent seed and rules report are clearly separated from real samples', async t => {
  const h = await harness(t), a = await h.register('demo'); await h.joinReal(a);
  await h.call('/api/demo/session', { method: 'POST', user: a, body: { kind: 'expired' } });
  await h.call('/api/demo/session', { method: 'POST', user: a, body: { kind: 'multiple' } });
  const context = (await h.call('/api/devices/demo-toilet/context', { user: a })).data;
  assert.equal(context.candidates.length, 2); assert.equal(context.expired_count, 1); assert.ok(context.candidates.every(c => c.is_demo));
  assert.equal((await h.call('/api/devices/toilet-01/context', { user: a })).data.candidates.length, 0);
  await h.call('/api/demo/session', { method: 'POST', user: a, body: { kind: 'measuring' } });
  h.advance(120_000);
  await h.call('/api/demo/session', { method: 'POST', user: a, body: { kind: 'finish' } });
  await h.call('/api/demo/seed', { method: 'POST', user: a }); await h.call('/api/demo/seed', { method: 'POST', user: a });
  assert.equal((await h.call('/api/records', { user: a })).data.records.length, 7);
  const insight = (await h.call('/api/insights', { user: a })).data;
  assert.equal(insight.days, 7); assert.equal(insight.record_count, 7); assert.equal(insight.meal_count, 7);
  assert.equal(insight.items.length, 3); assert.equal(insight.source, 'rules'); assert.equal(insight.chart.length, 7);
  const foodShape = insight.items.find(item => item.title === '음식 태그와 변 모양');
  assert.match(foodShape.basis, /식이섬유 태그 3회/); assert.match(foodShape.basis, /1·2형 1회, 6·7형 1회/);
  assert.match(foodShape.description, /원인은 단정할 수 없어요/);
  assert.equal(insight.alerts.length, 1); assert.match(insight.alerts[0].title, /예시/);
  await h.ingest(h.event('actual', 120, { sitting_sec: 100 })); await h.claim(a, 'actual');
  const mixed = (await h.call('/api/insights', { user: a })).data;
  assert.equal(mixed.average_sitting_sec, 100); assert.equal(mixed.average_sample_count, 1); assert.equal(mixed.average_time_source, 'sensor');
});

test('meal photo opt-out, validation, ownership edits and truthful AI errors', async t => {
  const h = await harness(t), a = await h.register('food'), b = await h.register('food-other');
  const input = { foods: [{ name: '현미밥', tags: ['식이섬유'] }], eaten_at: new Date(h.now()).toISOString(), photo: png, keep_photo: false, source: 'manual' };
  const saved = await h.call('/api/meals', { method: 'POST', user: a, body: input });
  assert.equal(saved.status, 200); assert.equal(saved.data.meal.photo, null);
  const id = saved.data.meal.id;
  assert.equal((await h.call(`/api/meals/${id}`, { method: 'PATCH', user: b, body: { foods: input.foods, eaten_at: input.eaten_at } })).status, 404);
  assert.equal((await h.call(`/api/meals/${id}`, { method: 'DELETE', user: b })).status, 404);
  assert.equal((await h.call(`/api/meals/${id}`, { method: 'PATCH', user: a, body: { foods: [{ name: '두부', tags: [] }], eaten_at: input.eaten_at } })).data.meal.foods[0].name, '두부');
  assert.equal((await h.call('/api/meals', { method: 'POST', user: a, body: { ...input, photo: 'data:image/png;base64,' + Buffer.from('not a real image here').toString('base64') } })).status, 400);
  assert.equal((await h.call('/api/meals/analyze', { method: 'POST', user: a, body: { image: png } })).data.code, 'AI_NOT_CONFIGURED');
  assert.equal((await h.call(`/api/meals/${id}`, { method: 'DELETE', user: a })).status, 200);
  assert.equal((await h.call('/api/meals', { user: a })).data.meals.length, 0);
});

test('Anthropic image analysis validates structured result and handles upstream errors', async t => {
  let captured, error = false;
  const h = await harness(t, { apiKey: 'test-private-key', model: 'configured-model', fetchImpl: async (url, init) => {
    captured = { url, init }; return error ? new Response('{}', { status: 500 }) : Response.json({ content: [{ type: 'tool_use', name: 'identify_foods', input: { foods: [{ name: '밥', tags: [] }], description: '사진에서 밥으로 추정했어요.' } }] });
  } });
  const a = await h.register('ai');
  const result = await h.call('/api/meals/analyze', { method: 'POST', user: a, body: { image: png } });
  assert.equal(result.status, 200); assert.equal(result.data.source, 'ai'); assert.equal(result.data.foods[0].name, '밥');
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages'); assert.equal(JSON.parse(captured.init.body).model, 'configured-model');
  assert.ok(!JSON.stringify(result.data).includes('test-private-key'));
  error = true;
  assert.equal((await h.call('/api/meals/analyze', { method: 'POST', user: a, body: { image: png } })).data.code, 'AI_UNAVAILABLE');
});

test('records and login survive server restart, production config and static traversal safety', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'maker-backend-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dist = join(directory, 'dist'); mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<h1>app shell</h1>');
  writeFileSync(join(directory, 'private.json'), '{"secret":"do-not-serve"}'); symlinkSync(join(directory, 'private.json'), join(dist, 'leak.json'));
  const h = await harness(t, { dbPath: join(directory, 'persist.sqlite'), distDir: dist });
  const a = await h.register('persist'); await h.call('/api/demo/seed', { method: 'POST', user: a });
  assert.equal((await h.call('/checkin?device=demo-toilet')).status, 200);
  assert.equal((await h.call('/leak.json')).status, 404);
  assert.equal((await h.call('/%2e%2e%2fprivate.json')).status, 404);
  assert.equal((await h.call('/.env')).status, 404);
  assert.equal((await h.call('/api/health')).data.ok, true);
  await h.close();
  const second = (await createApp({ dbPath: join(directory, 'persist.sqlite'), now: h.now, demoEnabled: true }));
  t.after(() => second.close());
  assert.equal((await second.db.prepare('SELECT COUNT(*) AS n FROM users').get()).n, 1);
  assert.equal((await second.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(a.id)).n, 7);
  const restored = await inject(second, '/api/auth/me', { user: a });
  assert.equal(restored.status, 200); assert.equal(restored.data.user.id, a.id);
  const production = createConfig({ NODE_ENV: 'production', CLAIM_WINDOW_SEC: '450' });
  assert.equal(production.secureCookie, true); assert.equal(production.demoEnabled, false); assert.equal(production.claimWindowSec, 450);
});

test('disabled demo and absent device secrets are explicit, not simulated', async t => {
  const h = await harness(t, { demoEnabled: false, deviceToken: '', pairingCode: '' }), a = await h.register('disabled');
  assert.deepEqual(a.response.data.devices, []);
  assert.equal((await h.call('/api/demo/seed', { method: 'POST', user: a })).status, 404);
  assert.equal((await h.ingest(h.event('unconfigured'))).data.code, 'DEVICE_NOT_CONFIGURED');
  assert.equal((await h.call('/api/devices/join', { method: 'POST', user: a, body: { device_id: 'toilet-01', code: 'anything' } })).data.code, 'PAIRING_NOT_CONFIGURED');
});

test('record edit expires after 24h and request IDs cannot claim a second session', async t => {
  const h = await harness(t), a = await h.register('edit'); await h.joinReal(a);
  await h.ingest(h.event('editable')); await h.claim(a, 'editable');
  await h.ingest(h.event('different'));
  assert.equal((await h.claim(a, 'different', { request_id: 'request-editable' })).data.code, 'REQUEST_ID_REUSED');
  h.advance(DAY - 120_000);
  assert.equal((await h.call('/api/records/editable', { method: 'PATCH', user: a, body: { ...shape, shape: 3 } })).status, 200);
  h.advance(1);
  assert.equal((await h.call('/api/records/editable', { method: 'PATCH', user: a, body: shape })).data.code, 'EDIT_EXPIRED');
  assert.equal((await h.call('/api/records/editable', { method: 'DELETE', user: a })).status, 200);
});

test('production origin and cookie attributes, body size/type and auth attempt limits', async t => {
  const h = await harness(t, { secureCookie: true, publicOrigin: 'https://maker.example' }), a = await h.register('guards');
  assert.match(a.response.headers.get('set-cookie'), /; Secure/);
  const allowed = await h.call('/api/devices/demo-toilet/checkins', { method: 'POST', user: a, headers: { Origin: 'https://maker.example' } });
  assert.equal(allowed.status, 200);
  assert.equal((await h.call('/api/devices/demo-toilet/checkins', { method: 'POST', user: a, headers: { Origin: 'http://maker.example' } })).status, 403);
  assert.equal((await h.call('/api/meals', { method: 'POST', user: a, raw: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.call('/api/meals', { method: 'POST', user: a, raw: '{', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await h.call('/api/meals', { method: 'POST', user: a, raw: 'x'.repeat(3 * 1024 * 1024 + 1), headers: { 'Content-Type': 'application/json' } })).status, 413);
  let last;
  for (let attempt = 0; attempt < 25; attempt++) last = await h.call('/api/auth/login', { method: 'POST', body: { email: 'guards@example.com', password: 'wrong-password' } });
  assert.equal(last.status, 429);
});
