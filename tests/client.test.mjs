import test from 'node:test';
import assert from 'node:assert/strict';
import { api, clearSession, subscribeSessionChanges } from '../app/src/api.js';

function fixture(t, fetchImpl) {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.fetch = fetchImpl;
  globalThis.window = new EventTarget();
  clearSession();
  t.after(() => {
    clearSession();
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
}
const response = data => ({ ok: true, status: 200, json: async () => data });

test('restored account sends its CSRF token; logout clears it for the next account', async t => {
  const calls = [];
  fixture(t, async (url, options) => {
    calls.push({ url, options });
    return response(url.endsWith('/auth/me') ? { csrfToken: 'account-a-csrf' } : { ok: true });
  });
  await api('/auth/me');
  await api('/sessions/session-a/claim', { method: 'POST', body: { request_id: 'a' } });
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'account-a-csrf');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.cache, 'no-store');
  clearSession();
  await api('/auth/login', { method: 'POST', body: { email: 'b@example.invalid' } });
  assert.equal(calls[2].options.headers['X-CSRF-Token'], undefined);
});

test('a late response from a previous account cannot restore its data or CSRF token', async t => {
  let finishOldResponse, capturedSignal;
  fixture(t, async (_url, options) => {
    capturedSignal = options.signal;
    return { ok: true, status: 200, json: () => new Promise(resolve => { finishOldResponse = resolve; }) };
  });
  const pending = api('/records');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await Promise.resolve();
  assert.equal(typeof finishOldResponse, 'function');
  clearSession();
  assert.equal(capturedSignal.aborted, true);
  finishOldResponse({ records: [{ id: 'previous-private-record' }], csrfToken: 'obsolete-token' });
  await rejected;
  let nextHeaders;
  globalThis.fetch = async (_url, options) => { nextHeaders = options.headers; return response({ ok: true }); };
  await api('/auth/login', { method: 'POST', body: {} });
  assert.equal(nextHeaders['X-CSRF-Token'], undefined);
});

test('expired protected requests notify the app to clear private screen state', async t => {
  fixture(t, async () => ({ ok: false, status: 401, json: async () => ({ error: '로그인해 주세요.', code: 'AUTH_REQUIRED' }) }));
  let expired = 0;
  window.addEventListener('auth-expired', () => { expired += 1; });
  await assert.rejects(api('/records'), error => error.status === 401 && error.code === 'AUTH_REQUIRED');
  assert.equal(expired, 1);
  await assert.rejects(api('/auth/login', { method: 'POST', body: {} }));
  assert.equal(expired, 1, 'A failed login should leave the sign-in error visible.');
});

test('wrong target password preserves the current profile and CSRF', async t => {
  const calls = [];
  fixture(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/me')) return response({ user: { id: 'person-a' }, csrfToken: 'a-csrf' });
    if (url.endsWith('/profiles/switch')) return { ok: false, status: 403, json: async () => ({ code: 'INVALID_PROFILE_PASSWORD', error: '비밀번호를 확인해 주세요.' }) };
    return response({ records: [] });
  });
  let expired = 0;
  window.addEventListener('auth-expired', () => { expired += 1; });
  await api('/auth/me');
  await assert.rejects(api('/profiles/switch', { method: 'POST', body: { profile_id: 'person-b', password: 'wrong' } }), error => error.code === 'INVALID_PROFILE_PASSWORD');
  await api('/records');
  assert.equal(expired, 0);
  assert.equal(calls[2].options.headers['X-Profile-ID'], 'person-a');
  await api('/meals', { method: 'POST', body: {} });
  assert.equal(calls[3].options.headers['X-CSRF-Token'], 'a-csrf');
});

test('profile switch discards delayed records and auth responses before using new credentials', async t => {
  const pendingResponses = [], calls = [], notifications = [];
  fixture(t, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ user: { id: 'person-a' }, csrfToken: 'a-csrf' });
    if (calls.length === 2 || calls.length === 3) return { ok: true, status: 200, json: () => new Promise(resolve => pendingResponses.push(resolve)) };
    if (url.endsWith('/profiles/switch')) return response({ user: { id: 'person-b' }, csrfToken: 'b-csrf' });
    return response({ ok: true });
  });
  window.BroadcastChannel = class { constructor(name) { this.name = name; } postMessage(value) { notifications.push({ name: this.name, value }); } close() {} };
  await api('/auth/me');
  const oldRecords = api('/records'), oldSession = api('/auth/me');
  const recordsRejected = assert.rejects(oldRecords, { name: 'AbortError' });
  const sessionRejected = assert.rejects(oldSession, { name: 'AbortError' });
  await Promise.resolve();
  await api('/profiles/switch', { method: 'POST', body: { profile_id: 'person-b', password: 'private-b-password' } });
  assert.equal(calls[1].options.signal.aborted, true);
  assert.equal(calls[2].options.signal.aborted, true);
  pendingResponses[0]({ records: [{ id: 'a-private-record' }] });
  pendingResponses[1]({ user: { id: 'person-a' }, csrfToken: 'a-late-csrf' });
  await Promise.all([recordsRejected, sessionRejected]);
  await api('/meals', { method: 'POST', body: {} });
  assert.equal(calls.at(-1).options.headers['X-CSRF-Token'], 'b-csrf');
  assert.equal(calls.at(-1).options.headers['X-Profile-ID'], 'person-b');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].name, 'maker-profile-session');
  assert.deepEqual(Object.keys(notifications[0].value).sort(), ['source', 'type']);
  assert.equal(notifications[0].value.type, 'changed');
});

test('session notifications refresh other tabs without reloading their source tab', async t => {
  fixture(t, async () => response({ user: { id: 'person-b' }, csrfToken: 'b-csrf' }));
  const channels = [];
  window.BroadcastChannel = class {
    constructor() { channels.push(this); }
    postMessage(value) { for (const channel of channels) if (channel !== this) channel.onmessage?.({ data: value }); }
    close() { this.closed = true; }
  };
  let changed = 0;
  const unsubscribe = subscribeSessionChanges(() => { changed += 1; });
  await api('/profiles/switch', { method: 'POST', body: {} });
  assert.equal(changed, 0, 'This tab already applies its successful switch.');
  channels[0].onmessage({ data: { type: 'changed', source: 'a-different-browser-tab' } });
  assert.equal(changed, 1);
  unsubscribe();
  assert.equal(channels[0].closed, true);
});

test('a stale-tab mismatch asks the app to restore identity without accepting returned data', async t => {
  fixture(t, async () => ({ ok: false, status: 409, json: async () => ({ code: 'PROFILE_CHANGED', error: '다른 탭에서 프로필이 바뀌었어요.' }) }));
  let changed = 0;
  window.addEventListener('profile-session-changed', () => { changed += 1; });
  await assert.rejects(api('/records'), error => error.code === 'PROFILE_CHANGED');
  assert.equal(changed, 1);
});

test('blocked cross-tab channels cannot turn a successful profile switch into a login error', async t => {
  fixture(t, async () => response({ user: { id: 'person-b' }, csrfToken: 'b-csrf' }));
  window.BroadcastChannel = class { constructor() { throw new Error('browser feature blocked'); } };
  const unsubscribe = subscribeSessionChanges(() => assert.fail('No channel was opened'));
  const data = await api('/profiles/switch', { method: 'POST', body: {} });
  assert.equal(data.user.id, 'person-b');
  unsubscribe();
});
