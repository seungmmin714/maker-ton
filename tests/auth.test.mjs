import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const authUrl = new URL('../app/src/auth.js', import.meta.url).href;
const boundaryKey = Symbol.for('maker-ton.auth-test.boundaries');
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === authUrl && ['./supabase', './supabase.js'].includes(specifier)) return { url: 'mock:auth-sdk', shortCircuit: true };
    if (context.parentURL === authUrl && ['./api', './api.js'].includes(specifier)) return { url: 'mock:auth-api', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mock:auth-sdk') return {
      format: 'module', shortCircuit: true,
      source: `const boundary = () => globalThis[Symbol.for('maker-ton.auth-test.boundaries')]; export const supabase = { auth: { signUp: (...args) => boundary().signUp(...args), signInWithPassword: (...args) => boundary().signInWithPassword(...args) } }; export const supabaseConfigError = '';`,
    };
    if (url === 'mock:auth-api') return {
      format: 'module', shortCircuit: true,
      source: `export const api = (...args) => globalThis[Symbol.for('maker-ton.auth-test.boundaries')].api(...args);`,
    };
    return nextLoad(url, context);
  },
});
const { authenticate, loadAccount, authErrorMessage } = await import(authUrl);
hooks.deregister();

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t, overrides = {}) {
  const calls = [];
  globalThis[boundaryKey] = {
    signUp: async value => { calls.push({ method: 'signUp', value }); return { data: { session: savedSession() }, error: null }; },
    signInWithPassword: async value => { calls.push({ method: 'signInWithPassword', value }); return { data: { session: savedSession() }, error: null }; },
    api: async (path, options) => { calls.push({ method: 'api', path, options }); return { user: { id: 'person-a', email: 'a@example.invalid', name: '이름' }, devices: [], config: {} }; },
    ...overrides,
  };
  t.after(() => { delete globalThis[boundaryKey]; });
  return calls;
}
function savedSession(metadata = {}) {
  return { access_token: 'fake-access-token', user: { id: 'person-a', user_metadata: metadata } };
}
const signup = { register: true, name: '  시연 사용자  ', email: '  a@example.invalid  ', password: 'example-password', consent: true };

test('signup sends only credentials and name metadata, then saves name after a session is issued', async t => {
  const issued = deferred(), calls = [];
  fixture(t, {
    signUp: value => { calls.push({ method: 'signUp', value }); return issued.promise; },
    api: async (path, options) => { calls.push({ method: 'api', path, options }); return {}; },
  });
  const pending = authenticate(signup);
  assert.deepEqual(calls, [{ method: 'signUp', value: { email: 'a@example.invalid', password: 'example-password', options: { data: { name: '시연 사용자' } } } }]);
  const current = savedSession();
  issued.resolve({ data: { session: current }, error: null });
  assert.deepEqual(await pending, { session: current, message: '' });
  assert.deepEqual(calls[1], { method: 'api', path: '/me', options: { method: 'PATCH', body: { name: '시연 사용자' }, expectedUserId: 'person-a' } });
  assert.equal(JSON.stringify(calls).includes('consent'), false);
});

test('signup requiring email confirmation does not call the protected name endpoint', async t => {
  fixture(t, {
    signUp: async () => ({ data: { session: null }, error: null }),
    api: () => assert.fail('There is no Bearer session until email confirmation'),
  });
  const result = await authenticate(signup);
  assert.equal(result.session, null);
  assert.match(result.message, /이메일 인증/);
});

test('signup validates the health consent checkbox locally before any SDK request', async t => {
  const calls = fixture(t);
  await assert.rejects(authenticate({ ...signup, consent: false }), /동의/);
  await assert.rejects(authenticate({ ...signup, name: '  ' }), /이름/);
  assert.deepEqual(calls, []);
});

test('login uses signInWithPassword and does not call an old backend login endpoint or submit consent', async t => {
  const calls = fixture(t);
  const result = await authenticate({ ...signup, register: false, consent: false });
  assert.equal(result.session.user.id, 'person-a');
  assert.deepEqual(calls, [{ method: 'signInWithPassword', value: { email: 'a@example.invalid', password: 'example-password' } }]);
});

