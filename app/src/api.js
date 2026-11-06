import { supabase, supabaseConfigError } from './supabase.js';

let generation = 0;
const requests = new Set();

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError'; this.status = status; this.code = code;
  }
}

// Drop in-flight private responses when the authenticated account changes.
export function clearSession() {
  generation += 1;
  for (const controller of requests) controller.abort();
  requests.clear();
}
export function isCancelled(error) { return error?.name === 'AbortError'; }
const cancelled = () => new DOMException('Cancelled', 'AbortError');

function authRequired(message = '로그인해 주세요.') {
  clearSession();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('auth-expired'));
  return new ApiError(message, 401, 'AUTH_REQUIRED');
}

// Token refresh may involve a network request. Cancellation must also cover that wait.
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    // Always observe the SDK promise, even if it was cancelled synchronously.
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { reject(cancelled()); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function api(path, { method = 'GET', body, signal, expectedUserId } = {}) {
  const current = generation;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  requests.add(controller);
  const assertCurrent = () => {
    if (current !== generation || controller.signal.aborted) throw cancelled();
  };
  try {
    assertCurrent();
    if (!supabase) throw new ApiError(supabaseConfigError, 0, 'AUTH_CONFIGURATION_ERROR');
    const { data, error } = await abortable(supabase.auth.getSession(), controller.signal);
    assertCurrent();
    if (error) {
      if ([400, 401, 403].includes(error.status)) throw authRequired();
      throw new ApiError('로그인 정보를 확인하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.', 0, 'AUTH_SESSION_ERROR');
    }
    const token = data?.session?.access_token;
    if (!token) throw authRequired();
    // A multi-step auth flow must never apply an old account's name to a new login.
    if (expectedUserId && data.session.user?.id !== expectedUserId) throw cancelled();
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`/api${path}`, {
      method, cache: 'no-store', headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    let result;
    try { result = response.status === 204 ? {} : await response.json(); }
    catch { assertCurrent(); throw new ApiError('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.', response.status); }
    assertCurrent();
    if (!response.ok) {
      if (response.status === 401 && result.code === 'AUTH_REQUIRED') throw authRequired(result.error);
      throw new ApiError(result.error || '요청을 처리하지 못했어요.', response.status, result.code);
    }
    return result;
  } catch (error) {
    if (timedOut && current === generation) throw new ApiError('응답이 늦어지고 있어요. 연결을 확인한 뒤 다시 시도해 주세요.', 0, 'REQUEST_TIMEOUT');
    if (error instanceof ApiError) throw error;
    if (current !== generation || controller.signal.aborted || isCancelled(error)) throw cancelled();
    throw new ApiError('인터넷 연결이나 서버 상태를 확인한 뒤 다시 시도해 주세요.', 0, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout); requests.delete(controller); signal?.removeEventListener('abort', abort);
  }
}
