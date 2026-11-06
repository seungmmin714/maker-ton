import { createClient } from '@supabase/supabase-js';

const env = import.meta.env ?? {};
const url = env.VITE_SUPABASE_URL?.trim();
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
let client = null;
let configurationError = '';

if (!url || !publishableKey) {
  configurationError = '로그인 연결 설정이 필요해요. Supabase 환경변수를 확인해 주세요.';
} else if (!publishableKey.startsWith('sb_publishable_')) {
  configurationError = 'Supabase 공개용 publishable 키를 설정해 주세요.';
} else {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid URL');
    client = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    configurationError = '로그인 연결 설정을 확인해 주세요. Supabase 주소가 올바르지 않아요.';
  }
}

export const supabase = client;
export const supabaseConfigError = configurationError;
