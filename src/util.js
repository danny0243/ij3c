// Small helpers shared by the public site and the admin back office.

/** Marks a string as already-safe HTML so `html` does not escape it again. */
export class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}
export const raw = (value) => new Raw(String(value));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return esc(value);
}

/**
 * Tagged template that HTML-escapes every interpolated value (arrays are joined,
 * `raw()` values pass through). Templates therefore cannot leak user input as markup.
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Raw(out);
}

/** Splits a textarea value into paragraphs separated by blank lines. */
export const paragraphs = (value) =>
  String(value ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s*\r?\n\s*/g, ' ').trim())
    .filter(Boolean);

/** Splits a textarea value into trimmed, non-empty lines. */
export const lines = (value) =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Absolute URLs and root-relative paths are left alone; anything else gets `prefix`. */
export const withPrefix = (prefix, path) => (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path) ? path : prefix + path);

/** HTML response with a content-hash ETag so browsers can revalidate cheaply. */
export async function htmlResponse(request, body, { status = 200, headers = {} } = {}) {
  const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
  const responseHeaders = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=0, must-revalidate',
    etag,
    ...headers,
  };
  if (status === 200 && request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': responseHeaders['cache-control'] } });
  }
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: responseHeaders });
}

export const redirect = (location, status = 307) => new Response(null, { status, headers: { location } });
