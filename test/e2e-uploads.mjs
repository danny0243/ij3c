// PDF upload / R2 serving checks. Needs a dev server with the FILES (R2) binding, which wrangler.toml now has
// (wrangler dev simulates R2 locally). Run after test/e2e.mjs has left the e2e-admin account in place:
//
//   node test/e2e-uploads.mjs [baseUrl]

import assert from 'node:assert/strict';
import { Client, PASSWORD, USER, base, flashOf, idFrom, passed, step } from './helpers.mjs';

const admin = new Client();
const anon = new Client();

const pdfBytes = (marker) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
const pdfFile = (name, marker) => new File([pdfBytes(marker)], name, { type: 'application/pdf' });
const issueForm = (extra = {}) => {
  const f = new FormData();
  const fields = { volume: '98', number: '1', pub_date: '2030/2', issn: 'ISSN X', description: 'Upload test issue', published: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const pathFrom = (html, re) => re.exec(html)?.[1];

await step('sign in', async () => {
  const r = await admin.post('/admin/login', { username: USER, password: PASSWORD });
  assert.equal(r.res.status, 303);
});

let issueId;
await step('the edit page offers file inputs once R2 is bound', async () => {
  const created = await admin.post('/admin/issues', { volume: '98', number: '1', pub_date: '2030/2', issn: 'ISSN X', description: 'Upload test issue' });
  issueId = idFrom(created.res);
  const { text } = await admin.get(`/admin/issues/${issueId}`);
  assert.match(text, /name="cover_file"/);
  assert.match(text, /name="pdf_file"/);
  assert.doesNotMatch(text, /尚未啟用/);
});

let coverPath;
await step('uploading a cover PDF stores it in R2 and serves it from the public URL', async () => {
  const f = issueForm({ cover_pdf: '', contents_pdf: '' });
  f.set('cover_file', pdfFile('My Cover (final).pdf', 'cover-1'));
  const res = await admin.post(`/admin/issues/${issueId}`, f);
  assert.equal(res.res.status, 303);
  assert.equal(flashOf(admin).type, 'ok');
  const page = await anon.get('/volume/98-1');
  coverPath = pathFrom(page.text, /href="(paperfile\/98-1\/My Cover \(final\)-[0-9a-f]{8}\.pdf)">Cover Page PDF/);
  assert.ok(coverPath, 'cover link not found on the public page');
  const file = await anon.get(`/volume/${encodeURI(coverPath)}`);
  assert.equal(file.res.status, 200);
  assert.equal(file.res.headers.get('content-type'), 'application/pdf');
  assert.equal(file.res.headers.get('accept-ranges'), 'bytes');
  assert.ok(file.buffer.equals(pdfBytes('cover-1')), 'served bytes differ from the upload');
});

await step('conditional and range requests work (PDF viewers rely on them)', async () => {
  const url = `/volume/${encodeURI(coverPath)}`;
  const first = await anon.get(url);
  const etag = first.res.headers.get('etag');
  assert.ok(etag);
  assert.equal((await anon.get(url, { headers: { 'if-none-match': etag } })).res.status, 304);
  const ranged = await anon.get(url, { headers: { range: 'bytes=0-3' } });
  assert.equal(ranged.res.status, 206);
  assert.equal(ranged.buffer.toString(), '%PDF');
  assert.equal(ranged.res.headers.get('content-range'), `bytes 0-3/${pdfBytes('cover-1').length}`);
  const head = await anon.request('HEAD', url);
  assert.equal(head.res.status, 200);
  assert.equal(head.buffer.length, 0);
});

let paperId;
let paperPath;
await step('uploading a paper PDF through the add-paper form', async () => {
  const f = new FormData();
  f.set('title', 'Uploaded paper');
  f.set('authors', 'U. Ploader');
  f.set('pdf', '');
  f.set('pdf_file', pdfFile('paper one.pdf', 'paper-1'));
  await admin.post(`/admin/issues/${issueId}/papers`, f);
  assert.equal(flashOf(admin).type, 'ok');
  const edit = await admin.get(`/admin/issues/${issueId}`);
  paperId = Number(/action="\/admin\/papers\/(\d+)"/.exec(edit.text)[1]);
  const page = await anon.get('/volume/98-1');
  paperPath = pathFrom(page.text, /class="pdf-link" href="(paperfile\/98-1\/paper one-[0-9a-f]{8}\.pdf)"/);
  assert.ok(paperPath);
  assert.ok((await anon.get(`/volume/${encodeURI(paperPath)}`)).buffer.equals(pdfBytes('paper-1')));
});

await step('files that are not PDFs, or are too large, are refused', async () => {
  const fake = new FormData();
  fake.set('title', 'Fake');
  fake.set('pdf', '');
  fake.set('pdf_file', new File(['<html>not a pdf</html>'], 'evil.pdf', { type: 'application/pdf' }));
  await admin.post(`/admin/issues/${issueId}/papers`, fake);
  assert.match(flashOf(admin).message, /不是有效的 PDF/);
  const big = new FormData();
  big.set('title', 'Big');
  big.set('pdf', '');
  big.set('pdf_file', new File([Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(16 * 1024 * 1024)])], 'big.pdf', { type: 'application/pdf' }));
  await admin.post(`/admin/issues/${issueId}/papers`, big);
  assert.match(flashOf(admin).message, /15 MB/);
  const edit = await admin.get(`/admin/issues/${issueId}`);
  assert.equal([...edit.text.matchAll(/action="\/admin\/papers\/(\d+)"/g)].length, 1, 'no extra paper should have been created');
});

await step('replacing a PDF deletes the previous upload', async () => {
  const f = new FormData();
  f.set('title', 'Uploaded paper');
  f.set('authors', 'U. Ploader');
  f.set('pdf', paperPath);
  f.set('pdf_file', pdfFile('paper two.pdf', 'paper-2'));
  await admin.post(`/admin/papers/${paperId}`, f);
  assert.equal(flashOf(admin).type, 'ok');
  assert.equal((await anon.get(`/volume/${encodeURI(paperPath)}`)).res.status, 404, 'old upload should be gone');
  const page = await anon.get('/volume/98-1');
  const newPath = pathFrom(page.text, /class="pdf-link" href="(paperfile\/98-1\/paper two-[0-9a-f]{8}\.pdf)"/);
  assert.ok(newPath);
  assert.equal((await anon.get(`/volume/${encodeURI(newPath)}`)).res.status, 200);
  paperPath = newPath;
});

await step('shipped (static) PDFs and traversal attempts behave', async () => {
  assert.equal((await anon.get('/volume/paperfile/13-1/CONTENTS.pdf')).res.status, 200); // from Workers Assets
  assert.equal((await anon.get('/volume/paperfile/%2e%2e/%2e%2e/secret')).res.status, 404);
  assert.equal((await anon.get('/volume/paperfile/98-1/does-not-exist.pdf')).res.status, 404);
  assert.equal((await anon.get('/volume/paperfile/%E0%A4%A')).res.status, 404); // malformed escape
});

await step('deleting a paper and then the issue removes every uploaded file', async () => {
  await admin.post(`/admin/papers/${paperId}/delete`, {});
  assert.equal((await anon.get(`/volume/${encodeURI(paperPath)}`)).res.status, 404);
  await admin.post(`/admin/issues/${issueId}/delete`, {});
  assert.equal((await anon.get(`/volume/${encodeURI(coverPath)}`)).res.status, 404);
});

await admin.post('/admin/logout', {});
console.log(`\n${passed} step(s) passed${process.exitCode ? ', some FAILED' : ''}`);
