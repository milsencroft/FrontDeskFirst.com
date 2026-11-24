// Forwards API, webhook, OAuth and admin paths from the Pages site to the backend Worker; everything else is static.
const WORKER = 'https://frontdeskfirst-core.milsonandcroft.workers.dev';
const PREFIXES = ['/api/', '/webhooks/', '/oauth/', '/admin/'];
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (!PREFIXES.some((p) => url.pathname.startsWith(p))) return next();
  const target = new URL(url.pathname + url.search, WORKER);
  const init = { method: request.method, headers: request.headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  return fetch(target, init);
}
