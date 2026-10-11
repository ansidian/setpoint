// A dev seed on real news: News's tables as src/dev/exportNews.ts took them from a running Setpoint,
// loaded in place of the sample's by `npm run seed` and `npm run try` whenever the snapshot is there.
// It's data/news-snapshot/ (news.json and news-images/), outside git: Local's stories name the area.
// The browser checks seed with --sample-news, so they and the goldens keep the invented sample, as
// does a checkout without a snapshot.
//
// Its times move by the gap from when it was taken to the seed's moment, so the news is as fresh
// against the seed's clock as it was when taken; a keynote's start moves by whole days, keeping its
// hour. Every source is a `dev` stand-in, which no adapter fetches. Rows keep their ids, so the
// images keep their names.
import fs from 'node:fs';
import path from 'node:path';
import {SEED_NOW} from '@setpoint/shared';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';

const NEWS_SNAPSHOT_DIR = 'news-snapshot';

/** The checkout's snapshot directory under `dataRoot` (the repository's data/), if one has been taken. */
export function newsSnapshotIn(dataRoot: string): string | null {
  const dir = path.join(dataRoot, NEWS_SNAPSHOT_DIR);
  return fs.existsSync(path.join(dir, 'news.json')) ? dir : null;
}

// In the order their references need.
const TABLES = [
  'news_sources', 'news_articles', 'news_stories', 'news_story_sections', 'news_story_articles', 'news_facts', 'news_images', 'news_events', 'news_sorting',
] as const;

type Row = Record<string, string | number | null>;
interface Snapshot {
  taken_at: string;
  tables: Record<(typeof TABLES)[number], Row[]>;
}

const DAY = 86_400_000;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** A row with each instant moved by `by` milliseconds. */
export function moved(row: Row, by: number): Row {
  return Object.fromEntries(Object.entries(row).map(([column, value]) =>
    [column, typeof value === 'string' && INSTANT.test(value) ? new Date(Date.parse(value) + by).toISOString() : value]));
}

/** Loads the snapshot in `dir` into an empty News, its images into `imagesDir`; the stories it holds. */
export function loadNewsSnapshot(store: Store, dir: string, imagesDir: string | null): {stories: number} {
  const file = path.join(dir, 'news.json');
  if (!fs.existsSync(file)) throw new Error(`No news snapshot at ${file}: take one first (src/dev/exportNews.ts).`);
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
  const by = Date.parse(SEED_NOW) - Date.parse(snapshot.taken_at);
  const byDays = Math.round(by / DAY) * DAY;
  transaction(store, () => {
    // The sample's own sorting row, if any, gives way to the snapshot's.
    store.sqlite.exec('delete from news_sorting');
    for (const table of TABLES) {
      // Columns both sides know, so a snapshot from a slightly older or newer schema still loads.
      const known = new Set((store.sqlite.prepare(`select name from pragma_table_info('${table}')`).all() as {name: string}[]).map(column => column.name));
      for (const original of snapshot.tables[table] ?? []) {
        let row = table === 'news_events' ? {...moved(original, by), starts_at: moved({at: original.starts_at!}, byDays).at!} : moved(original, by);
        if (table === 'news_sources') row = {...row, dev: 1, cursor: null};
        const columns = Object.keys(row).filter(column => known.has(column));
        store.sqlite.prepare(`insert into ${table} (${columns.join(', ')}) values (${columns.map(() => '?').join(', ')})`).run(...columns.map(column => row[column] ?? null));
      }
    }
  });
  if (imagesDir) {
    fs.mkdirSync(imagesDir, {recursive: true});
    for (const image of snapshot.tables.news_images) {
      const from = path.join(dir, 'news-images', String(image.file));
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(imagesDir, String(image.file)));
    }
  }
  return {stories: snapshot.tables.news_stories.length};
}
