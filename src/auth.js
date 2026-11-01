// Back-office authentication.
//  - Passwords: PBKDF2-SHA256 (100k iterations, the maximum Workers' WebCrypto allows) with a random salt.
//  - Sessions: random 256-bit cookie token; only its SHA-256 is stored in D1, so a database leak does not leak sessions.
//  - Login attempts are throttled per IP and per username.

import { sha256Hex } from './util.js';

export const ITERATIONS = 100_000;
const SESSION_HOURS = 12;
const COOKIE = 'ij3c_admin';
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_IP = 8;
const MAX_FAILURES_PER_USER = 30;

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash) return false;
  const actual = await derive(password, fromB64(salt), Number(iterations));
  return timingSafeEqual(actual, fromB64(hash));
}

let dummyHash;
/** Burns the same CPU time for unknown usernames so response time does not reveal which accounts exist. */
export async function verifyDummy(password) {
  dummyHash ??= await hashPassword(crypto.randomUUID());
  await verifyPassword(password, dummyHash);
  return false;
}

// ---- sessions

const cookieAttrs = (secure) => `Path=/admin; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

export async function createSession(env, userId) {
  const token = toB64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now.toISOString()),
    env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, expires.toISOString()),
  ]);
  return { token, expires };
}

export const sessionCookie = (token, expires, secure) => `${COOKIE}=${token}; ${cookieAttrs(secure)}; Expires=${expires.toUTCString()}`;
export const clearSessionCookie = (secure) => `${COOKIE}=; ${cookieAttrs(secure)}; Max-Age=0`;

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

export async function currentUser(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username FROM sessions s JOIN admin_users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, new Date().toISOString())
    .first();
  return row ? { id: row.id, username: row.username, sessionId: id } : null;
}

export const destroySession = (env, sessionId) => env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();

// ---- throttling

const windowStart = () => new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

export async function isThrottled(env, ip, username) {
  const [byIp, byUser] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND created_at > ?').bind(`ip:${ip}`, windowStart()),
    env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND created_at > ?').bind(`user:${username.toLowerCase()}`, windowStart()),
  ]);
  return byIp.results[0].n >= MAX_FAILURES_PER_IP || byUser.results[0].n >= MAX_FAILURES_PER_USER;
}

export async function recordFailure(env, ip, username) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(`ip:${ip}`),
    env.DB.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(`user:${username.toLowerCase()}`),
    env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(new Date(Date.now() - 24 * 3600_000).toISOString()),
  ]);
}

export const clearFailures = (env, ip) => env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(`ip:${ip}`).run();

// ---- CSRF: state-changing requests must come from this site (the session cookie is also SameSite=Strict)

export function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
