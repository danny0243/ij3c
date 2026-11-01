// Back-office pages. Everything goes through the escaping `html` tag; there are no inline styles or scripts
// so the strict Content-Security-Policy set in index.js can stay in force.

import { SETTING_FIELDS, SETTING_GROUPS } from '../settings.js';
import { esc, html, raw } from '../util.js';

const NAV = [
  ['/admin', '總覽'],
  ['/admin/issues', '期別與論文'],
  ['/admin/board', '編輯委員會'],
  ['/admin/topics', '宗旨與範圍'],
  ['/admin/downloads', '下載檔案'],
  ['/admin/storage', '檔案與用量'],
  ['/admin/settings', '網站設定'],
  ['/admin/users', '管理員'],
  ['/admin/audit', '操作紀錄'],
];

const attrs = (o) =>
  raw(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
      .join(' '),
  );
const input = (name, value, o = {}) => html`<input ${attrs({ type: 'text', name, value: value ?? '', ...o })}>`;
const textarea = (name, value, o = {}) => html`<textarea ${attrs({ name, rows: 4, ...o })}>${value ?? ''}</textarea>`;
const field = (label, control, help) =>
  html`<label class="field"><span class="field-label">${label}</span>${control}${help ? html`<small class="help">${help}</small>` : ''}</label>`;

export const formatTime = (iso) =>
  new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function page({ title, user, flash, active }, body) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${title} · IJ3C 後台</title>
  <link rel="stylesheet" href="/assets/admin.css">
  <script src="/assets/admin.js" defer></script>
</head>
<body class="admin">
  <header class="admin-bar">
    <a class="admin-brand" href="/admin">IJ3C 後台管理</a>
    <nav class="admin-nav" aria-label="後台選單">
      ${NAV.map(([href, label]) => html`<a href="${href}" class="${href === active ? 'is-active' : ''}">${label}</a>`)}
      <a href="/" target="_blank" rel="noopener">前台首頁 ↗</a>
    </nav>
    <form class="admin-user" method="post" action="/admin/logout">
      <span>${user.username}</span>
      <button class="btn btn-small" type="submit">登出</button>
    </form>
  </header>
  <main class="admin-main">
    ${flash ? html`<div class="flash flash-${flash.type}" role="status">${flash.message}</div>` : ''}
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`.toString();
}

export function loginPage({ error, username = '' } = {}) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>登入 · IJ3C 後台</title>
  <link rel="stylesheet" href="/assets/admin.css">
</head>
<body class="admin admin-login">
  <main class="login-card">
    <img src="/images/logo.png" alt="" width="52" height="35">
    <h1>IJ3C 後台管理</h1>
    ${error ? html`<div class="flash flash-error" role="alert">${error}</div>` : ''}
    <form method="post" action="/admin/login" class="stack">
      ${field('帳號', input('username', username, { required: true, autocomplete: 'username', autofocus: true, maxlength: 64 }))}
      ${field('密碼', input('password', '', { type: 'password', required: true, autocomplete: 'current-password', maxlength: 200 }))}
      <button class="btn btn-primary" type="submit">登入</button>
    </form>
    <p class="muted"><a href="/">← 回到網站首頁</a></p>
  </main>
</body>
</html>`.toString();
}

export function dashboard({ counts, recent, filesOn, sessionHours, usage }) {
  const stat = (n, label, href) => html`<a class="stat" href="${href}"><strong>${n}</strong><span>${label}</span></a>`;
  return html`
    <div class="stats">
      ${stat(counts.issues, '期別', '/admin/issues')}
      ${stat(counts.papers, '論文', '/admin/issues')}
      ${stat(counts.groups, '編輯委員群組', '/admin/board')}
      ${stat(counts.users, '管理員', '/admin/users')}
    </div>
    <section class="card">
      <h2>常用操作</h2>
      <p class="actions">
        <a class="btn btn-primary" href="/admin/issues">新增期別／論文</a>
        <a class="btn" href="/admin/board">調整編輯委員會</a>
        <a class="btn" href="/admin/settings">修改網站文字</a>
      </p>
      <p class="muted">所有修改儲存後立即反映在前台網站（${raw('<a href="/" target="_blank" rel="noopener">ij3c.ncut.tw</a>')}）。${filesOn ? 'PDF 檔案可直接上傳。' : 'PDF 檔案上傳尚未啟用（需啟用 Cloudflare R2），目前可填寫 PDF 路徑或完整網址。'}登入逾時時間為 ${sessionHours} 小時。</p>
    </section>
    ${usage ? html`<section class="card">
      <h2>R2 用量（${usage.month}）</h2>
      ${meters(usage)}
      <p class="muted"><a href="/admin/storage">查看已上傳檔案、調整用量上限</a></p>
    </section>` : ''}
    <section class="card">
      <h2>最近的操作</h2>
      ${auditTable(recent)}
    </section>`;
}

