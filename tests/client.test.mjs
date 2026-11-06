import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Mock only the SDK boundary; execute the production API module unchanged.
const apiUrl = new URL('../app/src/api.js', import.meta.url).href;
const authKey = Symbol.for('maker-ton.client-test.auth');
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === apiUrl && specifier === './supabase.js') return { url: 'mock:supabase-auth', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mock:supabase-auth') return {
      format: 'module', shortCircuit: true,
      source: `export const supabase = { auth: { getSession: () => globalThis[Symbol.for('maker-ton.client-test.auth')]() } }; export const supabaseConfigError = '';`,
    };
    return nextLoad(url, context);
  },
});
const { api, ApiError, clearSession, isCancelled } = await import(apiUrl);
hooks.deregister();

const session = (token = 'fake-access-token') => ({ data: { session: { access_token: token, user: { id: 'person-a' } } }, error: null });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t, fetchImpl, getSession = async () => session()) {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.fetch = fetchImpl;
  globalThis.window = new EventTarget();
  globalThis[authKey] = getSession;
  clearSession();
  t.after(() => {
    clearSession();
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    delete globalThis[authKey];
  });
}

test('every API request obtains the latest Bearer token and sends no legacy auth headers or credentials option', async t => {
  const calls = [];
  let token = 'first-token', sessionReads = 0;
  fixture(t, async (url, options) => { calls.push({ url, options }); return response({ ok: true }); }, async () => {
    sessionReads += 1;
    return session(token);
  });
  await api('/me');
  token = 'refreshed-token';
  await api('/sessions/session-a/claim', { method: 'POST', body: { shape: 4, shape_status: 'confirmed', excretion_type: 'stool' } });
  assert.equal(sessionReads, 2);
  assert.equal(calls[0].url, '/api/me');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer first-token');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer refreshed-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), { shape: 4, shape_status: 'confirmed', excretion_type: 'stool' });
  for (const { options } of calls) {
    assert.equal(Object.hasOwn(options, 'credentials'), false);
    assert.equal(options.cache, 'no-store');
    assert.equal(Object.keys(options.headers).some(key => /csrf|profile/i.test(key)), false);
  }
});

test('a late response from a previous account is discarded after clearSession', async t => {
  const started = deferred(), finished = deferred();
  let capturedSignal;
  fixture(t, async (_url, options) => {
    capturedSignal = options.signal;
    return { ok: true, status: 200, json: () => { started.resolve(); return finished.promise; } };
  });
  const pending = api('/records');
  const rejected = assert.rejects(pending, isCancelled);
  await started.promise;
  clearSession();
  assert.equal(capturedSignal.aborted, true);
  finished.resolve({ records: [{ id: 'previous-private-record' }] });
  await rejected;
});

test('an account change during token refresh cancels without fetching with the new account token', async t => {
  const started = deferred(), refreshed = deferred();
  let fetches = 0;
  fixture(t, async () => { fetches += 1; return response({}); }, () => { started.resolve(); return refreshed.promise; });
  const pending = api('/records');
  const rejected = assert.rejects(pending, isCancelled);
  await started.promise;
  clearSession();
  await rejected;
  refreshed.resolve(session('different-account-token'));
  await Promise.resolve();
  assert.equal(fetches, 0);
});

test('fake Bearer rejected with AUTH_REQUIRED notifies the app and invalidates other private requests', async t => {
  const started = deferred(), finished = deferred();
  let expired = 0, capturedSignal;
  fixture(t, async (url, options) => {
    if (url === '/api/records') {
      capturedSignal = options.signal;
      return { ok: true, status: 200, json: () => { started.resolve(); return finished.promise; } };
    }
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    return response({ error: '로그인해 주세요.', code: 'AUTH_REQUIRED' }, 401);
  });
  window.addEventListener('auth-expired', () => { expired += 1; });
  const oldRecords = api('/records');
  const recordsRejected = assert.rejects(oldRecords, isCancelled);
  await started.promise;
  await assert.rejects(api('/me'), error => error instanceof ApiError && error.status === 401 && error.code === 'AUTH_REQUIRED' && error.message === '로그인해 주세요.');
  assert.equal(expired, 1);
  assert.equal(capturedSignal.aborted, true);
  finished.resolve({ records: [{ id: 'private-record' }] });
  await recordsRejected;
});

