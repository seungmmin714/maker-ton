import { readFile, writeFile } from 'node:fs/promises';

try {
  await readFile('.env');
  console.log('.env가 이미 있습니다. 기존 설정을 유지했습니다.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  await writeFile('.env', template, { mode: 0o600, flag: 'wx' });
  console.log('.env에 프론트 설정을 만들었습니다. configure:backend 명령으로 백엔드 주소를 설정하세요.');
}
