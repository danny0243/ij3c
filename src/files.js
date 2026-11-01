// Uploaded files (PDFs added through the back office) live in R2 when a FILES binding exists.
// Files that ship with the site (public/volume/paperfile/...) are served by Workers Assets before
// the Worker runs, so this module only sees paths the assets do not contain.
//
// Every R2 operation is guarded (see limits.js) so usage cannot run past the free allowance:
//   1. only names the back office generates, and only files listed in `stored_files`, ever reach R2
//   2. per-IP rate limit (PDF_LIMITER binding, when configured)
//   3. edge cache: a cached download costs no R2 operation
//   4. monthly read/write/storage caps

import { assertCanUpload, noteRead, noteWrite, readAllowed, usageSnapshot } from './limits.js';

export const filesEnabled = (env) => Boolean(env.FILES);

const notFound = () => new Response('Not found', { status: 404 });

// The only names putPdf() creates: volume/paperfile/<vol>-<no>/<name>-<8 hex>.pdf
const KEY_RE = /^volume\/paperfile\/\d{1,4}-\d{1,4}\/[\w.() -]{1,120}-[0-9a-f]{8}\.pdf$/i;
const CACHE_TTL = 3600; // seconds; also how long a deleted file can still be served from edge caches
const FORWARDED = ['range', 'if-none-match', 'if-modified-since'];

// Cache entries use a fixed synthetic origin so every hostname (custom domain, workers.dev, ...) shares one entry per file.
const cacheRequest = (key, headers) => new Request(`https://r2-cache.invalid/${key}`, headers ? { headers } : undefined);

const asMethod = (response, method) => (method === 'HEAD' ? new Response(null, response) : response);

export async function serveStoredFile(env, request, ctx, pathname) {
  if (!filesEnabled(env)) return notFound();
  let key;
  try {
    key = decodeURIComponent(pathname.slice(1));
  } catch {
    return notFound();
  }
  if (!KEY_RE.test(key)) return notFound();

  if (env.PDF_LIMITER) {
    const { success } = await env.PDF_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' });
    if (!success) return new Response('Too many requests', { status: 429, headers: { 'retry-after': '60' } });
  }

  // Edge cache first. Range / conditional headers are passed through so the cache can answer 206 / 304 itself.
  const cache = caches.default;
  const forwarded = new Headers();
  for (const name of FORWARDED) if (request.headers.has(name)) forwarded.set(name, request.headers.get(name));
  const cached = await cache.match(cacheRequest(key, forwarded));
  if (cached) return asMethod(cached, request.method);

  const path = key.slice('volume/'.length);
  const [file, usage] = await Promise.all([env.DB.prepare('SELECT size FROM stored_files WHERE path = ?').bind(path).first(), usageSnapshot(env)]);
  if (!file) return notFound();
  if (!readAllowed(usage)) {
    console.warn(`R2 read cap reached for ${usage.month}: ${usage.classB}/${usage.caps.classB}`);
    return new Response('This file is temporarily unavailable. Please try again later.', {
      status: 503,
      headers: { 'retry-after': '3600', 'cache-control': 'no-store' },
    });
  }

  const object = await env.FILES.get(key);
  noteRead(env, ctx);
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('content-length', String(object.size));
  headers.set('cache-control', `public, max-age=${CACHE_TTL}`);
  headers.set('x-content-type-options', 'nosniff');
  const full = new Response(object.body, { status: 200, headers });
  await cache.put(cacheRequest(key), full.clone());
  // Let the cache apply Range / conditional headers; where caching is unavailable (workers.dev) answer with the full file.
  const answer = (await cache.match(cacheRequest(key, forwarded))) ?? full;
  return asMethod(answer, request.method);
}

/** Stores an uploaded PDF under paperfile/<folder>/<name> and returns that site-relative path. */
export async function putPdf(env, folder, originalName, data) {
  await assertCanUpload(env, data.byteLength);
  const base =
    originalName
      .replace(/\.pdf$/i, '')
      .replace(/[^\w.() -]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'file';
  const path = `paperfile/${folder}/${base}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await env.FILES.put(`volume/${path}`, data, { httpMetadata: { contentType: 'application/pdf' } });
  try {
    await env.DB.batch([env.DB.prepare('INSERT INTO stored_files (path, size) VALUES (?, ?)').bind(path, data.byteLength), noteWrite(env)]);
  } catch (err) {
    await env.FILES.delete(`volume/${path}`); // never leave an untracked object behind
    throw err;
  }
  return path;
}

/** Removes an uploaded file. Paths that are not in the inventory (shipped assets, external URLs) are ignored. */
export async function deleteStored(env, path) {
  if (!filesEnabled(env) || !path || !path.startsWith('paperfile/')) return;
  const known = await env.DB.prepare('SELECT 1 AS found FROM stored_files WHERE path = ?').bind(path).first();
  if (!known) return;
  await env.FILES.delete(`volume/${path}`);
  await env.DB.prepare('DELETE FROM stored_files WHERE path = ?').bind(path).run();
  await caches.default.delete(cacheRequest(`volume/${path}`)); // purges this data centre; others expire within CACHE_TTL
}
