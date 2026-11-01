// End-to-end check of the back office against a local `wrangler dev` server.
// It signs in with a throw-away admin that exists only in the local scratch database:
//
//   ADMIN_PASSWORD=local-test-password-1 node scripts/create-admin.mjs e2e-admin --local --persist-to <dir>
//   node test/e2e.mjs [baseUrl]

import assert from 'node:assert/strict';
import { Client, PASSWORD, USER, base, flashOf, idFrom, passed, step, where } from './helpers.mjs';

const admin = new Client();
const anon = new Client();

// ---------------------------------------------------------------- authentication
await step('anonymous /admin redirects to the login page', async () => {
  const { res } = await anon.get('/admin');
  assert.equal(res.status, 303);
  assert.equal(where(res), '/admin/login');
  for (const path of ['/admin/issues', '/admin/settings', '/admin/users', '/admin/audit']) {
    assert.equal((await anon.get(path)).res.status, 303, path);
  }
});

await step('login page is not indexable and carries strict security headers', async () => {
  const { res, text } = await anon.get('/admin/login');
  assert.equal(res.status, 200);
  assert.match(text, /noindex/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

await step('POST without a same-origin Origin header is rejected (CSRF)', async () => {
  assert.equal((await anon.post('/admin/login', { username: USER, password: PASSWORD }, { origin: null })).res.status, 403);
  assert.equal((await anon.post('/admin/login', { username: USER, password: PASSWORD }, { origin: 'https://evil.example' })).res.status, 403);
});

await step('wrong password and unknown user get the same generic error and no session', async () => {
  const bad = await anon.post('/admin/login', { username: USER, password: 'wrong-password-here' });
  const unknown = await anon.post('/admin/login', { username: 'nobody-here', password: 'wrong-password-here' });
  for (const r of [bad, unknown]) {
    assert.equal(r.res.status, 401);
    assert.match(r.text, /帳號或密碼錯誤/);
    assert.equal(r.res.headers.getSetCookie().length, 0);
  }
});

await step('correct login sets an HttpOnly SameSite=Strict session cookie', async () => {
  const { res } = await admin.post('/admin/login', { username: USER, password: PASSWORD });
  assert.equal(res.status, 303);
  assert.equal(where(res), '/admin');
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('ij3c_admin='));
  assert.ok(cookie, 'session cookie missing');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/admin/);
  const dash = await admin.get('/admin');
  assert.equal(dash.res.status, 200);
  assert.match(dash.text, /總覽/);
});

await step('login throttling kicks in after repeated failures (per IP)', async () => {
  const spoof = new Client();
  const headers = { 'cf-connecting-ip': '203.0.113.77' };
  for (let i = 0; i < 8; i++) await spoof.post('/admin/login', { username: `victim${i}`, password: 'x'.repeat(12) }, { headers });
  const blocked = await spoof.post('/admin/login', { username: USER, password: PASSWORD }, { headers });
  assert.equal(blocked.res.status, 429);
});

// ---------------------------------------------------------------- site settings
await step('settings: edit a text, see it on the public page, change it back', async () => {
  const page = await admin.get('/admin/settings');
  assert.equal(page.res.status, 200);
  const form = {};
  for (const m of page.text.matchAll(/<input [^>]*name="([a-z_]+)"[^>]*value="([^"]*)"/g)) form[m[1]] = m[2];
  for (const m of page.text.matchAll(/<textarea [^>]*name="([a-z_]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) form[m[1]] = m[2];
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const k of Object.keys(form)) form[k] = decode(form[k]);
  assert.ok(Object.keys(form).length >= 35, `expected 35+ fields, got ${Object.keys(form).length}`);
  const original = form.contact_person;
  const res = await admin.post('/admin/settings', { ...form, contact_person: 'E2E Person, Test University' });
  assert.equal(res.res.status, 303);
  assert.equal(flashOf(admin).type, 'ok');
  assert.match((await anon.get('/')).text, /E2E Person, Test University/);
  await admin.post('/admin/settings', { ...form, contact_person: original });
  assert.doesNotMatch((await anon.get('/')).text, /E2E Person/);
});

await step('settings: invalid email / missing {email} placeholder are rejected', async () => {
  const page = await admin.get('/admin/settings');
  const form = {};
  for (const m of page.text.matchAll(/<input [^>]*name="([a-z_]+)"[^>]*value="([^"]*)"/g)) form[m[1]] = m[2].replace(/&amp;/g, '&');
  for (const m of page.text.matchAll(/<textarea [^>]*name="([a-z_]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) form[m[1]] = m[2];
  await admin.post('/admin/settings', { ...form, contact_email: 'not-an-email' });
  assert.equal(flashOf(admin).type, 'error');
  await admin.post('/admin/settings', { ...form, support_text: 'no placeholder here' });
  assert.match(flashOf(admin).message, /\{email\}/);
});

// ---------------------------------------------------------------- issues & papers
let issueId;
await step('issues: create, appears first on the home page, empty issue page', async () => {
  const res = await admin.post('/admin/issues', { volume: '99', number: '1', pub_date: '2030/1', issn: '2304-2516 (Print), 2304-2524 (Online)', description: 'E2E test issue' });
  assert.equal(res.res.status, 303);
  issueId = idFrom(res.res);
  const home = (await anon.get('/')).text;
  assert.match(home, /Vol\.99, No\.1/);
  assert.ok(home.indexOf('Vol.99, No.1') < home.indexOf('Vol.13, No.1'), 'new issue should be listed first');
  const issue = await anon.get('/volume/99-1');
  assert.equal(issue.res.status, 200);
  assert.match(issue.text, /Papers coming soon/);
  assert.doesNotMatch(issue.text, /hero-actions/);
});

await step('issues: duplicate volume/number and bad dates are rejected', async () => {
  await admin.post('/admin/issues', { volume: '99', number: '1', pub_date: '2030/1', issn: 'x', description: 'dup' });
  assert.match(flashOf(admin).message, /已經存在/);
  await admin.post('/admin/issues', { volume: '98', number: '1', pub_date: '30-1', issn: 'x', description: 'bad date' });
  assert.match(flashOf(admin).message, /2025\/7/);
});

let paperIds = [];
await step('papers: add two (HTML is escaped), reorder, public page shows them', async () => {
  await admin.post(`/admin/issues/${issueId}/papers`, { title: 'First <b>paper</b> & "quotes"', authors: 'A. Author, B. Author', pdf: 'paperfile/13-1/IJ3C_1.pdf' });
  await admin.post(`/admin/issues/${issueId}/papers`, { title: '<img src=x onerror=alert(1)>', authors: '', pdf: '' });
  const edit = await admin.get(`/admin/issues/${issueId}`);
  paperIds = [...edit.text.matchAll(/action="\/admin\/papers\/(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(paperIds.length, 2);
  let pub = (await anon.get('/volume/99-1')).text;
  assert.match(pub, /2 papers/);
  assert.match(pub, /First &lt;b&gt;paper&lt;\/b&gt; &amp; &quot;quotes&quot;/);
  assert.doesNotMatch(pub, /<img src=x/);
  assert.match(pub, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(pub, /PDF unavailable/);
  assert.ok(pub.indexOf('First &lt;b&gt;') < pub.indexOf('&lt;img src=x'));
  await admin.post(`/admin/papers/${paperIds[1]}/move`, { dir: 'up' });
  pub = (await anon.get('/volume/99-1')).text;
  assert.ok(pub.indexOf('&lt;img src=x') < pub.indexOf('First &lt;b&gt;'), 'order should have flipped');
  await admin.post(`/admin/papers/${paperIds[1]}/move`, { dir: 'up' }); // already first: no-op, no error
  assert.equal(flashOf(admin).type, 'ok');
});

await step('papers: unsafe PDF links are rejected, edits are saved', async () => {
  for (const pdf of ['javascript:alert(1)', 'data:text/html,hi', 'paperfile/../../etc/passwd', '//evil.example/x.pdf']) {
    await admin.post(`/admin/papers/${paperIds[0]}`, { title: 'x', authors: '', pdf });
    assert.equal(flashOf(admin).type, 'error', pdf);
  }
  await admin.post(`/admin/papers/${paperIds[0]}`, { title: 'Edited title', authors: 'New Author', pdf: 'https://example.org/paper.pdf' });
  const pub = (await anon.get('/volume/99-1')).text;
  assert.match(pub, /Edited title/);
  assert.match(pub, /href="https:\/\/example\.org\/paper\.pdf"/);
});

await step('issues: cover/contents links show up as hero buttons', async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ volume: '99', number: '1', pub_date: '2030/1', issn: 'ISSN X', description: 'E2E test issue', cover_pdf: 'paperfile/13-1/COVER PAGE.pdf', contents_pdf: '', published: '1' })) f.set(k, v);
  const res = await admin.post(`/admin/issues/${issueId}`, f);
  assert.equal(res.res.status, 303);
  const pub = (await anon.get('/volume/99-1')).text;
  assert.match(pub, /Cover Page PDF/);
  assert.doesNotMatch(pub, /Contents PDF/);
  assert.match(pub, /ISSN X/);
});

await step('issues: draft status hides the issue everywhere on the public site', async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ volume: '99', number: '1', pub_date: '2030/1', issn: 'ISSN X', description: 'E2E test issue', published: '0' })) f.set(k, v);
  await admin.post(`/admin/issues/${issueId}`, f);
  assert.equal((await anon.get('/volume/99-1')).res.status, 404);
  assert.doesNotMatch((await anon.get('/')).text, /Vol\.99, No\.1/);
});

