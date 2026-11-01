// Shared helpers for the end-to-end tests (cookie-aware fetch client, tiny step runner).

export const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
export const USER = 'e2e-admin';
export const PASSWORD = process.env.E2E_PASSWORD ?? 'local-test-password-1';

export let passed = 0;
export async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}\n     ${err.message.split('\n').join('\n     ')}`);
    process.exitCode = 1;
  }
}

export class Client {
  cookies = new Map();
  async request(method, path, { form, headers = {}, origin = base } = {}) {
    const h = { ...headers };
    if (origin) h.origin = origin;
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      body = form instanceof FormData ? form : new URLSearchParams(form);
    }
    const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/Max-Age=0/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { res, buffer, text: buffer.toString('utf8') };
  }
  get = (path, opts) => this.request('GET', path, opts);
  post = (path, form, opts = {}) => this.request('POST', path, { ...opts, form });
}

export const where = (res) => new URL(res.headers.get('location'), base).pathname;
export const flashOf = (client) => {
  const raw = client.cookies.get('ij3c_flash');
  return raw ? JSON.parse(decodeURIComponent(raw)) : null;
};
export const idFrom = (res) => Number(/\/(\d+)$/.exec(where(res))[1]);
