// One-off importer: reads the legacy static pages (test/fixtures/legacy) and writes
// migrations/0002_seed_content.sql so the D1 database starts with exactly the content
// that was live before the site became data-driven.
//
//   node scripts/import-static.mjs

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const legacy = join(root, 'test/fixtures/legacy');

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const must = (value, what) => {
  if (value === undefined || value === null) throw new Error(`import: could not find ${what}`);
  return value;
};
const first = (re, s, what) => must(re.exec(s), what)[1];
const all = (re, s) => [...s.matchAll(re)];
const sql = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const index = readFileSync(join(legacy, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sections = all(/<section ([^>]*)>([\s\S]*?)<\/section>/g, index).map((m) => ({ attrs: m[1], body: m[2] }));
if (sections.length !== 7) throw new Error(`import: expected 7 sections on the home page, found ${sections.length}`);
const [hero, welcome, aims, volumes, authors, editorial, contact] = sections;

const settings = {};
const set = (key, value) => {
  settings[key] = value;
};

// --- general / hero
const title = text(first(/<title>([\s\S]*?)<\/title>/, index, 'title'));
set('site_title', title);
set('meta_description', first(/<meta name="description" content="([^"]*)"/, index, 'meta description'));
set('site_short', text(first(/<span>([^<]*)<\/span>\s*<\/a>\s*<nav/, index, 'brand name')));
set('hero_eyebrow', text(first(/<p class="eyebrow">([\s\S]*?)<\/p>/, hero.body, 'hero eyebrow')));
if (text(first(/<h1>([\s\S]*?)<\/h1>/, hero.body, 'hero h1')) !== title) throw new Error('import: hero h1 differs from <title>');
set('hero_lead', text(first(/<p class="lead">([\s\S]*?)<\/p>/, hero.body, 'hero lead')));
set('hero_btn_primary', text(first(/<a class="button button-primary"[^>]*>([\s\S]*?)<\/a>/, hero.body, 'primary button')));
set('hero_btn_secondary', text(first(/<a class="button button-secondary"[^>]*>([\s\S]*?)<\/a>/, hero.body, 'secondary button')));
const cover = must(/<img src="([^"]+)" alt="([^"]*)"/.exec(hero.body), 'cover image');
set('cover_image', cover[1]);
set('cover_alt', decode(cover[2]));

// --- welcome
set('welcome_heading', text(first(/<h2>([\s\S]*?)<\/h2>/, welcome.body, 'welcome heading')));
const welcomeBody = welcome.body.slice(0, welcome.body.indexOf('<div class="policy-strip">'));
set('welcome_body', all(/<p>([\s\S]*?)<\/p>/g, welcomeBody).map((m) => text(m[1])).join('\n\n'));
const policy = first(/<div class="policy-strip">([\s\S]*?)<\/div>/, welcome.body, 'policy strip');
set('policy_title', text(first(/<strong>([\s\S]*?)<\/strong>/, policy, 'policy title')));
set('policy_items', all(/<span>([\s\S]*?)<\/span>/g, policy).map((m) => text(m[1])).join('\n'));

// --- aims & scopes
set('aims_eyebrow', text(first(/<p class="eyebrow">([\s\S]*?)<\/p>/, aims.body, 'aims eyebrow')));
set('aims_heading', text(first(/<h2>([\s\S]*?)<\/h2>/, aims.body, 'aims heading')));
const topics = all(/<article class="topic-card">([\s\S]*?)<\/article>/g, aims.body).map((m, i) => ({
  sort: i + 1,
  title: text(first(/<h3>([\s\S]*?)<\/h3>/, m[1], 'topic title')),
  items: all(/<li>([\s\S]*?)<\/li>/g, m[1]).map((li) => text(li[1])).join('\n'),
}));

// --- issues (index cards)
set('volumes_eyebrow', text(first(/<p class="eyebrow">([\s\S]*?)<\/p>/, volumes.body, 'volumes eyebrow')));
set('volumes_heading', text(first(/<h2>([\s\S]*?)<\/h2>/, volumes.body, 'volumes heading')));
const cards = all(
  /<a class="issue-card" href="volume\/(\d+)-(\d+)\.html">\s*<span>Vol\.(\d+), No\.(\d+)<\/span>\s*<small>Publication Date: ([^|]+?) \| ([\s\S]*?)<\/small>/g,
  volumes.body,
).map((m) => {
  if (m[1] !== m[3] || m[2] !== m[4]) throw new Error(`import: issue card ${m[0].slice(0, 60)} has mismatching numbers`);
  return { volume: Number(m[1]), number: Number(m[2]), pub_date: text(m[5]), description: text(m[6]) };
});

// --- author guide + downloads
set('authors_eyebrow', text(first(/<p class="eyebrow">([\s\S]*?)<\/p>/, authors.body, 'authors eyebrow')));
set('authors_heading', text(first(/<h2>([\s\S]*?)<\/h2>/, authors.body, 'authors heading')));
const authorsLeft = first(/<div class="container two-column">\s*<div>([\s\S]*?)<\/div>\s*<div class="download-panel">/, authors.body, 'authors text');
set('authors_body', all(/<p>([\s\S]*?)<\/p>/g, authorsLeft).map((m) => text(m[1])).join('\n\n'));
const panel = first(/<div class="download-panel">([\s\S]*?)<\/div>\s*<\/div>\s*$/, authors.body, 'download panel');
set('downloads_heading', text(first(/<h3>([\s\S]*?)<\/h3>/, panel, 'downloads heading')));
const downloads = all(/<a class="download-link" href="([^"]+)">([\s\S]*?)<\/a>/g, panel).map((m, i) => ({
  sort: i + 1,
  href: decode(m[1]),
  label: text(m[2]),
}));
const support = first(/<p>(For manuscript[\s\S]*?)<\/p>/, panel, 'support text');
const supportEmail = first(/href="mailto:([^"]+)"/, support, 'support email');
set('support_email', supportEmail);
set('support_text', text(support.replace(/<a\s[\s\S]*?<\/a>/, '{email}')));

