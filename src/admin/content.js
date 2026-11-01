// Content management: issues, papers, ordered lists (board / topics / downloads) and site settings.

import { deleteStored, filesEnabled, putPdf } from '../files.js';
import { SETTING_FIELDS, settingsFromRows } from '../settings.js';
import * as v from '../validation.js';
import { ValidationError } from '../validation.js';
import { audit, done, isUniqueViolation, render, str } from './http.js';
import { issueEdit, issuesList, orderedList, settingsPage } from './views.js';

const MAX_UPLOAD = 15 * 1024 * 1024;
const label = (issue) => `Vol.${issue.volume}, No.${issue.number}`;

// ---- ordering helpers

async function moveRow(db, table, scope, id, dir) {
  const row = await db.prepare(`SELECT id${scope ? `, ${scope}` : ''} FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new ValidationError('找不到要移動的項目');
  const query = db.prepare(`SELECT id FROM ${table} ${scope ? `WHERE ${scope} = ?` : ''} ORDER BY sort, id`);
  const { results } = await (scope ? query.bind(row[scope]) : query).all();
  const ids = results.map((r) => r.id);
  const from = ids.indexOf(id);
  const to = dir === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await db.batch(ids.map((rowId, i) => db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).bind(i + 1, rowId)));
}

const direction = async (ctx) => {
  const dir = str(await ctx.form(), 'dir');
  if (dir !== 'up' && dir !== 'down') throw new ValidationError('無效的移動方向');
  return dir;
};

// ---- PDF uploads (only when an R2 bucket is bound as FILES)

async function uploadedPdf(ctx, form, field, folder) {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) return null;
  if (!filesEnabled(ctx.env)) throw new ValidationError('檔案上傳尚未啟用，請改填 PDF 路徑');
  if (file.size > MAX_UPLOAD) throw new ValidationError('PDF 檔案不可超過 15 MB');
  const data = await file.arrayBuffer();
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new ValidationError(`「${file.name}」不是有效的 PDF 檔案`);
  return putPdf(ctx.env, folder, file.name, data);
}

// ---- issues

export async function issuesGet(ctx) {
  const { results } = await ctx.env.DB.prepare(
    `SELECT i.*, (SELECT COUNT(*) FROM papers p WHERE p.issue_id = i.id) AS papers
     FROM issues i ORDER BY volume DESC, number DESC`,
  ).all();
  const latest = results[0] ?? { issn: '', description: '' };
  return render(ctx, '期別與論文', '/admin/issues', issuesList({ issues: results, defaults: latest }));
}

function issueFields(form) {
  return {
    volume: v.int(str(form, 'volume'), { label: '卷' }),
    number: v.int(str(form, 'number'), { label: '期' }),
    pub_date: v.pubDate(str(form, 'pub_date')),
    description: v.text(str(form, 'description'), { label: '期別說明', max: 300 }),
    issn: v.text(str(form, 'issn'), { label: 'ISSN', max: 80 }),
  };
}

export async function issuesCreate(ctx) {
  const f = issueFields(await ctx.form());
  let result;
  try {
    result = await ctx.env.DB.prepare('INSERT INTO issues (volume, number, pub_date, description, issn) VALUES (?, ?, ?, ?, ?)')
      .bind(f.volume, f.number, f.pub_date, f.description, f.issn)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`${label(f)} 已經存在`);
    throw err;
  }
  await audit(ctx, '新增期別', label(f));
  return done(ctx, `/admin/issues/${result.meta.last_row_id}`, `已建立 ${label(f)}，接著可以新增論文`);
}

export async function issueGet(ctx, id) {
  const db = ctx.env.DB;
  const [issue, papers] = await db.batch([
    db.prepare('SELECT * FROM issues WHERE id = ?').bind(id),
    db.prepare('SELECT id, title, authors, pdf FROM papers WHERE issue_id = ? ORDER BY sort, id').bind(id),
  ]);
  if (!issue.results[0]) throw new ValidationError('找不到這一期');
  return render(ctx, label(issue.results[0]), '/admin/issues', issueEdit({ issue: issue.results[0], papers: papers.results, filesOn: filesEnabled(ctx.env) }));
}

export async function issueUpdate(ctx, id) {
  const form = await ctx.form();
  const old = await ctx.env.DB.prepare('SELECT * FROM issues WHERE id = ?').bind(id).first();
  if (!old) throw new ValidationError('找不到這一期');
  const f = issueFields(form);
  const slug = `${f.volume}-${f.number}`;
  const cover = (await uploadedPdf(ctx, form, 'cover_file', slug)) ?? v.pdfPath(str(form, 'cover_pdf'), { label: '封面 PDF 路徑' });
  const contents = (await uploadedPdf(ctx, form, 'contents_file', slug)) ?? v.pdfPath(str(form, 'contents_pdf'), { label: '目錄 PDF 路徑' });
  const published = str(form, 'published') === '0' ? 0 : 1;
  try {
    await ctx.env.DB.prepare(
      `UPDATE issues SET volume = ?, number = ?, pub_date = ?, description = ?, issn = ?, cover_pdf = ?, contents_pdf = ?, published = ? WHERE id = ?`,
    )
      .bind(f.volume, f.number, f.pub_date, f.description, f.issn, cover, contents, published, id)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError(`${label(f)} 已經存在`);
    throw err;
  }
  if (old.cover_pdf && old.cover_pdf !== cover) await deleteStored(ctx.env, old.cover_pdf);
  if (old.contents_pdf && old.contents_pdf !== contents) await deleteStored(ctx.env, old.contents_pdf);
  await audit(ctx, '修改期別', label(f));
  return done(ctx, `/admin/issues/${id}`, `已儲存 ${label(f)}`);
}

export async function issueDelete(ctx, id) {
  const db = ctx.env.DB;
  const issue = await db.prepare('SELECT * FROM issues WHERE id = ?').bind(id).first();
  if (!issue) throw new ValidationError('找不到這一期');
  const { results: papers } = await db.prepare('SELECT pdf FROM papers WHERE issue_id = ?').bind(id).all();
  await db.prepare('DELETE FROM issues WHERE id = ?').bind(id).run(); // papers go with it (ON DELETE CASCADE)
  for (const path of [issue.cover_pdf, issue.contents_pdf, ...papers.map((p) => p.pdf)]) await deleteStored(ctx.env, path);
  await audit(ctx, '刪除期別', `${label(issue)}（含 ${papers.length} 篇論文）`);
  return done(ctx, '/admin/issues', `已刪除 ${label(issue)}`);
}

// ---- papers

function paperFields(form) {
  return {
    title: v.text(str(form, 'title'), { label: '論文標題', max: 500 }),
    authors: v.text(str(form, 'authors'), { label: '作者', max: 500, required: false }),
  };
}

export async function paperCreate(ctx, issueId) {
  const form = await ctx.form();
  const issue = await ctx.env.DB.prepare('SELECT volume, number FROM issues WHERE id = ?').bind(issueId).first();
  if (!issue) throw new ValidationError('找不到這一期');
  const f = paperFields(form);
  const pdf = (await uploadedPdf(ctx, form, 'pdf_file', `${issue.volume}-${issue.number}`)) ?? v.pdfPath(str(form, 'pdf'));
  await ctx.env.DB.prepare(
    `INSERT INTO papers (issue_id, sort, title, authors, pdf)
     VALUES (?1, (SELECT COALESCE(MAX(sort), 0) + 1 FROM papers WHERE issue_id = ?1), ?2, ?3, ?4)`,
  )
    .bind(issueId, f.title, f.authors, pdf)
    .run();
  await audit(ctx, '新增論文', `${label(issue)}：${f.title}`);
  return done(ctx, `/admin/issues/${issueId}`, '已新增論文');
}

export async function paperUpdate(ctx, id) {
  const form = await ctx.form();
  const old = await ctx.env.DB.prepare('SELECT p.*, i.volume, i.number FROM papers p JOIN issues i ON i.id = p.issue_id WHERE p.id = ?').bind(id).first();
  if (!old) throw new ValidationError('找不到這篇論文');
  const f = paperFields(form);
  const pdf = (await uploadedPdf(ctx, form, 'pdf_file', `${old.volume}-${old.number}`)) ?? v.pdfPath(str(form, 'pdf'));
  await ctx.env.DB.prepare('UPDATE papers SET title = ?, authors = ?, pdf = ? WHERE id = ?').bind(f.title, f.authors, pdf, id).run();
  if (old.pdf && old.pdf !== pdf) await deleteStored(ctx.env, old.pdf);
  await audit(ctx, '修改論文', `${label(old)}：${f.title}`);
  return done(ctx, `/admin/issues/${old.issue_id}`, '已儲存論文');
}

export async function paperMove(ctx, id) {
  const dir = await direction(ctx);
  const paper = await ctx.env.DB.prepare('SELECT issue_id FROM papers WHERE id = ?').bind(id).first();
  if (!paper) throw new ValidationError('找不到這篇論文');
  await moveRow(ctx.env.DB, 'papers', 'issue_id', id, dir);
  return done(ctx, `/admin/issues/${paper.issue_id}`, '已調整順序');
}

export async function paperDelete(ctx, id) {
  const old = await ctx.env.DB.prepare('SELECT p.*, i.volume, i.number FROM papers p JOIN issues i ON i.id = p.issue_id WHERE p.id = ?').bind(id).first();
  if (!old) throw new ValidationError('找不到這篇論文');
  await ctx.env.DB.prepare('DELETE FROM papers WHERE id = ?').bind(id).run();
  await deleteStored(ctx.env, old.pdf);
  await audit(ctx, '刪除論文', `${label(old)}：${old.title}`);
  return done(ctx, `/admin/issues/${old.issue_id}`, '已刪除論文');
}

// ---- ordered lists: editorial board, aims & scopes, downloads

const VALIDATORS = {
  text: (value, c) => v.text(value, { label: c.label, max: c.max }),
  multiline: (value, c) => v.text(value, { label: c.label, max: c.max, multiline: true }),
  download: (value, c) => v.downloadPath(value, { label: c.label }),
};

function orderedCrud({ base, table, title, nav, columns, addTitle, intro, noun }) {
  const names = columns.map((c) => c.name);
  const values = async (ctx) => {
    const form = await ctx.form();
    return columns.map((c) => VALIDATORS[c.kind](str(form, c.name), c));
  };
  const summary = (vals) => String(vals[0]);

  return [
    ['GET', new RegExp(`^${base}$`), async (ctx) => {
      const { results } = await ctx.env.DB.prepare(`SELECT id, ${names.join(', ')} FROM ${table} ORDER BY sort, id`).all();
      return render(ctx, title, nav, orderedList({ base, rows: results, columns, addTitle, intro }));
    }],
    ['POST', new RegExp(`^${base}$`), async (ctx) => {
      const vals = await values(ctx);
      await ctx.env.DB.prepare(
        `INSERT INTO ${table} (sort, ${names.join(', ')}) VALUES ((SELECT COALESCE(MAX(sort), 0) + 1 FROM ${table}), ${names.map(() => '?').join(', ')})`,
      )
        .bind(...vals)
        .run();
      await audit(ctx, `新增${noun}`, summary(vals));
      return done(ctx, base, `已新增${noun}`);
    }],
    ['POST', new RegExp(`^${base}/(\\d+)$`), async (ctx, id) => {
      const vals = await values(ctx);
      const res = await ctx.env.DB.prepare(`UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`)
        .bind(...vals, id)
        .run();
      if (!res.meta.changes) throw new ValidationError(`找不到這個${noun}`);
      await audit(ctx, `修改${noun}`, summary(vals));
      return done(ctx, base, `已儲存${noun}`);
    }],
    ['POST', new RegExp(`^${base}/(\\d+)/move$`), async (ctx, id) => {
      await moveRow(ctx.env.DB, table, null, id, await direction(ctx));
      return done(ctx, base, '已調整順序');
    }],
    ['POST', new RegExp(`^${base}/(\\d+)/delete$`), async (ctx, id) => {
      const row = await ctx.env.DB.prepare(`SELECT ${names[0]} AS name FROM ${table} WHERE id = ?`).bind(id).first();
      if (!row) throw new ValidationError(`找不到這個${noun}`);
      await ctx.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      await audit(ctx, `刪除${noun}`, row.name);
      return done(ctx, base, `已刪除${noun}`);
    }],
  ];
}

export const boardRoutes = orderedCrud({
  base: '/admin/board',
  table: 'board_groups',
  title: '編輯委員會',
  nav: '/admin/board',
  noun: '委員群組',
  addTitle: '新增委員群組',
  intro: '每個群組的成員一行一位（姓名、單位），前台依輸入順序顯示。群組的先後順序可用 ↑ ↓ 調整。',
  columns: [
    { name: 'title', label: '群組名稱', kind: 'text', max: 120, help: '例如 Editor-in-Chief' },
    { name: 'members', label: '成員（每行一位）', kind: 'multiline', max: 6000, rows: 8 },
  ],
});

export const topicRoutes = orderedCrud({
  base: '/admin/topics',
  table: 'topics',
  title: '宗旨與範圍',
  nav: '/admin/topics',
  noun: '主題',
  addTitle: '新增主題',
  intro: '前台「Aims & Scopes」區塊的主題卡片。每個主題的項目一行一項。',
  columns: [
    { name: 'title', label: '主題名稱', kind: 'text', max: 120, help: '例如 Topic 1 - Computer' },
    { name: 'items', label: '項目（每行一項）', kind: 'multiline', max: 4000, rows: 6 },
  ],
});

export const downloadRoutes = orderedCrud({
  base: '/admin/downloads',
  table: 'downloads',
  title: '下載檔案',
  nav: '/admin/downloads',
  noun: '下載檔案',
  addTitle: '新增下載檔案',
  intro: '前台「Author Guide」旁的下載清單。路徑請填網站內已存在的檔案（downloads/檔名），或完整網址。新的範本檔需先放進專案的 public/downloads 資料夾並部署。',
  columns: [
    { name: 'label', label: '顯示名稱', kind: 'text', max: 120 },
    { name: 'href', label: '檔案路徑或網址', kind: 'download', max: 300, help: '例如 downloads/IJ3C_template.doc' },
  ],
});

// ---- site settings

export async function settingsGet(ctx) {
  const { results } = await ctx.env.DB.prepare('SELECT key, value FROM settings').all();
  return render(ctx, '網站設定', '/admin/settings', settingsPage({ settings: settingsFromRows(results) }));
}

function validateSetting(field, value) {
  const opts = { label: field.label, max: field.max };
  let out;
  switch (field.kind) {
    case 'email':
      out = v.email(value, { label: field.label });
      break;
    case 'url':
      out = v.webUrl(value, { label: field.label });
      break;
    case 'image':
      out = v.imagePath(value, { label: field.label });
      break;
    case 'textarea':
      out = v.text(value, { ...opts, multiline: true });
      break;
    default:
      out = v.text(value, opts);
  }
  if (field.mustInclude && !out.includes(field.mustInclude)) throw new ValidationError(`${field.label}必須包含 ${field.mustInclude}`);
  return out;
}

export async function settingsPost(ctx) {
  const form = await ctx.form();
  const { results } = await ctx.env.DB.prepare('SELECT key, value FROM settings').all();
  const current = settingsFromRows(results);
  const changed = [];
  const statements = [];
  for (const field of SETTING_FIELDS) {
    const value = validateSetting(field, str(form, field.key));
    if (value === current[field.key]) continue;
    changed.push(field.label);
    statements.push(
      ctx.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(field.key, value),
    );
  }
  if (!statements.length) return done(ctx, '/admin/settings', '沒有任何變更');
  await ctx.env.DB.batch(statements);
  await audit(ctx, '修改網站設定', changed.join('、'));
  return done(ctx, '/admin/settings', `已儲存設定（${changed.length} 項變更）`);
}
