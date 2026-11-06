import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function backendOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('백엔드의 실제 https:// 주소를 입력하세요.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || url.hostname.endsWith('.invalid')) {
    throw new Error('백엔드 원본 주소만 입력하세요. /api 경로·인증정보·쿼리는 넣지 않습니다.');
  }
  return url.origin;
}

export async function configureBackend(value, root = fileURLToPath(new URL('../', import.meta.url))) {
  const origin = backendOrigin(value);
  const configPath = resolve(root, 'vercel.json');
  const envPath = resolve(root, '.env');
  const originalConfig = await readFile(configPath, 'utf8');
  const config = JSON.parse(originalConfig);
  const rewrite = config.rewrites?.find(item => item.source === '/api/:path*');
  if (!rewrite) throw new Error('vercel.json에서 /api 프록시 설정을 찾지 못했습니다.');
  let env;
  try { env = await readFile(envPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    env = await readFile(resolve(root, '.env.example'), 'utf8');
  }
  rewrite.destination = `${origin}/api/:path*`;
  const entry = `BACKEND_URL=${origin}`;
  env = /^BACKEND_URL=.*$/m.test(env)
    ? env.replace(/^BACKEND_URL=.*$/m, () => entry)
    : `${env.trimEnd()}\n${entry}\n`;
  // Stage both files before replacing either. Never print existing environment values.
  const configTemp = `${configPath}.tmp`;
  const envTemp = `${envPath}.tmp`;
  await writeFile(configTemp, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(envTemp, env, { mode: 0o600 });
  await rename(configTemp, configPath);
  try { await rename(envTemp, envPath); }
  catch (error) { await writeFile(configPath, originalConfig); throw error; }
  return origin;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await configureBackend(process.argv[2]);
    console.log('Vercel /api rewrite와 로컬 BACKEND_URL을 설정했습니다. 환경변수 값은 출력하지 않습니다.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
