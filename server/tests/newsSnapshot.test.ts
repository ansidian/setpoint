// A dev seed on real news (src/dev/newsSnapshot.ts), tried on the sample's own News taken as a
// snapshot 4 days and an hour after the seed's moment: every source is a stand-in nothing fetches.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import {seedSampleData} from '../src/dev/sample.ts';
import {moved} from '../src/dev/newsSnapshot.ts';

const TABLES = ['news_sources', 'news_articles', 'news_stories', 'news_story_sections', 'news_story_articles', 'news_facts', 'news_images', 'news_events', 'news_sorting'];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TAKEN = new Date(Date.parse(SEED_NOW) + 4 * DAY + HOUR).toISOString();

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-news-snapshot-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

/** The sample's News as a running Setpoint would hand it over, `TAKEN` later, with its images. */
function sampleSnapshot() {
  const dir = scratch();
  const from = openDatabase(':memory:');
  onTestFinished(() => {
    from.sqlite.close();
  });
  seedSampleData(from, {newsImagesDir: path.join(dir, 'news-images')});
  from.sqlite.exec(`update news_sources set cursor = 'etag-1' where id = 1`);
  // As exportNews.ts takes it, the times as they stood when taken.
  const later = (row: unknown) => moved(row as Record<string, string | number | null>, 4 * DAY + HOUR);
  const tables = Object.fromEntries(TABLES.map(table => [table, from.sqlite.prepare(`select * from ${table}`).all().map(later)]));
  fs.writeFileSync(path.join(dir, 'news.json'), JSON.stringify({taken_at: TAKEN, tables}));
  return dir;
}

describe('a dev seed on a news snapshot', () => {
  test('every source is a stand-in no adapter fetches, with no cursor to resume', () => {
    const dir = sampleSnapshot();
    const into = openDatabase(':memory:');
    onTestFinished(() => {
      into.sqlite.close();
    });
    seedSampleData(into, {newsSnapshot: dir});
    expect(into.sqlite.prepare('select count(*) n from news_sources where dev = 0 or cursor is not null').get()).toEqual({n: 0});
  });
});
