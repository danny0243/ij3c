// ij3c.ncut.tw — public journal site rendered from D1, plus the /admin back office.
// Static files (CSS, images, shipped PDFs) are served by Workers Assets before this Worker runs.

import { handleAdmin } from './admin/index.js';
import { loadHome, loadIssue } from './db.js';
import { serveStoredFile } from './files.js';
import { htmlResponse, redirect } from './util.js';
import { homePage, issuePage } from './views/public.js';

const notFound = () => new Response('Not found', { status: 404 });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/admin' || pathname.startsWith('/admin/')) return await handleAdmin(request, env, ctx);

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }

      if (pathname === '/') return await htmlResponse(request, homePage(await loadHome(env.DB)));
      if (pathname === '/index.html') return redirect(`/${url.search}`);

      const issue = /^\/volume\/(\d{1,4})-(\d{1,4})(\.html|\/)?$/.exec(pathname);
      if (issue) {
        const [, v, n, suffix] = issue;
        const volume = Number(v);
        const number = Number(n);
        if (String(volume) !== v || String(number) !== n) return notFound();
        if (suffix) return redirect(`/volume/${volume}-${number}${url.search}`);
        const data = await loadIssue(env.DB, volume, number);
        return data ? await htmlResponse(request, issuePage(data)) : notFound();
      }

      if (pathname.startsWith('/volume/paperfile/')) return await serveStoredFile(env, request, ctx, pathname);
      return notFound();
    } catch (err) {
      console.error('unhandled error', request.method, pathname, err?.stack ?? err);
      return new Response('Internal server error', { status: 500 });
    }
  },
};