await step('issues: delete removes the issue and its papers', async () => {
  const res = await admin.post(`/admin/issues/${issueId}/delete`, {});
  assert.equal(res.res.status, 303);
  assert.equal((await anon.get('/volume/99-1')).res.status, 404);
  const orphan = await admin.get(`/admin/issues/${issueId}`);
  assert.equal(orphan.res.status, 303); // "not found" -> back with an error flash
});

// ---------------------------------------------------------------- ordered lists
await step('editorial board: add group, edit members, reorder, delete', async () => {
  await admin.post('/admin/board', { title: 'E2E Group', members: 'Alice A, Univ X\nBob B, Univ Y' });
  let home = (await anon.get('/')).text;
  assert.match(home, /<h3>E2E Group<\/h3>/);
  assert.match(home, /<li>Bob B, Univ Y<\/li>/);
  const list = await admin.get('/admin/board');
  const ids = [...list.text.matchAll(/action="\/admin\/board\/(\d+)"/g)].map((m) => Number(m[1]));
  const mine = ids.at(-1);
  await admin.post(`/admin/board/${mine}`, { title: 'E2E Group', members: 'Carol C, Univ Z' });
  home = (await anon.get('/')).text;
  assert.match(home, /<li>Carol C, Univ Z<\/li>/);
  assert.doesNotMatch(home, /Alice A/);
  await admin.post(`/admin/board/${mine}/move`, { dir: 'up' });
  home = (await anon.get('/')).text;
  assert.ok(home.indexOf('E2E Group') < home.indexOf('Associate Editors</h3>'), 'moved above the last group');
  await admin.post(`/admin/board/${mine}/delete`, {});
  assert.doesNotMatch((await anon.get('/')).text, /E2E Group/);
});

