// Read queries used by the public pages. Each page needs one D1 round trip (db.batch).

import { settingsFromRows } from './settings.js';

export async function loadHome(db) {
  const [settings, topics, issues, downloads, board] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare('SELECT title, items FROM topics ORDER BY sort, id'),
    db.prepare('SELECT volume, number, pub_date, description FROM issues WHERE published = 1 ORDER BY volume DESC, number DESC'),
    db.prepare('SELECT label, href FROM downloads ORDER BY sort, id'),
    db.prepare('SELECT title, members FROM board_groups ORDER BY sort, id'),
  ]);
  return {
    settings: settingsFromRows(settings.results),
    topics: topics.results,
    issues: issues.results,
    downloads: downloads.results,
    board: board.results,
  };
}

export async function loadIssue(db, volume, number) {
  const [settings, issue, papers] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare('SELECT * FROM issues WHERE volume = ?1 AND number = ?2 AND published = 1').bind(volume, number),
    db.prepare(
      `SELECT title, authors, pdf FROM papers
       WHERE issue_id = (SELECT id FROM issues WHERE volume = ?1 AND number = ?2 AND published = 1)
       ORDER BY sort, id`,
    ).bind(volume, number),
  ]);
  const row = issue.results[0];
  if (!row) return null;
  return { settings: settingsFromRows(settings.results), issue: row, papers: papers.results };
}
