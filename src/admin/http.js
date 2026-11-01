// Response helpers shared by the back-office handlers.

import { readCookie } from '../auth.js';
import { page } from './views.js';

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  // No inline scripts or styles anywhere in the admin, so this can stay strict.
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

export function respond(body, { status = 200, headers = {}, cookies = [] } = {}) {
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...headers });
  for (const cookie of cookies) h.append('set-cookie', cookie);
  return new Response(body, { status, headers: h });
}

export function plain(message, status) {
  return respond(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export function seeOther(location, cookies = []) {
  const h = new Headers({ location, ...SECURITY_HEADERS });
  for (const cookie of cookies) h.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers: h });
}

// One-shot flash message carried across the redirect after a form submit.
const flashAttrs = (secure) => `Path=/admin; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
export const flashCookie = (type, message, secure) => `ij3c_flash=${encodeURIComponent(JSON.stringify({ type, message }))}; ${flashAttrs(secure)}; Max-Age=60`;
export const clearFlashCookie = (secure) => `ij3c_flash=; ${flashAttrs(secure)}; Max-Age=0`;

export function readFlash(request) {
  const value = readCookie(request, 'ij3c_flash');
  if (!value) return null;
  try {
    const { type, message } = JSON.parse(decodeURIComponent(value));
    if ((type === 'ok' || type === 'error') && typeof message === 'string') return { type, message: message.slice(0, 300) };
  } catch {
    // ignore a malformed cookie
  }
  return null;
}

/** Where to send the user after a rejected form: the page they came from (same origin only). */
export function backPath(ctx) {
  try {
    const ref = new URL(ctx.request.headers.get('referer') ?? '', ctx.url);
    if (ref.origin === ctx.url.origin && ref.pathname.startsWith('/admin')) return ref.pathname + ref.search;
  } catch {
    // fall through
  }
  return '/admin';
}

export function render(ctx, title, active, body, status = 200) {
  return respond(page({ title, user: ctx.user, flash: ctx.flash, active }, body), {
    status,
    cookies: ctx.flash ? [clearFlashCookie(ctx.secure)] : [],
  });
}

export const done = (ctx, location, message) => seeOther(location, [flashCookie('ok', message, ctx.secure)]);

/** Reads a text field from a parsed form (files and missing fields read as ''). */
export const str = (form, name) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export const audit = (ctx, action, detail = '') =>
  ctx.env.DB.prepare('INSERT INTO audit_log (username, action, detail) VALUES (?, ?, ?)').bind(ctx.user.username, action, detail).run();

export const isUniqueViolation = (err) => /UNIQUE constraint failed/i.test(String(err?.message ?? err));