test('Supabase login errors are shown in Korean and do not run account mutations', async t => {
  fixture(t, {
    signInWithPassword: async () => ({ data: { session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }),
    api: () => assert.fail('Failed login must not mutate account'),
  });
  await assert.rejects(authenticate({ ...signup, register: false }), { message: '이메일이나 비밀번호를 확인해 주세요.' });
  assert.equal(authErrorMessage({ code: 'email_not_confirmed' }), '이메일 인증을 완료한 뒤 로그인해 주세요.');
});

test('a failed signup name save is surfaced instead of claiming successful completion', async t => {
  fixture(t, { api: async () => { throw new Error('이름 저장에 실패했어요.'); } });
  await assert.rejects(authenticate(signup), /이름 저장에 실패/);
});

test('loadAccount preserves the backend account name without overwriting it from metadata', async t => {
  const calls = fixture(t);
  const controller = new AbortController();
  const result = await loadAccount(savedSession({ name: '오래된 이름' }), controller.signal);
  assert.equal(result.user.name, '이름');
  assert.deepEqual(calls, [{ method: 'api', path: '/me', options: { signal: controller.signal, expectedUserId: 'person-a' } }]);
});

test('loadAccount fills a missing name from signup metadata and passes one signal through GET and PATCH', async t => {
  const calls = [];
  fixture(t, { api: async (path, options) => {
    calls.push({ path, options });
    return { user: { id: 'person-a', email: 'a@example.invalid', name: '' }, devices: [{ id: 'toilet-01' }], config: { aiEnabled: true } };
  } });
  const controller = new AbortController();
  const result = await loadAccount(savedSession({ name: '  새 이름  ' }), controller.signal);
  assert.equal(result.user.name, '새 이름');
  assert.deepEqual(result.devices, [{ id: 'toilet-01' }]);
  assert.equal(result.config.aiEnabled, true);
  assert.deepEqual(calls, [
    { path: '/me', options: { signal: controller.signal, expectedUserId: 'person-a' } },
    { path: '/me', options: { method: 'PATCH', body: { name: '새 이름' }, signal: controller.signal, expectedUserId: 'person-a' } },
  ]);
});

test('metadata names are bounded to the existing 30-character account limit', async t => {
  let patched;
  fixture(t, { api: async (_path, options) => {
    if (options.method === 'PATCH') patched = options.body.name;
    return { user: { id: 'person-a', name: null } };
  } });
  const result = await loadAccount(savedSession({ name: '가'.repeat(50) }));
  assert.equal(patched, '가'.repeat(30));
  assert.equal(result.user.name, patched);
});

test('a missing or whitespace-only name gets a display fallback without a pointless PATCH', async t => {
  let reads = 0;
  fixture(t, { api: async (_path, options) => {
    assert.equal(options.method, undefined);
    reads += 1;
    return { user: { id: 'person-a', name: null } };
  } });
  assert.equal((await loadAccount(savedSession())).user.name, '사용자');
  assert.equal((await loadAccount(savedSession({ name: '   ' }))).user.name, '사용자');
  assert.equal(reads, 2);
});

test('loadAccount rejects an API identity mismatch before returning data or patching a name', async t => {
  let reads = 0;
  fixture(t, { api: async (_path, options) => {
    assert.equal(options.method, undefined);
    reads += 1;
    return { user: { id: 'other-person', name: '' }, devices: [{ id: 'other-private-device' }] };
  } });
  await assert.rejects(loadAccount(savedSession({ name: '현재 사용자' })), /로그인 계정을 확인하지 못했어요/);
  assert.equal(reads, 1);
});

test('non-string user metadata cannot crash account restoration or trigger a malformed name PATCH', async t => {
  fixture(t, { api: async (_path, options) => {
    assert.equal(options.method, undefined);
    return { user: { id: 'person-a', name: null } };
  } });
  for (const name of [42, {}, ['name'], true, null]) {
    assert.equal((await loadAccount(savedSession({ name }))).user.name, '사용자');
  }
});

test('account restoration requires a known Supabase identity before making an API call', async t => {
  fixture(t, { api: () => assert.fail('No authenticated identity was supplied') });
  await assert.rejects(loadAccount(null), /로그인 계정/);
});
