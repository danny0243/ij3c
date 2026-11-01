// Creates (or resets the password of) a back-office administrator in the D1 database.
// The password is typed into your own terminal (hidden) and only its PBKDF2 hash is written to the database.
//
//   node scripts/create-admin.mjs <username> --remote
//   node scripts/create-admin.mjs <username> --local [--persist-to <dir>]
//
// For automated tests the password may be supplied in the ADMIN_PASSWORD environment variable.

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ITERATIONS = 100_000; // must match src/auth.js

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--persist-to');
const remote = args.includes('--remote');
const local = args.includes('--local');
const persist = args.includes('--persist-to') ? args[args.indexOf('--persist-to') + 1] : null;

if (!username || remote === local) {
  console.error('Usage: node scripts/create-admin.mjs <username> (--remote | --local [--persist-to <dir>])');
  process.exit(2);
}
if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
  console.error('Username: 3-32 characters, letters, digits, dot, underscore or hyphen.');
  process.exit(2);
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No terminal available: run this command in an interactive terminal.'));
    process.stdout.write(question);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  password = await promptHidden(`Password for ${username} (min. 10 characters): `);
  const again = await promptHidden('Repeat password: ');
  if (password !== again) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
}
if (password.length < 10) {
  console.error('The password must have at least 10 characters.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const stored = `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

const dir = mkdtempSync(join(tmpdir(), 'ij3c-admin-'));
const file = join(dir, 'create-admin.sql');
writeFileSync(
  file,
  `INSERT INTO admin_users (username, password_hash) VALUES ('${username}', '${stored}')\n` +
    `ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;\n` +
    `DELETE FROM sessions WHERE user_id = (SELECT id FROM admin_users WHERE username = '${username}');\n`,
);

const wranglerArgs = ['wrangler', 'd1', 'execute', 'ij3c', remote ? '--remote' : '--local', '--file', file];
if (persist) wranglerArgs.push('--persist-to', persist);
// npx is a .cmd shim on Windows, so it needs a shell; build one quoted command line (all values are validated or ours).
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const result = spawnSync(['npx', '--yes', ...wranglerArgs].map(quote).join(' '), { stdio: 'inherit', shell: true });
rmSync(dir, { recursive: true, force: true });

if (result.status !== 0) {
  console.error('wrangler failed; the administrator was not created.');
  process.exit(result.status ?? 1);
}
console.log(`\nAdministrator "${username}" is ready. Sign in at /admin/login.`);