export function auditTable(rows) {
  if (!rows.length) return html`<p class="muted">尚無紀錄。</p>`;
  return html`<table class="table">
    <thead><tr><th>時間</th><th>帳號</th><th>動作</th><th>內容</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td class="nowrap">${formatTime(r.created_at)}</td><td>${r.username}</td><td>${r.action}</td><td>${r.detail}</td></tr>`)}</tbody>
  </table>`;
}

// ---- issues & papers

export function issuesList({ issues, defaults }) {
  return html`
    <section class="card">
      <h2>已建立的期別</h2>
      <table class="table">
        <thead><tr><th>期別</th><th>出版日期</th><th>論文數</th><th>狀態</th><th></th></tr></thead>
        <tbody>
          ${issues.map(
            (i) => html`<tr>
            <td><strong>Vol.${i.volume}, No.${i.number}</strong></td>
            <td>${i.pub_date}</td>
            <td>${i.papers}</td>
            <td>${i.published ? html`<span class="badge badge-ok">公開</span>` : html`<span class="badge">草稿</span>`}</td>
            <td class="right"><a class="btn btn-small" href="/admin/issues/${i.id}">編輯</a></td>
          </tr>`,
          )}
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>新增期別</h2>
      <p class="muted">新建立的期別預設是「草稿」，前台看不到；加入論文後再到期別頁把「狀態」改成「公開」。</p>
      <form method="post" action="/admin/issues" class="grid">
        ${field('卷（Volume）', input('volume', '', { type: 'number', min: 1, max: 9999, required: true }))}
        ${field('期（No.）', input('number', '', { type: 'number', min: 1, max: 9999, required: true }))}
        ${field('出版日期', input('pub_date', '', { required: true, placeholder: '2026/12', pattern: '\\d{4}/\\d{1,2}', maxlength: 10 }), '格式：年/月，例如 2026/12')}
        ${field('ISSN', input('issn', defaults.issn, { required: true, maxlength: 80 }))}
        <div class="span-2">${field('期別說明', input('description', defaults.description, { required: true, maxlength: 300 }))}</div>
        <div class="span-2"><button class="btn btn-primary" type="submit">建立並繼續編輯</button></div>
      </form>
    </section>`;
}

const pdfControl = (label, name, value, filesOn, uploadName) =>
  html`<div class="pdf-field">
    ${field(label, input(name, value ?? '', { maxlength: 300, placeholder: 'paperfile/14-1/檔名.pdf 或 https://…' }), '留白代表不顯示')}
    ${filesOn ? field('或上傳新的 PDF', html`<input type="file" name="${uploadName}" accept="application/pdf,.pdf">`) : ''}
  </div>`;

export function issueEdit({ issue, papers, filesOn }) {
  const slug = `${issue.volume}-${issue.number}`;
  const upload = filesOn
    ? html`<p class="muted">上傳的 PDF 單檔上限 15 MB。上傳後會自動改寫上方的路徑。</p>`
    : html`<p class="muted">檔案上傳尚未啟用（需啟用 Cloudflare R2）。PDF 請填寫既有路徑或完整網址。</p>`;
  return html`
    <p class="crumbs"><a href="/admin/issues">← 回到期別列表</a> · <a href="/volume/${slug}" target="_blank" rel="noopener">查看前台頁面 ↗</a></p>
    <section class="card">
      <h2>期別資料</h2>
      <form method="post" action="/admin/issues/${issue.id}" enctype="multipart/form-data" class="grid">
        ${field('卷（Volume）', input('volume', issue.volume, { type: 'number', min: 1, max: 9999, required: true }))}
        ${field('期（No.）', input('number', issue.number, { type: 'number', min: 1, max: 9999, required: true }))}
        ${field('出版日期', input('pub_date', issue.pub_date, { required: true, pattern: '\\d{4}/\\d{1,2}', maxlength: 10 }), '格式：年/月，例如 2026/12')}
        ${field('ISSN', input('issn', issue.issn, { required: true, maxlength: 80 }))}
        <div class="span-2">${field('期別說明', input('description', issue.description, { required: true, maxlength: 300 }))}</div>
        <div>${pdfControl('封面 PDF 路徑', 'cover_pdf', issue.cover_pdf, filesOn, 'cover_file')}</div>
        <div>${pdfControl('目錄 PDF 路徑', 'contents_pdf', issue.contents_pdf, filesOn, 'contents_file')}</div>
        <div class="span-2">
          ${field('狀態', html`<select name="published"><option value="1" ${attrs({ selected: issue.published === 1 })}>公開（前台可見）</option><option value="0" ${attrs({ selected: issue.published === 0 })}>草稿（前台隱藏）</option></select>`)}
        </div>
        <div class="span-2">${upload}<button class="btn btn-primary" type="submit">儲存期別資料</button></div>
      </form>
    </section>

    <section class="card">
      <h2>論文列表（${papers.length} 篇）</h2>
      ${papers.length ? '' : html`<p class="muted">這一期還沒有論文，前台會顯示「Papers coming soon」。</p>`}
      ${papers.map((p, i) => paperForm(p, i, papers.length, filesOn))}
      <h3>新增論文</h3>
      <form method="post" action="/admin/issues/${issue.id}/papers" enctype="multipart/form-data" class="paper stack">
        ${field('論文標題', textarea('title', '', { rows: 2, required: true, maxlength: 500 }))}
        ${field('作者', input('authors', '', { maxlength: 500 }), '多位作者用逗號分隔')}
        ${pdfControl('PDF 路徑', 'pdf', '', filesOn, 'pdf_file')}
        <div><button class="btn btn-primary" type="submit">新增論文</button></div>
      </form>
    </section>

    <section class="card card-danger">
      <h2>刪除這一期</h2>
      <p class="muted">會一併刪除這一期的所有論文資料（已上傳的 PDF 也會移除）。</p>
      <form method="post" action="/admin/issues/${issue.id}/delete">
        <button class="btn btn-danger" type="submit" data-confirm="確定要刪除 Vol.${issue.volume}, No.${issue.number} 與其所有論文嗎？此動作無法復原。">刪除 Vol.${issue.volume}, No.${issue.number}</button>
      </form>
    </section>`;
}

function paperForm(p, index, total, filesOn) {
  return html`<form method="post" action="/admin/papers/${p.id}" enctype="multipart/form-data" class="paper stack">
    <div class="paper-head"><span class="paper-no">${String(index + 1).padStart(2, '0')}</span>
      <span class="row-actions">
        <button class="btn btn-small" type="submit" formaction="/admin/papers/${p.id}/move" name="dir" value="up" formnovalidate ${attrs({ disabled: index === 0 })} title="上移">↑</button>
        <button class="btn btn-small" type="submit" formaction="/admin/papers/${p.id}/move" name="dir" value="down" formnovalidate ${attrs({ disabled: index === total - 1 })} title="下移">↓</button>
        <button class="btn btn-small btn-danger" type="submit" formaction="/admin/papers/${p.id}/delete" formnovalidate data-confirm="確定要刪除這篇論文嗎？">刪除</button>
      </span>
    </div>
    ${field('論文標題', textarea('title', p.title, { rows: 2, required: true, maxlength: 500 }))}
    ${field('作者', input('authors', p.authors, { maxlength: 500 }))}
    ${pdfControl('PDF 路徑', 'pdf', p.pdf, filesOn, 'pdf_file')}
    <div><button class="btn btn-primary" type="submit">儲存這篇論文</button></div>
  </form>`;
}

// ---- ordered lists (board / topics / downloads)

export function orderedList({ base, rows, columns, addTitle, intro }) {
  const controls = (row, i) => html`<span class="row-actions">
    <button class="btn btn-small" type="submit" formaction="${base}/${row.id}/move" name="dir" value="up" formnovalidate ${attrs({ disabled: i === 0 })} title="上移">↑</button>
    <button class="btn btn-small" type="submit" formaction="${base}/${row.id}/move" name="dir" value="down" formnovalidate ${attrs({ disabled: i === rows.length - 1 })} title="下移">↓</button>
    <button class="btn btn-small btn-danger" type="submit" formaction="${base}/${row.id}/delete" formnovalidate data-confirm="確定要刪除嗎？此動作無法復原。">刪除</button>
  </span>`;
  const controlFor = (c, value) =>
    c.kind === 'multiline' ? textarea(c.name, value, { rows: c.rows ?? 6, required: c.required !== false, maxlength: c.max }) : input(c.name, value, { required: c.required !== false, maxlength: c.max });
  return html`
    ${intro ? html`<p class="muted">${intro}</p>` : ''}
    ${rows.map(
      (row, i) => html`<form method="post" action="${base}/${row.id}" class="card stack">
        <div class="paper-head"><span class="paper-no">${String(i + 1).padStart(2, '0')}</span>${controls(row, i)}</div>
        ${columns.map((c) => field(c.label, controlFor(c, row[c.name]), c.help))}
        <div><button class="btn btn-primary" type="submit">儲存</button></div>
      </form>`,
    )}
    <form method="post" action="${base}" class="card stack">
      <h2>${addTitle}</h2>
      ${columns.map((c) => field(c.label, controlFor(c, ''), c.help))}
      <div><button class="btn btn-primary" type="submit">新增</button></div>
    </form>`;
}

// ---- R2 usage & uploaded files

export function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
const count = (n) => Number(n).toLocaleString('en-US');

function meter(title, used, cap, free, fmt) {
  const percent = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 100;
  const [tone, text] = used >= cap ? ['blocked', '已達上限，暫停中'] : percent >= 70 ? ['warn', '接近上限'] : ['ok', '正常'];
  return html`<div class="meter">
    <div class="meter-head"><strong>${title}</strong><span class="badge badge-${tone}">${text}</span></div>
    <progress class="meter-${tone}" max="100" value="${percent}">${percent}%</progress>
    <div class="muted">${fmt(used)} / 站內上限 ${fmt(cap)}（Cloudflare 免費額度 ${fmt(free)}）</div>
  </div>`;
}

export function meters(usage) {
  return html`<div class="meters">
    ${meter('儲存空間', usage.storageBytes, usage.caps.storageBytes, 10 * 1024 ** 3, formatBytes)}
    ${meter('本月讀取次數（Class B）', usage.classB, usage.caps.classB, 10_000_000, count)}
    ${meter('本月寫入次數（Class A）', usage.classA, usage.caps.classA, 1_000_000, count)}
  </div>`;
}

export function storagePage({ usage, files, capFields }) {
  return html`
    <section class="card">
      <h2>R2 用量（${usage.month}，UTC）</h2>
      ${meters(usage)}
      <p class="muted">R2 只對「儲存空間」與「操作次數」計費（流量免費）。系統自行統計用量，達到上限就會暫停讀取／上傳，避免超出 Cloudflare 的免費額度。
      邊緣快取命中的下載不會讀取 R2，也不計次。此處數字為站內統計（可能略低於實際），正式數字請看 ${raw('<a href="https://dash.cloudflare.com/?to=/:account/r2/overview" target="_blank" rel="noopener">Cloudflare R2 後台 ↗</a>')}。</p>
    </section>
    <section class="card">
      <h2>用量上限</h2>
      <p class="muted">上限不可高於免費額度。預設為免費額度的 50%，保留安全餘裕。設為 0 代表完全暫停。</p>
      <form method="post" action="/admin/storage/limits" class="grid">
        ${capFields.map((f) => field(f.label, input(f.name, f.value, { type: 'number', min: 0, max: f.free, required: true }), `最大 ${count(f.free)}`))}
        <div class="span-2 actions">
          <button class="btn btn-primary" type="submit">儲存上限</button>
          <button class="btn" type="submit" name="reset" value="1" formnovalidate>還原預設值</button>
        </div>
      </form>
    </section>
    <section class="card">
      <h2>已上傳的檔案（${files.length} 個）</h2>
      ${
        files.length
          ? html`<table class="table">
        <thead><tr><th>檔案</th><th>大小</th><th>上傳時間</th></tr></thead>
        <tbody>${files.map((f) => html`<tr><td><a href="/volume/${encodeURI(f.path)}" target="_blank" rel="noopener">${f.path}</a></td><td class="nowrap">${formatBytes(f.size)}</td><td class="nowrap">${formatTime(f.created_at)}</td></tr>`)}</tbody>
      </table>`
          : html`<p class="muted">還沒有透過後台上傳的檔案。網站內附的 PDF 不在 R2，不佔用量。</p>`
      }
    </section>`;
}

// ---- settings

export function settingsPage({ settings }) {
  return html`
    <p class="muted">這裡可以修改前台各處的文字。圖片、版面與樣式不會改變。</p>
    <form method="post" action="/admin/settings" class="stack">
      ${SETTING_GROUPS.map(
        (g) => html`<section class="card stack">
          <h2>${g.title}</h2>
          ${SETTING_FIELDS.filter((f) => f.group === g.id).map((f) => {
            const control =
              f.kind === 'textarea'
                ? textarea(f.key, settings[f.key], { rows: f.rows ?? 4, maxlength: f.max })
                : input(f.key, settings[f.key], { type: f.kind === 'email' ? 'email' : f.kind === 'url' ? 'url' : 'text', maxlength: f.max ?? 300, required: true });
            return field(f.label, control, f.help);
          })}
        </section>`,
      )}
      <div class="sticky-save"><button class="btn btn-primary" type="submit">儲存所有設定</button></div>
    </form>`;
}

// ---- users

export function usersPage({ users, me }) {
  return html`
    <section class="card">
      <h2>管理員帳號</h2>
      <table class="table">
        <thead><tr><th>帳號</th><th>建立時間</th><th></th></tr></thead>
        <tbody>
          ${users.map(
            (u) => html`<tr>
            <td><strong>${u.username}</strong> ${u.id === me.id ? html`<span class="badge">目前登入</span>` : ''}</td>
            <td>${formatTime(u.created_at)}</td>
            <td class="right">${
              u.id === me.id
                ? ''
                : html`<form method="post" action="/admin/users/${u.id}/delete"><button class="btn btn-small btn-danger" type="submit" data-confirm="確定要刪除管理員 ${u.username} 嗎？">刪除</button></form>`
            }</td>
          </tr>`,
          )}
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>新增管理員</h2>
      <form method="post" action="/admin/users" class="grid">
        ${field('帳號', input('username', '', { required: true, maxlength: 64, autocomplete: 'off' }), '可直接使用 Email；英數字與 . _ @ + -，3–64 字元')}
        <div></div>
        ${field('密碼', input('password', '', { type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' }), '至少 10 個字元')}
        ${field('再輸入一次密碼', input('confirm', '', { type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' }))}
        <div class="span-2"><button class="btn btn-primary" type="submit">新增管理員</button></div>
      </form>
    </section>
    <section class="card">
      <h2>變更我的密碼</h2>
      <form method="post" action="/admin/users/password" class="grid">
        <div class="span-2">${field('目前密碼', input('current', '', { type: 'password', required: true, maxlength: 200, autocomplete: 'current-password' }))}</div>
        ${field('新密碼', input('password', '', { type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' }), '至少 10 個字元')}
        ${field('再輸入一次新密碼', input('confirm', '', { type: 'password', required: true, minlength: 10, maxlength: 200, autocomplete: 'new-password' }))}
        <div class="span-2"><button class="btn btn-primary" type="submit">變更密碼</button></div>
      </form>
    </section>`;
}
