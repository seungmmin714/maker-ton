let csrfToken = '';
let profileId = '';
let generation = 0;
const requests = new Set();
const tabSource = Math.random().toString(36).slice(2);

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError'; this.status = status; this.code = code;
  }
}

export function clearSession() {
  generation += 1; csrfToken = ''; profileId = '';
  for (const controller of requests) controller.abort();
  requests.clear();
}
export function isCancelled(error) { return error?.name === 'AbortError'; }

// Only a change notification crosses tabs. Credentials and private data stay out.
function notifyOtherTabs() {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return;
  let channel;
  try {
    channel = new window.BroadcastChannel('maker-profile-session');
    channel.postMessage({ type: 'changed', source: tabSource });
  } catch { /* Visibility revalidation and the server identity guard still apply. */ }
  finally { try { channel?.close(); } catch { /* Optional browser capability. */ } }
}

export function subscribeSessionChanges(onChange) {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return () => {};
  let channel;
  try { channel = new window.BroadcastChannel('maker-profile-session'); }
  catch { return () => {}; }
  channel.onmessage = event => {
    if (event.data?.type === 'changed' && event.data.source !== tabSource) onChange();
  };
  return () => { try { channel.close(); } catch { /* Optional browser capability. */ } };
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const current = generation;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  requests.add(controller);
  const headers = { Accept: 'application/json' };
  if (profileId && path !== '/auth/me') headers['X-Profile-ID'] = profileId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  try {
    const response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    let data;
    try { data = await response.json(); }
    catch { throw new ApiError('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.', response.status); }
    if (current !== generation || controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) {
      if (response.status === 401 && data.code === 'AUTH_REQUIRED' && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth-expired'));
      if (data.code === 'PROFILE_CHANGED') window.dispatchEvent(new Event('profile-session-changed'));
      throw new ApiError(data.error || '요청을 처리하지 못했어요.', response.status, data.code);
    }
    const identityMutation = ['/auth/login', '/auth/register', '/profiles/switch', '/profiles/link', '/profiles/register'].includes(path) && method === 'POST';
    if (data.user && data.csrfToken) {
      // Invalidate even a delayed /auth/me before accepting the new CSRF token.
      if (identityMutation || (profileId && profileId !== data.user.id)) clearSession();
      profileId = data.user.id;
    }
    if (data.csrfToken) csrfToken = data.csrfToken;
    if (identityMutation) notifyOtherTabs();
    if ((path === '/auth/logout' && method === 'POST') || (path === '/account' && method === 'DELETE')) {
      clearSession(); notifyOtherTabs();
    }
    return data;
  } catch (error) {
    if (timedOut && current === generation) throw new ApiError('응답이 늦어지고 있어요. 연결을 확인한 뒤 다시 시도해 주세요.', 0, 'REQUEST_TIMEOUT');
    if (isCancelled(error) || error instanceof ApiError) throw error;
    throw new ApiError('인터넷 연결이나 서버 상태를 확인한 뒤 다시 시도해 주세요.', 0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout); requests.delete(controller); signal?.removeEventListener('abort', abort);
  }
}
