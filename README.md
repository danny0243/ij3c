# IJ3C — International Journal of Computer, Consumer and Control

Source of https://ij3c.ncut.tw: a Cloudflare Worker that renders the journal site from a **D1** database and serves a
password-protected **back office** at `/admin`. Static files (CSS, images, shipped PDFs) are served by Workers Assets,
PDFs uploaded through the back office live in **R2**.

The public pages produce the same HTML/CSS as the former static site (`test/golden.mjs` compares every page with the
legacy markup), only the content now comes from the database.

## Layout

| Path | What |
| --- | --- |
| `src/index.js` | Worker entry: routes `/`, `/volume/<vol>-<no>`, uploaded-PDF fallback, `/admin/*` |
| `src/views/public.js` | Public page templates (same markup as the old static pages) |
| `src/admin/` | Back office: routing, login, content management, R2 usage page |
| `src/auth.js` | PBKDF2 password hashes, hashed session tokens, login throttling, CSRF check |
| `src/limits.js`, `src/files.js` | R2 uploads/downloads and the usage guard (see below) |
| `src/settings.js` | List of editable site texts |
| `migrations/` | D1 schema (`0001`), seed with the pre-database content (`0002`), R2 usage tables (`0003`) |
| `public/` | Static assets: `assets/`, `images/`, `file/`, `downloads/`, `volume/paperfile/` (shipped PDFs) |
| `scripts/` | `create-admin.mjs` (first/extra administrator), `import-static.mjs` (one-off legacy import) |
| `test/` | `golden.mjs` UI parity, `e2e*.mjs` back-office / upload / limit tests, `fixtures/legacy` old static pages |

## Back office

`/admin` — issues and papers (incl. PDF upload), editorial board, aims & scopes, downloads, site texts, administrators,
activity log, and R2 files & usage. Edits show on the public site immediately.

Create the first administrator (the password is typed into your terminal, only its hash is stored):

```
node scripts/create-admin.mjs <username> --remote
```

More administrators can be added from the back office; the same command resets a password.

## Deploying

Pushing to `main` deploys through Workers Builds (`wrangler deploy`). Manually: `npx wrangler deploy`.

Schema changes are **not** applied by the build. After adding a file to `migrations/`:

```
npx wrangler d1 migrations apply ij3c --remote
```

(or set the Workers Builds deploy command to `npx wrangler d1 migrations apply ij3c --remote && npx wrangler deploy`).

## R2 usage guard

R2 bills for stored data and for operations (Class A = writes, Class B = reads); data transfer is free. To keep usage inside
the free allowance (10 GB, 1 M Class A, 10 M Class B per month) uploaded PDFs are protected by several layers:

1. Only names created by the back office, and only files listed in `stored_files`, ever reach R2.
2. 60 requests/minute per IP on uploaded-PDF downloads (`PDF_LIMITER`).
3. Edge cache (1 hour): a cached download costs no R2 operation. A deleted file can stay downloadable for up to an hour.
4. Monthly caps for storage, reads and writes, default 50 % of the free allowance. Past a cap, reads answer 503 and uploads
   are refused until next month. Caps are adjustable (never above the free allowance) on `/admin/storage`, which also
   shows current usage and the uploaded files.

The tally is the site's own count and can be slightly lower than the real figure; check Cloudflare → R2 → Overview for the
authoritative numbers, and consider a billing alert (Cloudflare → Notifications → Usage-based billing).

Files shipped in `public/volume/paperfile/` are served by Workers Assets, not R2, and do not count.

## Development

```
npx wrangler d1 migrations apply ij3c --local      # local database
npx wrangler dev                                    # http://127.0.0.1:8787
ADMIN_PASSWORD=<test password> node scripts/create-admin.mjs e2e-admin --local   # throw-away local admin
node test/golden.mjs && node test/e2e.mjs && node test/e2e-uploads.mjs && node test/e2e-limits.mjs
```

The tests expect the local admin `e2e-admin` with password `local-test-password-1` (override with `E2E_PASSWORD`) and a
dev server on port 8787. `compatibility_date` is the newest date the bundled local runtime accepts.