await step('aims & scopes: add / delete a topic', async () => {
  await admin.post('/admin/topics', { title: 'Topic 99 - E2E', items: 'One\nTwo' });
  assert.match((await anon.get('/')).text, /<h3>Topic 99 - E2E<\/h3>/);
  const list = await admin.get('/admin/topics');
  const id = [...list.text.matchAll(/action="\/admin\/topics\/(\d+)"/g)].map((m) => Number(m[1])).at(-1);
  await admin.post(`/admin/topics/${id}/delete`, {});
  assert.doesNotMatch((await anon.get('/')).text, /Topic 99/);
});

await step('downloads: add (unsafe links rejected) and delete', async () => {
  await admin.post('/admin/downloads', { label: 'Bad', href: 'javascript:alert(1)' });
  assert.equal(flashOf(admin).type, 'error');
  await admin.post('/admin/downloads', { label: 'E2E Form', href: 'downloads/e2e-form.pdf' });
  assert.match((await anon.get('/')).text, /<a class="download-link" href="downloads\/e2e-form\.pdf">E2E Form<\/a>/);
  const list = await admin.get('/admin/downloads');
  const id = [...list.text.matchAll(/action="\/admin\/downloads\/(\d+)"/g)].map((m) => Number(m[1])).at(-1);
  await admin.post(`/admin/downloads/${id}/delete`, {});
  assert.doesNotMatch((await anon.get('/')).text, /E2E Form/);
});