// --- editorial board
set('editorial_eyebrow', text(first(/<p class="eyebrow">([\s\S]*?)<\/p>/, editorial.body, 'editorial eyebrow')));
set('editorial_heading', text(first(/<h2>([\s\S]*?)<\/h2>/, editorial.body, 'editorial heading')));
const board = all(/<article class="board-group">([\s\S]*?)<\/article>/g, editorial.body).map((m, i) => ({
  sort: i + 1,
  title: text(first(/<h3>([\s\S]*?)<\/h3>/, m[1], 'board title')),
  members: all(/<li>([\s\S]*?)<\/li>/g, m[1]).map((li) => text(li[1])).join('\n'),
}));

// --- contact + footer
set('contact_eyebrow', text(first(/<p class="eyebrow">([\s\S]*?)<\/p>/, contact.body, 'contact eyebrow')));
set('contact_heading', text(first(/<h2>([\s\S]*?)<\/h2>/, contact.body, 'contact heading')));
const office = must(/<p><strong>([\s\S]*?)<\/strong><br>([\s\S]*?)<\/p>/.exec(contact.body), 'office block');
set('contact_org', text(office[1]));
set('contact_address', text(office[2]));
const details = new Map(all(/<p><strong>([^<]+?):<\/strong><br>([\s\S]*?)<\/p>/g, contact.body.slice(contact.body.indexOf('contact-details'))).map((m) => [m[1], m[2]]));
set('contact_person', text(must(details.get('Contact'), 'contact person')));
set('contact_email', first(/href="mailto:([^"]+)"/, must(details.get('Email'), 'contact email'), 'contact email'));
set('contact_fax', text(must(details.get('Fax'), 'contact fax')));
set('contact_homepage', first(/href="([^"]+)"/, must(details.get('Homepage'), 'contact homepage'), 'contact homepage'));
const footer = first(/<footer[^>]*>([\s\S]*?)<\/footer>/, index, 'footer');
set('footer_email', first(/href="mailto:([^"]+)"/, footer, 'footer email'));
set('copyright_text', text(first(/<div class="footer-bottom">([\s\S]*?)<\/div>/, footer, 'copyright')));

