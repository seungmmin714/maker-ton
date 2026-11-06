import { createApp } from '../server/index.mjs';

function restoreApiPath(req) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.searchParams.has('__api_path')) return;
  const path = url.searchParams.get('__api_path');
  url.searchParams.delete('__api_path');
  // Some runtimes retain the original URL; others expose the rewrite target.
  // The captured path lets both invoke the same application router.
  if (['/api', '/api/', '/api/index', '/api/index.mjs'].includes(url.pathname)) {
    url.pathname = path && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)
      ? `/api/${path}` : '/api/__invalid_route';
  }
  req.url = url.pathname + url.search;
}

// One app (and database pool) per warm function instance. Database state itself
// must live in the remote database because Vercel may run several instances.
export function createVercelHandler(createApplication = createApp) {
  let application;
  return async function handler(req, res) {
    try {
      restoreApiPath(req);
      application ||= createApplication().catch(error => {
        application = undefined;
        throw error;
      });
      const app = await application;
      await app.handler(req, res);
    } catch (error) {
      // Never send connection strings, provider responses, or key values.
      console.error('API initialization failed:', error?.name || 'Error', error?.code || 'unknown');
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(503, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Retry-After': '5',
      });
      res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', error: '서버 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요.' }));
    }
  };
}

export default createVercelHandler();