// ---------------------------------------------------------------- accounts
await step('accounts: create a second admin, sign in as them, delete rules', async () => {
  await admin.post('/admin/users', { username: 'e2e-second', password: 'second-password-1', confirm: 'second-password-1' });
  assert.equal(flashOf(admin).type, 'ok');
  await admin.post('/admin/users', { username: 'E2E-Second', password: 'second-password-1', confirm: 'second-password-1' });
  assert.match(flashOf(admin).message, /已經存在/); // usernames are case-insensitive
  await admin.post('/admin/users', { username: 'short-pw', password: 'short', confirm: 'short' });
  assert.equal(flashOf(admin).type, 'error');
  const second = new Client();
  const login = await second.post('/admin/login', { username: 'E2E-SECOND', password: 'second-password-1' });
  assert.equal(login.res.status, 303);
  assert.equal((await second.get('/admin')).res.status, 200);

  const users = await admin.get('/admin/users');
  const ids = Object.fromEntries([...users.text.matchAll(/<strong>([^<]+)<\/strong>[\s\S]*?(?:action="\/admin\/users\/(\d+)\/delete"|<\/tr>)/g)].map((m) => [m[1], m[2]]));
  assert.ok(ids['e2e-second'], 'second admin listed with a delete button');
  assert.equal(ids[USER], undefined, 'no delete button for the current account');
  await admin.post(`/admin/users/${ids['e2e-second']}/delete`, {});
  assert.equal((await second.get('/admin')).res.status, 303, 'deleted admin loses their session');
});

await step('accounts: changing the password needs the current one and ends other sessions', async () => {
  const me = new Client();
  await me.post('/admin/login', { username: USER, password: PASSWORD });
  await me.post('/admin/users/password', { current: 'not-my-password', password: 'brand-new-password-1', confirm: 'brand-new-password-1' });
  assert.match(flashOf(me).message, /目前密碼不正確/);
  await me.post('/admin/users/password', { current: PASSWORD, password: 'brand-new-password-1', confirm: 'different-password-1' });
  assert.match(flashOf(me).message, /不一致/);
  await me.post('/admin/users/password', { current: PASSWORD, password: 'brand-new-password-1', confirm: 'brand-new-password-1' });
  assert.equal(flashOf(me).type, 'ok');
  assert.equal((await admin.get('/admin')).res.status, 303, 'the other session was signed out');
  assert.equal((await me.get('/admin')).res.status, 200, 'this session survives');
  await me.post('/admin/users/password', { current: 'brand-new-password-1', password: PASSWORD, confirm: PASSWORD }); // restore
  await admin.post('/admin/login', { username: USER, password: PASSWORD });
});

await step('activity log records the changes', async () => {
  const { text } = await admin.get('/admin/audit');
  for (const word of ['登入', '新增期別', '刪除期別', '新增論文', '修改網站設定', '新增管理員']) assert.match(text, new RegExp(word), word);
});

await step('logout ends the session', async () => {
  const { res } = await admin.post('/admin/logout', {});
  assert.equal(res.status, 303);
  assert.equal((await admin.get('/admin')).res.status, 303);
});

console.log(`\n${passed} step(s) passed${process.exitCode ? ', some FAILED' : ''}`);