// --- one page per issue
const issues = cards
  .map((card) => {
    const slug = `${card.volume}-${card.number}`;
    const page = readFileSync(join(legacy, 'volume', `${slug}.html`), 'utf8').replace(/\r\n/g, '\n');
    const meta = new Map(all(/<dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd>/g, page).map((m) => [m[1], text(m[2])]));
    if (meta.get('Publication Date') !== card.pub_date) throw new Error(`import: ${slug} publication date differs between index and page`);
    if (meta.get('Issues') !== card.description) throw new Error(`import: ${slug} description differs between index and page`);
    const actions = page.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)?.[1] ?? '';
    const link = (label) => {
      const m = new RegExp(`<a class="button button-secondary" href="([^"]+)">${label}</a>`).exec(actions);
      return m ? decode(m[1]) : null;
    };
    const papers = all(/<article class="article-row">([\s\S]*?)<\/article>/g, page).map((m, i) => ({
      sort: i + 1,
      title: text(first(/<h2>([\s\S]*?)<\/h2>/, m[1], `${slug} paper title`)),
      authors: text(first(/<p>([\s\S]*?)<\/p>/, m[1], `${slug} paper authors`)),
      pdf: /<a class="pdf-link" href="([^"]+)">Download PDF<\/a>/.exec(m[1])?.[1] ?? null,
    }));
    return {
      ...card,
      issn: must(meta.get('ISSN'), `${slug} ISSN`),
      cover_pdf: link('Cover Page PDF'),
      contents_pdf: link('Contents PDF'),
      papers: papers.map((p) => ({ ...p, pdf: p.pdf ? decode(p.pdf) : null })),
    };
  })
  .sort((a, b) => a.volume - b.volume || a.number - b.number);

// --- write SQL
const out = [];
out.push('-- Generated by scripts/import-static.mjs from the pre-database static site. Do not edit by hand.');
out.push('');
for (const [key, value] of Object.entries(settings)) {
  out.push(`INSERT INTO settings (key, value) VALUES (${sql(key)}, ${sql(value)});`);
}
out.push('');
for (const t of topics) out.push(`INSERT INTO topics (sort, title, items) VALUES (${t.sort}, ${sql(t.title)}, ${sql(t.items)});`);
out.push('');
for (const g of board) out.push(`INSERT INTO board_groups (sort, title, members) VALUES (${g.sort}, ${sql(g.title)}, ${sql(g.members)});`);
out.push('');
for (const d of downloads) out.push(`INSERT INTO downloads (sort, label, href) VALUES (${d.sort}, ${sql(d.label)}, ${sql(d.href)});`);
out.push('');
for (const i of issues) {
  out.push(
    `INSERT INTO issues (volume, number, pub_date, description, issn, cover_pdf, contents_pdf, published) VALUES (${i.volume}, ${i.number}, ${sql(i.pub_date)}, ${sql(i.description)}, ${sql(i.issn)}, ${sql(i.cover_pdf)}, ${sql(i.contents_pdf)}, 1);`,
  );
  for (const p of i.papers) {
    out.push(
      `INSERT INTO papers (issue_id, sort, title, authors, pdf) VALUES ((SELECT id FROM issues WHERE volume = ${i.volume} AND number = ${i.number}), ${p.sort}, ${sql(p.title)}, ${sql(p.authors)}, ${sql(p.pdf)});`,
    );
  }
}
out.push('');

writeFileSync(join(root, 'migrations/0002_seed_content.sql'), out.join('\n'));
const paperCount = issues.reduce((n, i) => n + i.papers.length, 0);
console.log(
  `wrote migrations/0002_seed_content.sql: ${Object.keys(settings).length} settings, ${topics.length} topics, ${board.length} board groups, ` +
    `${downloads.length} downloads, ${issues.length} issues, ${paperCount} papers`,
);
