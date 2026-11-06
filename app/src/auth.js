import { supabase, supabaseConfigError } from './supabase';
import { api } from './api';

export function authErrorMessage(error) {
  return ({
    invalid_credentials: '이메일이나 비밀번호를 확인해 주세요.',
    email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해 주세요.',
    user_already_exists: '이미 가입된 이메일이에요. 로그인해 주세요.',
    weak_password: '더 안전한 비밀번호를 입력해 주세요.',
    over_request_rate_limit: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
    over_email_send_rate_limit: '인증 메일 요청이 많아요. 잠시 후 다시 시도해 주세요.',
  })[error?.code] || error?.message || '로그인에 실패했어요. 다시 시도해 주세요.';
}

export async function authenticate({ register, name, email, password, consent }) {
  if (!supabase) throw new Error(supabaseConfigError);
  const displayName = typeof name === 'string' ? name.trim() : '';
  if (register && (!consent || !displayName)) throw new Error('이름과 건강 기록 수집 동의를 확인해 주세요.');
  const credentials = { email: email.trim(), password };
  // Only the display name is metadata. Health consent stays in the form.
  const { data, error } = register
    ? await supabase.auth.signUp({ ...credentials, options: { data: { name: displayName } } })
    : await supabase.auth.signInWithPassword(credentials);
  if (error) throw new Error(authErrorMessage(error));
  if (register && data.session) await api('/me', { method: 'PATCH', body: { name: displayName }, expectedUserId: data.session.user.id });
  return {
    session: data.session,
    message: data.session ? '' : '가입 메일을 보냈어요. 이메일 인증 후 로그인해 주세요.',
  };
}

export async function loadAccount(authSession, signal) {
  const expectedUserId = authSession?.user?.id;
  if (!expectedUserId) throw new Error('로그인 계정을 확인하지 못했어요. 다시 로그인해 주세요.');
  const data = await api('/me', { signal, expectedUserId });
  if (data.user?.id !== expectedUserId) throw new Error('로그인 계정을 확인하지 못했어요. 다시 로그인해 주세요.');
  let name = typeof data.user.name === 'string' ? data.user.name.trim() : '';
  // A confirmed-email signup may obtain its first session on a later visit.
  const metadataName = authSession.user.user_metadata?.name;
  if (!name && typeof metadataName === 'string') {
    name = metadataName.trim().slice(0, 30);
    if (name) await api('/me', { method: 'PATCH', body: { name }, signal, expectedUserId });
  }
  return { ...data, user: { ...data.user, name: name || '사용자' } };
}