test('no saved session returns AUTH_REQUIRED without making a backend request', async t => {
  fixture(t, () => assert.fail('Unauthenticated request must not reach the backend'), async () => ({ data: { session: null }, error: null }));
  let expired = 0;
  window.addEventListener('auth-expired', () => { expired += 1; });
  await assert.rejects(api('/me'), error => error.status === 401 && error.code === 'AUTH_REQUIRED');
  assert.equal(expired, 1);
});

test('a temporary SDK refresh failure does not clear a valid saved session', async t => {
  fixture(t, () => assert.fail('No token was obtained'), async () => ({ data: { session: null }, error: { status: 503 } }));
  window.addEventListener('auth-expired', () => assert.fail('Transient failures must allow retry'));
  await assert.rejects(api('/me'), error => error.code === 'AUTH_SESSION_ERROR');
});

test('an invalid refresh token returns to the signed-out state', async t => {
  fixture(t, () => assert.fail('Invalid refresh must not reach the backend'), async () => ({ data: { session: null }, error: { status: 400 } }));
  let expired = 0;
  window.addEventListener('auth-expired', () => { expired += 1; });
  await assert.rejects(api('/me'), error => error.code === 'AUTH_REQUIRED');
  assert.equal(expired, 1);
});

test('ordinary backend errors preserve the Korean message and code without signing out', async t => {
  fixture(t, async () => response({ error: '연결 코드를 확인해 주세요.', code: 'INVALID_CODE' }, 403));
  window.addEventListener('auth-expired', () => assert.fail('A form validation error must not sign out'));
  await assert.rejects(api('/devices/join', { method: 'POST', body: { device_id: 'toilet-01', code: 'bad' } }), error => error.status === 403 && error.code === 'INVALID_CODE' && error.message === '연결 코드를 확인해 주세요.');
});

test('already cancelled requests read neither a session nor the backend', async t => {
  fixture(t, () => assert.fail('Cancelled request fetched'), () => assert.fail('Cancelled request read the session'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api('/records', { signal: controller.signal }), isCancelled);
});

test('the request timeout also interrupts a stuck Supabase token refresh', async t => {
  fixture(t, () => assert.fail('Stuck refresh must not reach backend'), () => new Promise(() => {}));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = api('/me');
  const rejected = assert.rejects(pending, error => error.code === 'REQUEST_TIMEOUT');
  t.mock.timers.tick(25000);
  await rejected;
});

test('DELETE endpoints may return an empty 204 response', async t => {
  fixture(t, async (_url, options) => {
    assert.equal(options.method, 'DELETE');
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    return { ok: true, status: 204, json: () => assert.fail('A 204 response has no JSON') };
  });
  assert.deepEqual(await api('/meals/meal-a', { method: 'DELETE' }), {});
});

test('an old auth workflow cannot PATCH a name using a newly signed-in account token', async t => {
  fixture(t, () => assert.fail('A mismatched auth workflow must not mutate the new account'), async () => {
    const current = session('person-b-token');
    current.data.session.user.id = 'person-b';
    return current;
  });
  window.addEventListener('auth-expired', () => assert.fail('The new login remains valid'));
  await assert.rejects(api('/me', { method: 'PATCH', body: { name: 'Old account name' }, expectedUserId: 'person-a' }), isCancelled);
});

test('an identity-bound auth request proceeds when the refreshed token still belongs to its account', async t => {
  fixture(t, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    assert.equal(Object.keys(options.headers).some(key => /user|profile/i.test(key)), false);
    return response({ user: { id: 'person-a' } });
  });
  assert.deepEqual(await api('/me', { expectedUserId: 'person-a' }), { user: { id: 'person-a' } });
});
