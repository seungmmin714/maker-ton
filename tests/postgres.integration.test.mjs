import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { createApp } from '../server/index.mjs';
import { createPostgresDatabase } from '../server/postgres-database.mjs';

// Opt-in only. Never use public tables or clear a supplied database. Each run
// creates one unpredictable schema and drops only that exact schema in cleanup.
const connectionString = process.env.TEST_DATABASE_URL;
test('real Postgres: independent app instances preserve claims, replay safety and login',
  { skip: !connectionString && 'Set TEST_DATABASE_URL for a real remote integration run', timeout: 180000 }, async t => {
    const schema = `maker_ton_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(schema, /^maker_ton_test_[a-f0-9]{32}$/);
    const admin = await createPostgresDatabase(connectionString);
    const apps = [];
    let created = false;
    t.after(async () => {
      await Promise.allSettled(apps.map(app => app.close()));
      try {
        if (created && /^maker_ton_test_[a-f0-9]{32}$/.test(schema)) await admin.exec(`DROP SCHEMA "${schema}" CASCADE`);
      } finally { await admin.close(); }
    });
    await admin.exec(`CREATE SCHEMA "${schema}"`); created = true;
    let time = Date.now();
    async function instance() {
      const database = await createPostgresDatabase(connectionString, { schema });
      const app = await createApp({ database, now: () => time, vercel: true,
        demoEnabled: true, deviceToken: 'integration-device-token', pairingCode: 'integration-pairing-code', apiKey: '', model: '', publicOrigin: '' });
      apps.push(app); return app;
    }
    // Wait for both starts even if one fails, so cleanup sees every opened pool.
    const initial = await Promise.allSettled([instance(), instance()]);
    for (const result of initial) if (result.status === 'rejected') throw result.reason;
    let [a, b] = initial.map(result => result.value);
    const shape = { shape: 4, shape_status: 'selected', excretion_type: 'stool' };
    async function request(app, path, { body, user, method = 'GET', headers = {} } = {}) {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const req = Readable.from(payload ? [Buffer.from(payload)] : []);
      req.url = path; req.method = method; req.socket = { remoteAddress: '127.0.0.1' };
      req.headers = { host: 'test.local', ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
        ...(user ? { cookie: user.cookie, 'x-csrf-token': user.csrf } : {}), ...headers };
      const chunks = [], responseHeaders = new Headers();
      const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      res.headersSent = false; res.statusCode = 200;
      res.setHeader = (name, value) => responseHeaders.set(name, value);
      res.writeHead = (status, values) => { res.statusCode = status; res.headersSent = true; for (const [name, value] of Object.entries(values || {})) responseHeaders.set(name, value); return res; };
      const finished = new Promise((resolve, reject) => { res.once('finish', resolve); res.once('error', reject); });
      await app.handler(req, res); await finished;
      return { status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()), headers: responseHeaders };
    }
    async function register(app, name) {
      const result = await request(app, '/api/auth/register', { method: 'POST', body: { name, email: `${name}@example.test`, password: 'integration-password', consent: true } });
      assert.equal(result.status, 200, result.data.code);
      return { id: result.data.user.id, cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrfToken };
    }
    const [alice, bob] = await Promise.all([register(a, 'integration-alice'), register(b, 'integration-bob')]);
    for (const [app, user] of [[a, alice], [b, bob]]) assert.equal((await request(app, '/api/devices/join', { method: 'POST', user, body: { device_id: 'toilet-01', code: 'integration-pairing-code' } })).status, 200);
    function event(id, age = 120, overrides = {}) {
      const end = time - age * 1000;
      return { session_id: id, device_id: 'toilet-01', is_demo: false, measurement_status: 'completed',
        started_at: new Date(end - 180000).toISOString(), ended_at: new Date(end).toISOString(), completed_at: new Date(end + 30000).toISOString(),
        sitting_sec: 180, time_source: 'sensor', clock_status: 'synced', color_status: 'unclassified', stool_color: null, urine_color: null, ...overrides };
    }
    const ingest = (app, body) => request(app, '/api/device/events', { method: 'POST', body, headers: { authorization: 'Bearer integration-device-token' } });
    const claim = (app, user, id) => request(app, `/api/sessions/${id}/claim`, { method: 'POST', user, body: { ...shape, request_id: `request-${id}` } });

    await t.test('concurrent initialization and duplicate email registration', async () => {
      assert.equal((await a.db.prepare('SELECT count(*) AS count FROM devices').get()).count, 2);
      const body = { name: '동시 가입', email: 'same-email@example.test', password: 'integration-password', consent: true };
      const result = await Promise.all([request(a, '/api/auth/register', { method: 'POST', body }), request(b, '/api/auth/register', { method: 'POST', body })]);
      assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
      assert.equal(result.find(r => r.status === 409).data.code, 'EMAIL_EXISTS');
    });
    await t.test('independent instances allow one owner, while a saved retry survives expiry', async () => {
      assert.equal((await ingest(a, event('claim-race'))).status, 200);
      const result = await Promise.all([claim(a, alice, 'claim-race'), claim(b, bob, 'claim-race')]);
      assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
      const owner = result[0].status === 200 ? alice : bob;
      time += 700000;
      assert.equal((await claim(b, owner, 'claim-race')).status, 200);
      const row = await a.db.prepare('SELECT * FROM sessions WHERE id=?').get('claim-race');
      assert.equal(row.user_id, owner.id); assert.equal(typeof row.ended_at, 'number');
    });
    await t.test('600-second boundary and future completion stay consistent in Postgres', async () => {
      for (const [id, age] of [['boundary', 600], ['expired', 601]]) assert.equal((await ingest(a, event(id, age))).status, 200);
      assert.equal((await claim(b, alice, 'boundary')).status, 200);
      assert.equal((await claim(b, alice, 'expired')).status, 410);
      assert.equal((await ingest(a, event('future', 10))).status, 200);
      assert.equal((await claim(b, alice, 'future')).data.code, 'SESSION_TIME_INVALID');
    });
    await t.test('concurrent delivery cannot overwrite a final sample', async () => {
      const progress = event('sensor-race', 0, { measurement_status: 'measuring', ended_at: null, completed_at: null, sitting_sec: null });
      assert.equal((await ingest(a, progress)).status, 200);
      const result = await Promise.all([
        ingest(a, event('sensor-race', 120, { color_status: 'classified', stool_color: 'brown' })),
        ingest(b, event('sensor-race', 120, { color_status: 'classified', stool_color: 'yellow' })),
      ]);
      assert.ok(result.every(r => r.status === 200));
      assert.equal(result.filter(r => r.data.duplicate).length, 1);
      const original = await a.db.prepare('SELECT stool_color FROM sessions WHERE id=?').get('sensor-race');
      await ingest(b, progress);
      await ingest(b, event('sensor-race', 120, { color_status: 'classified', stool_color: 'black' }));
      assert.deepEqual(await b.db.prepare('SELECT stool_color FROM sessions WHERE id=?').get('sensor-race'), original);
    });
    await t.test('tombstones prevent delayed replay after record and account deletion', async () => {
      await ingest(a, event('deleted-record')); await claim(a, alice, 'deleted-record');
      assert.equal((await request(b, '/api/records/deleted-record', { method: 'DELETE', user: alice })).status, 200);
      assert.equal((await ingest(a, event('deleted-record'))).data.deleted, true);
      await ingest(a, event('deleted-account')); await claim(b, bob, 'deleted-account');
      assert.equal((await request(a, '/api/account', { method: 'DELETE', user: bob })).status, 200);
      assert.equal((await ingest(b, event('deleted-account'))).data.deleted, true);
      assert.equal((await request(b, '/api/auth/me', { user: bob })).status, 401);
    });
    await t.test('recreated app restores persistent cookie and records from the remote database', async () => {
      const before = await request(a, '/api/records', { user: alice });
      await a.close(); a = await instance();
      const me = await request(a, '/api/auth/me', { user: alice });
      assert.equal(me.status, 200); assert.equal(me.data.user.id, alice.id);
      assert.deepEqual((await request(a, '/api/records', { user: alice })).data, before.data);
      assert.equal((await request(a, '/api/health')).status, 200);
    });
    await t.test('profile groups persist across instances while password switching keeps records private', async () => {
      const owner = await register(a, 'profile-owner');
      const member = await register(b, 'profile-member');
      const sessionFrom = result => {
        assert.equal(result.status, 200, result.data.code);
        return { id: result.data.user.id, cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrfToken };
      };
      const privateMeal = await request(b, '/api/meals', { method: 'POST', user: member,
        body: { foods: [{ name: '개인 식사', tags: [] }], eaten_at: new Date(time).toISOString(), keep_photo: false, source: 'manual' } });
      assert.equal(privateMeal.status, 200);

      const wrongLink = await request(a, '/api/profiles/link', { method: 'POST', user: owner,
        body: { email: 'profile-member@example.test', password: 'wrong-password' } });
      assert.equal(wrongLink.status, 403); assert.equal(wrongLink.data.code, 'INVALID_CREDENTIALS');
      const unchanged = await request(b, '/api/auth/me', { user: owner });
      assert.equal(unchanged.data.user.id, owner.id);
      assert.equal(unchanged.data.profiles.length, 1);

      const linked = await request(a, '/api/profiles/link', { method: 'POST', user: owner,
        body: { email: 'profile-member@example.test', password: 'integration-password' } });
      const memberHere = sessionFrom(linked);
      assert.equal(memberHere.id, member.id);
      assert.deepEqual(linked.data.profiles.map(profile => profile.id).sort(), [owner.id, member.id].sort());
      for (const profile of linked.data.profiles) assert.deepEqual(Object.keys(profile).sort(), ['id', 'is_current', 'name']);
      assert.equal((await request(b, '/api/auth/me', { user: owner })).status, 401, 'Only the submitting browser session is revoked.');
      assert.deepEqual((await request(b, '/api/meals', { user: memberHere })).data.meals.map(meal => meal.id), [privateMeal.data.meal.id]);

      const wrongSwitch = await request(b, '/api/profiles/switch', { method: 'POST', user: memberHere,
        body: { profile_id: owner.id, password: 'wrong-password' } });
      assert.equal(wrongSwitch.status, 403); assert.equal(wrongSwitch.data.code, 'INVALID_PROFILE_PASSWORD');
      const switched = await request(a, '/api/profiles/switch', { method: 'POST', user: memberHere,
        body: { profile_id: owner.id, password: 'integration-password' } });
      const ownerHere = sessionFrom(switched);
      assert.equal(ownerHere.id, owner.id);
      assert.deepEqual((await request(b, '/api/meals', { user: ownerHere })).data.meals, []);
      assert.equal((await request(b, `/api/meals/${privateMeal.data.meal.id}`, { method: 'DELETE', user: ownerHere })).status, 404,
        'Being in the same group does not permit deleting another profile’s meal.');

      const created = await request(b, '/api/profiles/register', { method: 'POST', user: ownerHere,
        body: { name: '새 프로필', email: 'profile-new@example.test', password: 'new-profile-password', consent: true } });
      const newProfile = sessionFrom(created);
      assert.notEqual(newProfile.id, owner.id);
      const restored = await request(a, '/api/auth/me', { user: newProfile });
      assert.equal(restored.status, 200);
      assert.equal(restored.data.profiles.length, 3);
      assert.equal(restored.data.profiles.find(profile => profile.is_current)?.id, newProfile.id);
      assert.deepEqual(restored.data.plan, { mode: 'free', profileCount: 3, paymentEnabled: false });
      const otherPhone = await request(a, '/api/profiles', { user: member });
      assert.equal(otherPhone.status, 200, 'The original member session on another phone stays valid.');
      assert.equal(otherPhone.data.profiles.length, 3);
      assert.equal(otherPhone.data.profiles.find(profile => profile.is_current)?.id, member.id);
    });
  });
