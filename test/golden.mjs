// UI parity check: every page rendered by the Worker must match the legacy static HTML
// (tags, attributes, text; whitespace differences are ignored).
//
//   npx wrangler dev   # in another terminal, with the seeded database
//   node test/golden.mjs [baseUrl]

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const legacy = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/legacy');

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

function tokens(source) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/gi;
  for (const m of source.matchAll(re)) {
    if (m[4] !== undefined) {
      const t = decode(m[4]).replace(/\s+/g, ' ').trim();
      if (t) out.push(`#text ${t}`);
    } else if (m[2]) {
      const attrs = [...m[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
        .map((a) => `${a[1].toLowerCase()}="${decode(a[2] ?? a[3] ?? a[4] ?? '')}"`)
        .sort();
      out.push(`<${m[1]}${m[2].toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
    } else if (/^<!doctype/i.test(m[0])) {
      out.push('<!doctype html>');
    }
  }
  return out;
}

function compare(name, actual, expected) {
  const a = tokens(actual);
  const e = tokens(expected);
  const n = Math.max(a.length, e.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== e[i]) {
      console.error(`FAIL ${name}: token ${i} differs\n  expected: ${e[i]}\n  actual:   ${a[i]}\n  context:  ${e.slice(Math.max(0, i - 3), i).join(' ')}`);
      return false;
    }
  }
  console.log(`ok   ${name} (${a.length} tokens)`);
  return true;
}

async function get(path, init) {
  const res = await fetch(base + path, { redirect: 'manual', ...init });
  return { res, body: await res.text() };
}

let failed = 0;
const check = (ok) => {
  if (!ok) failed++;
};

// pages
const home = await get('/');
check(home.res.status === 200 && compare('/', home.body, readFileSync(join(legacy, 'index.html'), 'utf8')));
// Vol.14/15 were hand-made static pages whose footer used another address than every other page.
// The footer email is now one site-wide setting (footer_email), so those two fixtures are normalised.
const FOOTER_EMAIL_UNIFIED = new Set(['14-1', '15-1']);
for (const file of readdirSync(join(legacy, 'volume')).sort()) {
  const slug = file.replace(/\.html$/, '');
  const page = await get(`/volume/${slug}`);
  let expected = readFileSync(join(legacy, 'volume', file), 'utf8');
  if (FOOTER_EMAIL_UNIFIED.has(slug)) expected = expected.replaceAll('Ij3c@ncut.edu.tw', 'ij3cae@ncut.edu.tw');
  check(page.res.status === 200 && compare(`/volume/${slug}`, page.body, expected));
}

// URL behaviour that existed before (assets engine): .html redirects to the clean URL
const redirects = [
  ['/volume/13-1.html', '/volume/13-1'],
  ['/index.html', '/'],
];
for (const [from, to] of redirects) {
  const { res } = await get(from);
  const ok = res.status === 307 && new URL(res.headers.get('location'), base).pathname === to;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${from} -> ${res.status} ${res.headers.get('location')}`);
  check(ok);
}
for (const path of ['/volume/99-9', '/volume/013-01', '/nope']) {
  const { res } = await get(path);
  const ok = res.status === 404;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path} -> ${res.status}`);
  check(ok);
}
// static assets still come from Workers Assets
for (const path of ['/assets/site.css', '/images/logo.png', '/file/ij3cv1.jpg', '/volume/paperfile/13-1/CONTENTS.pdf', '/downloads/IJ3C_template.doc']) {
  const { res } = await get(path, { method: 'HEAD' });
  const ok = res.status === 200;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path} -> ${res.status}`);
  check(ok);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
