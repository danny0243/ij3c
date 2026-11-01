// R2 usage page: current tally, adjustable caps (never above the free allowance) and the uploaded-file inventory.

import { filesEnabled } from '../files.js';
import { CAP_FIELDS, usageSnapshot } from '../limits.js';
import { html } from '../util.js';
import * as v from '../validation.js';
import { audit, done, render, str } from './http.js';
import { storagePage } from './views.js';

const TITLE = '檔案與用量';
const NAV = '/admin/storage';

export async function storageGet(ctx) {
  if (!filesEnabled(ctx.env)) {
    return render(ctx, TITLE, NAV, html`<section class="card"><h2>檔案上傳尚未啟用</h2><p class="muted">需要先啟用 Cloudflare R2，並在 wrangler.toml 綁定 R2 bucket（FILES）。</p></section>`);
  }
  const [usage, files] = await Promise.all([
    usageSnapshot(ctx.env),
    ctx.env.DB.prepare('SELECT path, size, created_at FROM stored_files ORDER BY created_at DESC, path LIMIT 300').all(),
  ]);
  const capFields = CAP_FIELDS.map((f) => ({ ...f, value: Math.round(usage.caps[f.name] / f.unit) }));
  return render(ctx, TITLE, NAV, storagePage({ usage, files: files.results, capFields }));
}

export async function storageLimitsPost(ctx) {
  const form = await ctx.form();
  const db = ctx.env.DB;
  if (str(form, 'reset')) {
    await db.prepare("DELETE FROM settings WHERE key LIKE 'r2_cap_%'").run();
    await audit(ctx, '還原 R2 用量上限', '預設值');
    return done(ctx, NAV, '已還原為預設上限');
  }
  const statements = [];
  const summary = [];
  for (const f of CAP_FIELDS) {
    const n = v.int(str(form, f.name), { label: f.label, min: 0, max: f.free });
    statements.push(
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(f.key, String(n * f.unit)),
    );
    summary.push(`${f.label} ${n}`);
  }
  await db.batch(statements);
  await audit(ctx, '調整 R2 用量上限', summary.join('；'));
  return done(ctx, NAV, '已儲存用量上限');
}
