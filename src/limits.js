// R2 usage guard.
//
// R2 only charges for storage and for operations (egress is free). The site therefore keeps its own monthly tally and
// refuses R2 reads/uploads once a cap is reached, so usage can never run past Cloudflare's free allowance by accident.
//  - Caps default to half of the free allowance and can be lowered (never raised past the allowance) on /admin/storage.
//  - Reads are counted when an R2 object is actually fetched. Cache hits at the edge cost nothing and are not counted.
//  - The tally is a lower bound (a few reads can be lost when a Worker instance is recycled); the 50% safety margin
//    covers that. Cloudflare's dashboard (R2 -> Overview) remains the authoritative figure.

import { ValidationError } from './validation.js';

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Monthly free allowance of the R2 Standard plan. Caps may never exceed this. */
export const FREE_TIER = { storageBytes: 10 * GB, classA: 1_000_000, classB: 10_000_000 };
export const DEFAULT_CAPS = { storageBytes: FREE_TIER.storageBytes / 2, classA: FREE_TIER.classA / 2, classB: FREE_TIER.classB / 2 };

const CAP_KEYS = { storageBytes: 'r2_cap_storage_bytes', classA: 'r2_cap_class_a', classB: 'r2_cap_class_b' };

export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

function capsFromRows(rows) {
  const stored = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  const caps = {};
  for (const name of Object.keys(CAP_KEYS)) {
    const v = stored[CAP_KEYS[name]];
    caps[name] = Number.isFinite(v) && v >= 0 ? Math.min(v, FREE_TIER[name]) : DEFAULT_CAPS[name];
  }
  return caps;
}

// Reads are tallied in memory and written to D1 in batches, so a burst of downloads does not become a burst of D1 writes.
const pending = { reads: 0, flushedAt: 0 };
const FLUSH_EVERY = 20;
const FLUSH_MS = 30_000;

/** Records one R2 read (Class B). */
export function noteRead(env, ctx) {
  pending.reads++;
  if (pending.reads < FLUSH_EVERY && Date.now() - pending.flushedAt < FLUSH_MS) return;
  const n = pending.reads;
  pending.reads = 0;
  pending.flushedAt = Date.now();
  ctx.waitUntil(
    env.DB.prepare('INSERT INTO r2_usage (month, class_b) VALUES (?1, ?2) ON CONFLICT(month) DO UPDATE SET class_b = class_b + ?2')
      .bind(monthKey(), n)
      .run()
      .catch((err) => console.error('r2 usage flush failed', err)),
  );
}

/** Current month's tally, stored size, and the effective caps. */
export async function usageSnapshot(env) {
  const [files, usage, settings] = await env.DB.batch([
    env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS n FROM stored_files'),
    env.DB.prepare('SELECT class_a, class_b FROM r2_usage WHERE month = ?').bind(monthKey()),
    env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'r2_cap_%'"),
  ]);
  const row = usage.results[0] ?? { class_a: 0, class_b: 0 };
  return {
    month: monthKey(),
    storageBytes: files.results[0].bytes,
    files: files.results[0].n,
    classA: row.class_a,
    classB: row.class_b + pending.reads,
    caps: capsFromRows(settings.results),
  };
}

export const readAllowed = (u) => u.classB < u.caps.classB;

/** Throws a ValidationError when an upload of `size` bytes would pass a cap. */
export async function assertCanUpload(env, size) {
  const u = await usageSnapshot(env);
  if (u.classA >= u.caps.classA) throw new ValidationError('本月 R2 寫入次數已達上限，為避免超出免費額度已暫停上傳（下個月自動恢復，或到「檔案與用量」調整上限）');
  if (u.storageBytes + size > u.caps.storageBytes) throw new ValidationError('R2 儲存空間已達上限，為避免超出免費額度已暫停上傳（請先刪除不需要的檔案，或到「檔案與用量」調整上限）');
}

export const noteWrite = (env) =>
  env.DB.prepare('INSERT INTO r2_usage (month, class_a) VALUES (?1, 1) ON CONFLICT(month) DO UPDATE SET class_a = class_a + 1').bind(monthKey());

export const CAP_FIELDS = [
  { name: 'storageBytes', key: CAP_KEYS.storageBytes, label: '儲存空間上限（MB）', unit: MB, free: FREE_TIER.storageBytes / MB },
  { name: 'classA', key: CAP_KEYS.classA, label: '每月寫入次數上限（Class A）', unit: 1, free: FREE_TIER.classA },
  { name: 'classB', key: CAP_KEYS.classB, label: '每月讀取次數上限（Class B）', unit: 1, free: FREE_TIER.classB },
];
