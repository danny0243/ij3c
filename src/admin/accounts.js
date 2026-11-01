// Login / logout, dashboard, admin accounts and the activity log.

import {
  clearFailures,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  isThrottled,
  recordFailure,
  sessionCookie,
  verifyDummy,
  verifyPassword,
} from '../auth.js';
import { filesEnabled } from '../files.js';
import { usageSnapshot } from '../limits.js';
import { html } from '../util.js';
import * as v from '../validation.js';
import { ValidationError } from '../validation.js';
import { audit, done, isUniqueViolation, plain, render, respond, seeOther, str } from './http.js';
import { auditTable, dashboard, loginPage, usersPage } from './views.js';

const SESSION_HOURS = 12;

export function loginGet(ctx) {
  if (ctx.user) return seeOther('/admin');
  return respond(loginPage());
}

export async function loginPost(ctx) {
  const form = await ctx.form();
  const username = str(form, 'username').trim().slice(0, 64);
  const password = str(form, 'password').slice(0, 200);
  const ip = ctx.request.headers.get('cf-connecting-ip') ?? '127.0.0.1';
  const fail = (error, status = 401) => respond(loginPage({ error, username }), { status });

  if (!username || !password) return fail('請輸入帳號與密碼', 400);
  if (await isThrottled(ctx.env, ip, username)) return fail('嘗試次數過多，請 15 分鐘後再試', 429);

  const user = await ctx.env.DB.prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?').bind(username).first();
  const ok = user ? await verifyPassword(password, user.password_hash) : await verifyDummy(password);
  if (!ok) {
    await recordFailure(ctx.env, ip, username);
    return fail('帳號或密碼錯誤');
  }

  await clearFailures(ctx.env, ip);
  const { token, expires } = await createSession(ctx.env, user.id);
  ctx.user = { id: user.id, username: user.username };
  await audit(ctx, '登入');
  return seeOther('/admin', [sessionCookie(token, expires, ctx.secure)]);
}

export async function logout(ctx) {
  await destroySession(ctx.env, ctx.user.sessionId);
  return seeOther('/admin/login', [clearSessionCookie(ctx.secure)]);
}

export async function dashboardGet(ctx) {
  const db = ctx.env.DB;
  const [issues, papers, groups, users, recent] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM issues'),
    db.prepare('SELECT COUNT(*) AS n FROM papers'),
    db.prepare('SELECT COUNT(*) AS n FROM board_groups'),
    db.prepare('SELECT COUNT(*) AS n FROM admin_users'),
    db.prepare('SELECT created_at, username, action, detail FROM audit_log ORDER BY id DESC LIMIT 8'),
  ]);
  const counts = { issues: issues.results[0].n, papers: papers.results[0].n, groups: groups.results[0].n, users: users.results[0].n };
  const filesOn = filesEnabled(ctx.env);
  const usage = filesOn ? await usageSnapshot(ctx.env) : null;
  return render(ctx, '總覽', '/admin', dashboard({ counts, recent: recent.results, filesOn, sessionHours: SESSION_HOURS, usage }));
}

export async function auditGet(ctx) {
  const { results } = await ctx.env.DB.prepare('SELECT created_at, username, action, detail FROM audit_log ORDER BY id DESC LIMIT 200').all();
  return render(ctx, '操作紀錄', '/admin/audit', auditTable(results));
}

// ---- admin accounts

export async function usersGet(ctx) {
  const { results } = await ctx.env.DB.prepare('SELECT id, username, created_at FROM admin_users ORDER BY id').all();
  return render(ctx, '管理員', '/admin/users', usersPage({ users: results, me: ctx.user }));
}

export async function usersCreate(ctx) {
  const form = await ctx.form();
  const username = v.username(str(form, 'username'));
  const password = v.password(str(form, 'password'));
  if (password !== str(form, 'confirm')) throw new ValidationError('兩次輸入的密碼不一致');
  try {
    await ctx.env.DB.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').bind(username, await hashPassword(password)).run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError('這個帳號已經存在');
    throw err;
  }
  await audit(ctx, '新增管理員', username);
  return done(ctx, '/admin/users', `已新增管理員 ${username}`);
}

export async function usersDelete(ctx, id) {
  if (id === ctx.user.id) throw new ValidationError('不能刪除目前登入的帳號');
  const target = await ctx.env.DB.prepare('SELECT username FROM admin_users WHERE id = ?').bind(id).first();
  if (!target) throw new ValidationError('找不到這個管理員');
  await ctx.env.DB.prepare('DELETE FROM admin_users WHERE id = ?').bind(id).run();
  await audit(ctx, '刪除管理員', target.username);
  return done(ctx, '/admin/users', `已刪除管理員 ${target.username}`);
}

export async function usersPassword(ctx) {
  const form = await ctx.form();
  const row = await ctx.env.DB.prepare('SELECT password_hash FROM admin_users WHERE id = ?').bind(ctx.user.id).first();
  if (!row || !(await verifyPassword(str(form, 'current').slice(0, 200), row.password_hash))) throw new ValidationError('目前密碼不正確');
  const password = v.password(str(form, 'password'));
  if (password !== str(form, 'confirm')) throw new ValidationError('兩次輸入的新密碼不一致');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), ctx.user.id),
    // sign out every other session of this account
    ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(ctx.user.id, ctx.user.sessionId),
  ]);
  await audit(ctx, '變更密碼');
  return done(ctx, '/admin/users', '密碼已更新，其他裝置上的登入已失效');
}

export const notFoundPage = (ctx) => (ctx.user ? render(ctx, '找不到頁面', '', html`<p>這個頁面不存在。</p>`, 404) : plain('Not found', 404));
