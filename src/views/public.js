// Public pages. The markup (tags, classes, ids, link targets) is the same as the former static
// index.html / volume/*.html so assets/site.css keeps styling it exactly as before.
// test/golden.mjs renders every page and compares it with the legacy HTML.

import { html, lines, paragraphs, raw, withPrefix } from '../util.js';

const NAV = [
  ['home', 'Home'],
  ['aims', 'Aims & Scopes'],
  ['volumes', 'Volumes'],
  ['authors', 'Author Guide'],
  ['editorial', 'Editorial Board'],
  ['contact', 'Contact'],
];

function head(title, s, prefix) {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${s.meta_description}">
  <link rel="stylesheet" href="${prefix}assets/site.css">
</head>
<body>`;
}

function header(s, prefix, active) {
  const links = NAV.map(
    ([id, label]) => html`<a class="${id === active ? 'nav-link is-active' : 'nav-link'}" href="${prefix}index.html#${id}">${label}</a>`,
  );
  return html`<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="${prefix}index.html#home" aria-label="${s.site_short} home">
      <img src="${prefix}images/logo.png" alt="" width="52" height="35">
      <span>${s.site_short}</span>
    </a>
    <nav class="site-nav" aria-label="Main navigation">
      ${links}
    </nav>
  </div>
</header>`;
}

function footer(s, prefix) {
  return html`<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <strong>${s.site_short}</strong>
      <p>${s.site_title}</p>
    </div>
    <div>
      <a href="${prefix}index.html#contact">Contact</a>
      <a href="mailto:${s.footer_email}">${s.footer_email}</a>
    </div>
  </div>
  <div class="footer-bottom">${s.copyright_text}</div>
</footer>
</body>
</html>`;
}

/** `{email}` inside the support sentence becomes a mailto link. */
function supportLine(s) {
  const link = html`<a href="mailto:${s.support_email}">${s.support_email}</a>`;
  return s.support_text.split('{email}').flatMap((part, i, parts) => (i < parts.length - 1 ? [part, link] : [part]));
}

export function homePage({ settings: s, topics, issues, downloads, board }) {
  const prefix = '';
  return html`${head(s.site_title, s, prefix)}
${header(s, prefix, 'home')}
<main id="home">
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">${s.hero_eyebrow}</p>
        <h1>${s.site_title}</h1>
        <p class="lead">${s.hero_lead}</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#volumes">${s.hero_btn_primary}</a>
          <a class="button button-secondary" href="#authors">${s.hero_btn_secondary}</a>
        </div>
      </div>
      <figure class="journal-cover">
        <img src="${withPrefix(prefix, s.cover_image)}" alt="${s.cover_alt}">
      </figure>
    </div>
  </section>

  <section class="section">
    <div class="container prose">
      <h2>${s.welcome_heading}</h2>
      ${paragraphs(s.welcome_body).map((p) => html`<p>${p}</p>`)}
      <div class="policy-strip">
        <strong>${s.policy_title}</strong>
        ${lines(s.policy_items).map((item) => html`<span>${item}</span>`)}
      </div>
    </div>
  </section>

  <section class="section section-muted" id="aims">
    <div class="container">
      <div class="section-heading">
        <p class="eyebrow">${s.aims_eyebrow}</p>
        <h2>${s.aims_heading}</h2>
      </div>
      <div class="topic-grid">
        ${topics.map(
          (t) => html`<article class="topic-card">
          <h3>${t.title}</h3>
          <ul>
            ${lines(t.items).map((item) => html`<li>${item}</li>`)}
          </ul>
        </article>`,
        )}
      </div>
    </div>
  </section>

  <section class="section" id="volumes">
    <div class="container">
      <div class="section-heading">
        <p class="eyebrow">${s.volumes_eyebrow}</p>
        <h2>${s.volumes_heading}</h2>
      </div>
      <div class="issue-list">
        ${issues.map(
          (i) => html`<a class="issue-card" href="volume/${i.volume}-${i.number}.html">
          <span>Vol.${i.volume}, No.${i.number}</span>
          <small>Publication Date: ${i.pub_date} | ${i.description}</small>
        </a>`,
        )}
      </div>
    </div>
  </section>

  <section class="section section-muted" id="authors">
    <div class="container two-column">
      <div>
        <p class="eyebrow">${s.authors_eyebrow}</p>
        <h2>${s.authors_heading}</h2>
        ${paragraphs(s.authors_body).map((p) => html`<p>${p}</p>`)}
      </div>
      <div class="download-panel">
        <h3>${s.downloads_heading}</h3>
        <div class="download-list">
          ${downloads.map((d) => html`<a class="download-link" href="${withPrefix(prefix, d.href)}">${d.label}</a>`)}
        </div>
        <p>${supportLine(s)}</p>
      </div>
    </div>
  </section>

  <section class="section" id="editorial">
    <div class="container">
      <div class="section-heading">
        <p class="eyebrow">${s.editorial_eyebrow}</p>
        <h2>${s.editorial_heading}</h2>
      </div>
      <div class="board-grid">
        ${board.map(
          (g) => html`<article class="board-group">
          <h3>${g.title}</h3>
          <ul>
            ${lines(g.members).map((m) => html`<li>${m}</li>`)}
          </ul>
        </article>`,
        )}
      </div>
    </div>
  </section>

  <section class="section section-contact" id="contact">
    <div class="container contact-grid">
      <div>
        <p class="eyebrow">${s.contact_eyebrow}</p>
        <h2>${s.contact_heading}</h2>
        <p><strong>${s.contact_org}</strong><br>${s.contact_address}</p>
      </div>
      <div class="contact-details">
        <p><strong>Contact:</strong><br>${s.contact_person}</p>
        <p><strong>Email:</strong><br><a href="mailto:${s.contact_email}">${s.contact_email}</a></p>
        <p><strong>Fax:</strong><br>${s.contact_fax}</p>
        <p><strong>Homepage:</strong><br><a href="${s.contact_homepage}">${s.contact_homepage}</a></p>
      </div>
    </div>
  </section>
</main>
${footer(s, prefix)}
`.toString();
}

export function issuePage({ settings: s, issue, papers }) {
  const prefix = '../';
  const label = `Vol.${issue.volume}, No.${issue.number}`;
  const actions = [
    issue.cover_pdf && html`<a class="button button-secondary" href="${issue.cover_pdf}">Cover Page PDF</a>`,
    issue.contents_pdf && html`<a class="button button-secondary" href="${issue.contents_pdf}">Contents PDF</a>`,
  ].filter(Boolean);
  return html`${head(`${label} | ${s.site_short}`, s, prefix)}
${header(s, prefix, 'volumes')}
<main>
  <section class="issue-hero">
    <div class="container issue-hero-grid">
      <figure class="journal-cover issue-cover">
        <img src="${withPrefix(prefix, s.cover_image)}" alt="${s.cover_alt}">
      </figure>
      <div>
        <a class="back-link" href="${prefix}index.html#volumes">Back to Volume/Issues</a>
        <p class="eyebrow">Published Issue</p>
        <h1>${label}</h1>
        <dl class="issue-meta">
          <div><dt>Publication Date</dt><dd>${issue.pub_date}</dd></div>
          <div><dt>Volume Number</dt><dd>${label}</dd></div>
          <div><dt>Issues</dt><dd>${issue.description}</dd></div>
          <div><dt>ISSN</dt><dd>${issue.issn}</dd></div>
        </dl>
        ${actions.length ? html`<div class="hero-actions">${actions}</div>` : ''}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="section-heading">
        <p class="eyebrow">Articles</p>
        <h2>${papers.length ? `${papers.length} ${papers.length === 1 ? 'paper' : 'papers'}` : 'Papers coming soon'}</h2>
      </div>
      ${
        papers.length
          ? html`<div class="article-list">
        ${papers.map(
          (p, i) => html`<article class="article-row">
  <div class="article-index">${String(i + 1).padStart(2, '0')}</div>
  <div>
    <h2>${p.title}</h2>
    <p>${p.authors}</p>
  </div>
  ${p.pdf ? html`<a class="pdf-link" href="${p.pdf}">Download PDF</a>` : html`<span class="pdf-link pdf-link-disabled">PDF unavailable</span>`}
</article>`,
        )}
      </div>`
          : ''
      }
    </div>
  </section>
</main>
${footer(s, prefix)}
`.toString();
}
