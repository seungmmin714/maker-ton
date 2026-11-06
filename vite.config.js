import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode }) => {
  // app/ is the web root; shared environment files live at the project root.
  const env = loadEnv(mode, projectRoot, '');
  const backendUrl = process.env.BACKEND_URL || env.BACKEND_URL;
  if (command === 'serve' && !backendUrl) {
    throw new Error('BACKEND_URL이 필요합니다. npm run configure:backend -- https://새-백엔드-주소 를 실행하세요.');
  }
  return {
    root: 'app',
    envDir: projectRoot,
    build: { outDir: '../dist', emptyOutDir: true },
    server: {
      proxy: backendUrl ? { '/api': { target: backendUrl, changeOrigin: true } } : {},
    },
    esbuild: { jsx: 'automatic' },
  };
});
