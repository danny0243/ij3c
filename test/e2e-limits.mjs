// R2 usage guard checks: caps on writes / reads / storage, edge caching, rate limit and the file inventory.
//
//   node test/e2e-limits.mjs [baseUrl]

import assert from 'node:assert/strict';
import { Client, PASSWORD, USER, base, flashOf, idFrom, passed, step } from './helpers.mjs';

const admin = new Client();
const anon = new Client();

const pdf = (marker, extra = 0) => new File([Buffer.concat([Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`), Buffer.alloc(extra)])], `${marker}.pdf`, { type: 'application/pdf' });
const num = (s) => Number(s.replace(/,/g, ''));
const usage = async () => {
  const { text } = await admin.get('/admin/storage');
  const read = (label) => num(new RegExp(`${label}[\\s\\S]*?([\\d,]+) / 站內上限`).exec(text)[1]);
  return { a: read('本月寫入次數（Class A）'), b: read('本月讀取次數（Class B）'), text };
};
const setCaps = (storageMb, classA, classB) => admin.post('/admin/storage/limits', { storageBytes: String(storageMb), classA: String(classA), classB: String(classB) });
const resetCaps = () => admin.post('/admin/storage/limits', { reset: '1' });

await admin.post('/admin/login', { username: USER, password: PASSWORD });
await resetCaps();

await step('dashboard and storage page show the usage meters', async () => {
  const dash = await admin.get('/admin');
  assert.match(dash.text, /R2 用量/);
  const page = await admin.get('/admin/storage');
  assert.equal(page.res.status, 200);
  for (const w of ['儲存空間', '本月讀取次數（Class B）', '本月寫入次數（Class A）', '用量上限', '已上傳的檔案']) assert.match(page.text, new RegExp(w), w);
  assert.match(page.text, /<progress /);
  assert.match(page.text, /5,000,000/); // default read cap: half of the 10M free allowance
});

await step('caps cannot be set above the free allowance, only whole numbers', async () => {
  for (const [s, a, b] of [[10241, 1, 1], [1, 1_000_001, 1], [1, 1, 10_000_001], [-1, 1, 1]]) {
    await setCaps(s, a, b);
    assert.equal(flashOf(admin).type, 'error', `${s}/${a}/${b}`);
  }
  await admin.post('/admin/storage/limits', { storageBytes: '1.5', classA: '1', classB: '1' });
  assert.equal(flashOf(admin).type, 'error');
  await setCaps(100, 1000, 5000);
  assert.equal(flashOf(admin).type, 'ok');
  assert.match((await admin.get('/admin/storage')).text, /value="5000"/);
  await resetCaps();
  assert.match((await admin.get('/admin/storage')).text, /value="5000000"/);
});

let issueId;
const paths = [];
const upload = async (marker, extra = 0) => {
  const f = new FormData();
  f.set('title', marker);
  f.set('authors', '');
  f.set('pdf', '');
  f.set('pdf_file', pdf(marker, extra));
  await admin.post(`/admin/issues/${issueId}/papers`, f);
};

await step('write cap: uploads stop once the monthly Class A cap is reached', async () => {
  issueId = idFrom((await admin.post('/admin/issues', { volume: '97', number: '1', pub_date: '2030/3', issn: 'X', description: 'limits test' })).res);
  await admin.post(`/admin/issues/${issueId}`, { volume: '97', number: '1', pub_date: '2030/3', issn: 'X', description: 'limits test', published: '1' }); // drafts have no public page
  const before = await usage();
  await setCaps(100, before.a + 2, 5_000_000);
  await upload('w1');
  assert.equal(flashOf(admin).type, 'ok');
  await upload('w2');
  assert.equal(flashOf(admin).type, 'ok');
  await upload('w3');
  assert.equal(flashOf(admin).type, 'error');
  assert.match(flashOf(admin).message, /寫入次數已達上限/);
  assert.equal((await usage()).a, before.a + 2);
  await resetCaps();
  for (const m of ['w4', 'w5', 'w6']) {
    await upload(m);
    assert.equal(flashOf(admin).type, 'ok', m);
  }
  const pub = (await anon.get('/volume/97-1')).text;
  paths.push(...[...pub.matchAll(/class="pdf-link" href="(paperfile\/97-1\/[^"]+)"/g)].map((m) => m[1]));
  assert.equal(paths.length, 5, 'w1, w2 and w4-w6 were stored');
});

await step('storage cap: an upload that would pass the cap is refused', async () => {
  await setCaps(1, 500_000, 5_000_000);
  await upload('too-big', 1.2 * 1024 * 1024);
  assert.match(flashOf(admin).message, /儲存空間已達上限/);
  await setCaps(100, 500_000, 5_000_000);
  await upload('fits', 1.2 * 1024 * 1024);
  assert.equal(flashOf(admin).type, 'ok');
  const pub = (await anon.get('/volume/97-1')).text;
  paths.push(...[...pub.matchAll(/class="pdf-link" href="(paperfile\/97-1\/fits[^"]+)"/g)].map((m) => m[1]));
  await resetCaps();
});

const url = (p) => `/volume/${encodeURI(p)}`;
await step('read cap: after the cap, uncached files answer 503 but cached ones keep working', async () => {
  const before = await usage();
  await setCaps(100, 500_000, before.b + 3);
  const codes = [];
  for (const p of paths.slice(0, 5)) codes.push((await anon.get(url(p))).res.status);
  assert.deepEqual(codes, [200, 200, 200, 503, 503], 'three reads fit under the cap');
  const blocked = await anon.get(url(paths[4]));
  assert.equal(blocked.res.headers.get('retry-after'), '3600');
  assert.equal(blocked.res.headers.get('cache-control'), 'no-store');
  assert.equal((await anon.get(url(paths[0]))).res.status, 200, 'cache hit costs no R2 read, so it still works');
  assert.equal((await anon.get(url(paths[0]))).res.status, 200);
  assert.equal((await usage()).b, before.b + 3, 'cache hits are not counted');
  await resetCaps();
  assert.equal((await anon.get(url(paths[4]))).res.status, 200, 'works again once the cap is raised');
});

await step('files outside the inventory never reach R2 (and are not counted)', async () => {
  const before = await usage();
  for (const p of ['/volume/paperfile/97-1/ghost-deadbeef.pdf', '/volume/paperfile/1-1/IJ3C_1-deadbeef.pdf', '/volume/paperfile/97-1/notmatching.pdf', '/volume/paperfile/97-1/x.txt']) {
    assert.equal((await anon.get(p)).res.status, 404, p);
  }
  assert.equal((await usage()).b, before.b);
});

await step('per-IP rate limit on uploaded-PDF downloads', async () => {
  const headers = { 'cf-connecting-ip': '203.0.113.50' };
  let limited = 0;
  for (let i = 0; i < 75; i++) if ((await anon.get(url(paths[0]), { headers })).res.status === 429) limited++;
  assert.ok(limited > 0, 'expected some 429 responses after 60 requests in a minute');
  assert.equal((await anon.get(url(paths[0]), { headers: { 'cf-connecting-ip': '203.0.113.51' } })).res.status, 200, 'another IP is unaffected');
});

await step('inventory lists uploads; deleting the issue empties it again', async () => {
  const page = await admin.get('/admin/storage');
  for (const p of paths) assert.ok(page.text.includes(encodeURI(p).replace(/&/g, '&amp;')) || page.text.includes(p), p);
  await admin.post(`/admin/issues/${issueId}/delete`, {});
  const after = await admin.get('/admin/storage');
  assert.doesNotMatch(after.text, /paperfile\/97-1\//);
  assert.equal((await anon.get(url(paths[1]))).res.status, 404);
});

await resetCaps();
await admin.post('/admin/logout', {});
console.log(`\n${passed} step(s) passed${process.exitCode ? ', some FAILED' : ''}`);
