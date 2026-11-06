// The dev seed's News (BRIEF.md › Sample data › News, round 3): the hazard leads, the sections' full
// lists, and `npm run seed` writing the images.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import * as t from '../src/db/schema.ts';
import {seedFile} from '../src/dev/seedFile.ts';
import {newsImagesDir, readNewsImage} from '../src/news/images.ts';
import {newsPage, newsSection} from '../src/queries/news.ts';
import type {Store} from '../src/store.ts';
import {world} from './helpers.ts';

function seeded(): Store {
  return world({seed: true}).store;
}

describe('All', () => {
  test('a story led by a hazard source names its hazard, for its glyph; every other lead none (news-08)', () => {
    const store = seeded();
    const leads = new Map(newsSection(store, 'local').stories.map(story => [story.headline, story.lead.hazard]));
    expect(leads.get('Red Flag Warning for the valleys until Thu 6 PM')).toBe('nws');
    expect(leads.get('M3.4 earthquake near the foothills, felt lightly across the valleys')).toBe('usgs');
    // An outlet's story names none, with a photo or without one.
    expect(leads.get('Brush fire near the 210 grows to 400 acres')).toBeNull();
    expect(leads.get('Council approves a 120-unit housing project on a former parking lot')).toBeNull();
    const page = newsPage(store);
    expect(page.blocks.flatMap(block => block.stories).filter(story => story.lead.hazard).map(story => story.headline)).toEqual(['Red Flag Warning for the valleys until Thu 6 PM']);
  });

  test('the sections\' full lists: 17 Local, 10 Tech, 8 AI, 12 General, one story in both AI and General', () => {
    const store = seeded();
    const lists = Object.fromEntries((['local', 'tech', 'ai', 'general'] as const).map(section => [section, newsSection(store, section).stories]));
    expect(Object.values(lists).map(list => list.length)).toEqual([17, 10, 8, 12]);
    const shared = lists.ai!.filter(story => story.sections.includes('general'));
    expect(shared.map(story => story.headline)).toEqual(['A federal rule on AI chip exports takes effect']);
    expect(lists.general!.map(story => story.id)).toContain(shared[0]!.id);
    // Biggest first, as All's blocks are.
    const scores = new Map(store.db.select({id: t.newsStories.id, score: t.newsStories.score}).from(t.newsStories).all().map(story => [story.id, story.score]));
    for (const list of Object.values(lists)) {
      const ranked = list.map(story => scores.get(story.id)!);
      expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
    }
    expect(lists.local!.slice(0, 5).map(story => story.id)).toEqual(newsPage(store).blocks[0]!.stories.map(story => story.id));
  });
});

describe('npm run seed', () => {
  test('writes the images through the image store into the data directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-news-seed-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'setpoint.sqlite');
    expect(seedFile(file).stories).toBe(63);
    const {sqlite, db} = openDatabase(file);
    onTestFinished(() => {
      sqlite.close();
    });
    const store: Store = {sqlite, db, timeZone: 'America/Los_Angeles', now: () => new Date(SEED_NOW), keyring: null};
    const images = db.select().from(t.newsImages).all();
    expect(fs.readdirSync(newsImagesDir(dir)).sort()).toEqual(images.map(image => image.file).sort());
    const first = readNewsImage(store, newsImagesDir(dir), images[0]!.id)!;
    expect(first.mimeType).toBe('image/png');
    expect(first.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(first.bytes.length).toBe(images[0]!.sizeBytes);
    // Seeding afresh starts the images over too.
    expect(seedFile(file, {reset: true}).stories).toBe(63);
  });
});
