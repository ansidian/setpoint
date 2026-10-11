// A dev seed on real news (src/dev/newsSnapshot.ts), tried on the sample's own News taken as a
// snapshot 4 days and an hour after the seed's moment: its times come back by that gap, a keynote's
// start by whole days, every source is a stand-in nothing fetches, and the images come along.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, onTestFinished, test, vi} from 'vitest';
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
  return {dir, tables, original: Object.fromEntries(TABLES.map(table => [table, from.sqlite.prepare(`select * from ${table}`).all()]))};
}

describe('a dev seed on a news snapshot', () => {
  test('its times move back to the seed\'s moment, a keynote\'s start by whole days', () => {
    const {dir, original} = sampleSnapshot();
    const into = openDatabase(':memory:');
    onTestFinished(() => {
      into.sqlite.close();
    });
    const {stories} = seedSampleData(into, {newsSnapshot: dir, newsImagesDir: path.join(scratch(), 'news-images')});
    expect(stories).toBe(original.news_stories!.length);
    const story = (row: unknown) => row as {id: number; last_new_fact_at: string; seen_at: string | null};
    const loaded = into.sqlite.prepare('select id, last_new_fact_at, seen_at from news_stories order by id').all().map(story);
    expect(loaded).toEqual(original.news_stories!.map(row => story(row)).map(({id, last_new_fact_at, seen_at}) => ({id, last_new_fact_at, seen_at})));
    // The keynote keeps its 10 AM: 4 days back from a start moved 4 days and an hour on.
    const [event] = into.sqlite.prepare('select starts_at from news_events').all() as {starts_at: string}[];
    expect(event!.starts_at).toBe(new Date(Date.parse((original.news_events![0] as {starts_at: string}).starts_at) + HOUR).toISOString());
  });

  test('every source is a stand-in no adapter fetches, with no cursor to resume', () => {
    const {dir} = sampleSnapshot();
    const into = openDatabase(':memory:');
    onTestFinished(() => {
      into.sqlite.close();
    });
    seedSampleData(into, {newsSnapshot: dir});
    expect(into.sqlite.prepare('select count(*) n from news_sources where dev = 0 or cursor is not null').get()).toEqual({n: 0});
  });

  test('its images come along, by the names their rows keep', () => {
    const {dir, tables} = sampleSnapshot();
    const images = path.join(scratch(), 'news-images');
    const into = openDatabase(':memory:');
    onTestFinished(() => {
      into.sqlite.close();
    });
    seedSampleData(into, {newsSnapshot: dir, newsImagesDir: images});
    const files = tables.news_images!.map(row => String((row as {file: string}).file)).sort();
    expect(fs.readdirSync(images).sort()).toEqual(files);
    expect(fs.readFileSync(path.join(images, files[0]!))).toEqual(fs.readFileSync(path.join(dir, 'news-images', files[0]!)));
  });

  test('one that won\'t load says so, and News is the sample\'s', () => {
    const into = openDatabase(':memory:');
    onTestFinished(() => {
      into.sqlite.close();
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const sample = openDatabase(':memory:');
    onTestFinished(() => {
      sample.sqlite.close();
    });
    expect(seedSampleData(into, {newsSnapshot: scratch()}).stories).toBe(seedSampleData(sample).stories);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/didn't load \(No news snapshot at .*news\.json.*\), so News is the sample's/));
  });
});
