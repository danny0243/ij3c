// /admin back office: routing, session check and CSRF guard.

import { currentUser, isSameOrigin } from '../auth.js';
import { ValidationError } from '../validation.js';
import { auditGet, dashboardGet, loginGet, loginPost, logout, notFoundPage, usersCreate, usersDelete, usersGet, usersPassword } from './accounts.js';
import {
  boardRoutes,
  downloadRoutes,
  issueDelete,
  issueGet,
  issueUpdate,
  issuesCreate,
  issuesGet,
  paperCreate,
  paperDelete,
  paperMove,
  paperUpdate,
  settingsGet,
  settingsPost,
  topicRoutes,
} from './content.js';
import { backPath, flashCookie, plain, readFlash, respond, seeOther } from './http.js';
import { storageGet, storageLimitsPost } from './storage.js';

const ROUTES = [
  ['GET', /^\/admin$/, dashboardGet],
  ['POST', /^\/admin\/logout$/, logout],

  ['GET', /^\/admin\/issues$/, issuesGet],
  ['POST', /^\/admin\/issues$/, issuesCreate],
  ['GET', /^\/admin\/issues\/(\d+)$/, issueGet],
  ['POST', /^\/admin\/issues\/(\d+)$/, issueUpdate],
  ['POST', /^\/admin\/issues\/(\d+)\/delete$/, issueDelete],
  ['POST', /^\/admin\/issues\/(\d+)\/papers$/, paperCreate],
  ['POST', /^\/admin\/papers\/(\d+)$/, paperUpdate],
  ['POST', /^\/admin\/papers\/(\d+)\/move$/, paperMove],
  ['POST', /^\/admin\/papers\/(\d+)\/delete$/, paperDelete],

  ...boardRoutes,
  ...topicRoutes,
  ...downloadRoutes,

  ['GET', /^\/admin\/storage$/, storageGet],
  ['POST', /^\/admin\/storage\/limits$/, storageLimitsPost],

  ['GET', /^\/admin\/settings$/, settingsGet],
  ['POST', /^\/admin\/settings$/, settingsPost],

  ['GET', /^\/admin\/users$/, usersGet],
  ['POST', /^\/admin\/users$/, usersCreate],
  ['POST', /^\/admin\/users\/password$/, usersPassword],
  ['POST', /^\/admin\/users\/(\d+)\/delete$/, usersDelete],

  ['GET', /^\/admin\/audit$/, auditGet],
];

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

  if (request.method !== 'GET' && request.method !== 'POST') {
    return respond('Method not allowed', { status: 405, headers: { allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (request.method === 'POST' && !isSameOrigin(request)) return plain('Forbidden', 403);

  let formPromise;
  const ctx = {
    request,
    env,
    url,
    secure: url.protocol === 'https:',
    user: null,
    flash: readFlash(request),
    form: () => (formPromise ??= request.formData()),
  };

  try {
    if (path === '/admin/login') return request.method === 'POST' ? await loginPost(ctx) : await loginGet(await withUser(ctx));

    await withUser(ctx);
    if (!ctx.user) return seeOther('/admin/login');

    for (const [method, pattern, handler] of ROUTES) {
      if (method !== request.method) continue;
      const match = pattern.exec(path);
      if (match) return await handler(ctx, ...match.slice(1).map(Number));
    }
    return notFoundPage(ctx);
  } catch (err) {
    if (err instanceof ValidationError) return seeOther(backPath(ctx), [flashCookie('error', err.message, ctx.secure)]);
    console.error('admin error', request.method, path, err?.stack ?? err);
    return plain('發生內部錯誤，請稍後再試。', 500);
  }
}

async function withUser(ctx) {
  ctx.user = await currentUser(ctx.request, ctx.env);
  return ctx;
}
