// The search score (src/dev/searchScore.ts): what each number means, by table, then the real search
// over the seed, and the report saying numbers and search text only.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import * as t from '../src/db/schema.ts';
import {seedSampleData} from '../src/dev/sample.ts';
import {loadTerms, scoreList, scoreReport, scoreSearches, searchTest, summarise} from '../src/dev/searchScore.ts';
import type {TestSearch} from '../src/dev/searchScore.ts';
import {world} from './helpers.ts';
import type {World} from './helpers.ts';

const range = (from: number, to: number) => Array.from({length: to - from + 1}, (_, index) => from + index);
const search = (wanted: number[], partial?: number[]): TestSearch => ({group: 'topic', text: 'invented', wanted, partial});
const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()?.id ?? -1;

describe('scoreList', () => {
  test.each([
    {name: 'the right email first, alone', wanted: [1], ids: [1, 2, 3], firstRight: 1, reciprocalRank: 1, precisionTop5: 0.2, top10: 1, anywhere: 1},
    {name: 'the first right email fourth', wanted: [4, 9], ids: range(1, 10), firstRight: 4, reciprocalRank: 0.25, precisionTop5: 0.2, top10: 1, anywhere: 1},
    {name: 'every row of the top 5 right', wanted: range(1, 5), ids: range(1, 20), firstRight: 1, reciprocalRank: 1, precisionTop5: 1, top10: 1, anywhere: 1},
    {name: 'a short list is still judged on 5 rows', wanted: [1, 2], ids: [1, 2], firstRight: 1, reciprocalRank: 1, precisionTop5: 0.4, top10: 1, anywhere: 1},
    {name: 'more right emails than 10 rows: the top 10 counts against 10', wanted: range(1, 15), ids: range(1, 12), firstRight: 1, reciprocalRank: 1, precisionTop5: 1, top10: 1, anywhere: 0.8},
    {name: 'a right email past the top 10 counts only anywhere', wanted: [3, 11], ids: range(1, 12), firstRight: 3, reciprocalRank: 1 / 3, precisionTop5: 0.2, top10: 0.5, anywhere: 1},
    {name: 'a right email not listed counts nowhere', wanted: [1, 99], ids: range(1, 3), firstRight: 1, reciprocalRank: 1, precisionTop5: 0.2, top10: 0.5, anywhere: 0.5},
    {name: 'no right email', wanted: [99], ids: [1, 2], firstRight: null, reciprocalRank: 0, precisionTop5: 0, top10: 0, anywhere: 0},
    {name: 'an empty list', wanted: [1], ids: [], firstRight: null, reciprocalRank: 0, precisionTop5: 0, top10: 0, anywhere: 0},
  ])('$name', ({name: _name, wanted, ids, ...scores}) => {
    expect(scoreList(search(wanted), ids)).toMatchObject({...scores, listed: ids.length});
  });

  test('how many rows are in the first section, and the right emails among them', () => {
    expect(scoreList(search([1, 3, 9]), range(1, 10), 3)).toMatchObject({firstSection: 3, rightInFirst: 2 / 3, anywhere: 1});
    expect(scoreList(search([1]), range(1, 2))).toMatchObject({firstSection: 2, rightInFirst: 1});
  });

  test('a partly right email scores as wrong', () => {
    expect(scoreList(search([3], [1, 2]), [1, 2, 3])).toMatchObject({firstRight: 3, precisionTop5: 0.2});
  });
});

describe('summarise', () => {
  const scored = (wanted: number[], ids: number[]) => scoreList(search(wanted), ids);

  test('each search counts once, however many right emails it has', () => {
    const summary = summarise([scored(range(1, 10), range(1, 10)), scored([99], [1])]);
    expect(summary).toEqual({searches: 2, mrr: 0.5, rankedFirst: 1, foundNone: 1, precisionTop5: 0.5, top10: 0.5, anywhere: 0.5});
  });

  test('no searches is all zeroes', () => {
    expect(summarise([])).toEqual({searches: 0, mrr: 0, rankedFirst: 0, foundNone: 0, precisionTop5: 0, top10: 0, anywhere: 0});
  });
});

describe('scoring the real search over the seed', () => {
  const lease = 'When does my lease renewal need to be signed?';

  test.each([
    {text: 'northwind rejection march', subjects: ['Update on your application', 'Your application for Data Engineer Intern'], firstRight: 1, precisionTop5: 0.4, top10: 1, anywhere: 1},
    {text: 'renewal', subjects: ['October rent received'], firstRight: 4, precisionTop5: 0.2, top10: 1, anywhere: 1, firstSection: 3, rightInFirst: 0},
    {text: lease, subjects: ['Lease renewal terms', 'Update on your application'], firstRight: 1, precisionTop5: 0.2, top10: 0.5, anywhere: 0.5, listed: 1},
  ])('$text → $subjects', ({text, subjects, ...scores}) => {
    const w = world({seed: true});
    const [score] = scoreSearches(w.store, [{group: 'topic', text, wanted: subjects.map(subject => idOf(w, subject))}]);
    expect(score).toMatchObject(scores);
  });
});

describe('the report', () => {
  test('sets out every group and search, and says no subject or sender', () => {
    const w = world({seed: true});
    const searches: TestSearch[] = [
      {group: 'sender', text: 'parkside', wanted: [idOf(w, 'Lease renewal terms')]},
      {group: 'meaning', text: 'nothing has this word zzzz', wanted: [idOf(w, 'October rent received')]},
    ];
    const lines = scoreReport(scoreSearches(w.store, searches)).split('\n');
    expect(lines.find(line => line.startsWith('all'))).toMatch(/^all\s+2\s/);
    expect(lines.find(line => line.startsWith('sender'))).toMatch(/^sender\s+1\s/);
    expect(lines.find(line => line.startsWith('topic'))).toMatch(/^topic\s+0\s/);
    expect(lines.find(line => line.startsWith('meaning'))).toMatch(/^meaning\s+1\s+0\.000\s+0\s+1\s/);
    expect(lines.filter(line => line.endsWith('parkside') || line.endsWith('zzzz'))).toHaveLength(2);
    const report = lines.join('\n');
    for (const {subject, fromName, fromAddress} of w.store.db.select().from(t.messages).all()) {
      expect(report).not.toContain(subject);
      expect(report).not.toContain(fromName);
      expect(report).not.toContain(fromAddress);
    }
  });
});

describe('the test file', () => {
  test.each([
    {name: 'no searches', file: {searches: []}},
    {name: 'a search with nothing marked right', file: {searches: [{group: 'topic', text: 'x', wanted: []}]}},
    {name: 'a group that isn\'t one', file: {searches: [{group: 'date', text: 'x', wanted: [1]}]}},
  ])('refuses $name', ({file}) => {
    expect(searchTest.safeParse(file).success).toBe(false);
  });
});

describe('loadTerms', () => {
  const inIndex = (w: World, word: string) => w.store.sqlite.prepare('SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?').pluck().get(word);

  test('writes terms as the job does, so the index has them; a later line wins and mail that isn\'t there is left out', () => {
    const w = world({seed: true});
    const id = idOf(w, 'Lease renewal terms');
    const first = `${JSON.stringify({id, terms: ['Old Word']})}\n`;
    const second = `${JSON.stringify({id, terms: ['Tenancy  Agreement', 'tenancy agreement']})}\n\n${JSON.stringify({id: 999_999, terms: ['nowhere']})}\n`;
    expect(loadTerms(w.store.sqlite, [first, second])).toBe(1);
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()?.searchTerms).toBe('tenancy agreement');
    expect(inIndex(w, 'tenancy')).toBe(1);
    expect(inIndex(w, 'nowhere')).toBe(0);
  });
});

// Each run starts a Node process, which a machine that's busy can take seconds over.
const SPAWNING = 30_000;

describe('scoreSearch.ts', () => {
  const script = fileURLToPath(new URL('../src/dev/scoreSearch.ts', import.meta.url));

  test('--migrate scores a copy and leaves the database as it was', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-score-test-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'mail.sqlite');
    const {sqlite, db} = openDatabase(file);
    seedSampleData({sqlite, db}, {newsImagesDir: null});
    sqlite.pragma('journal_mode = DELETE');
    const id = (sqlite.prepare('SELECT id FROM messages WHERE subject = ?').get('Lease renewal terms') as {id: number}).id;
    sqlite.close();
    const test = path.join(dir, 'test.json');
    fs.writeFileSync(test, JSON.stringify({searches: [{group: 'topic', text: 'lease renewal', wanted: [id]}] satisfies TestSearch[]}));
    const before = fs.readFileSync(file);

    const run = (...args: string[]) => execFileSync(process.execPath, ['--no-warnings', script, test, ...args], {env: {...process.env, SETPOINT_DB: file}, encoding: 'utf8'});
    const allRow = (out: string) => out.split('\n').find(line => line.startsWith('all'));
    expect(allRow(run('--migrate'))).toMatch(/^all\s+1\s+1\.000\s/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(allRow(run())).toBe(allRow(run('--migrate')));
    expect(fs.readdirSync(dir).sort()).toEqual(['mail.sqlite', 'test.json']);

    // Terms go into the scratch copy, beside the file, and are gone with it.
    const terms = path.join(dir, 'terms.jsonl');
    const other = (sqliteId: number) => JSON.stringify({searches: [{group: 'topic', text: 'tenancy', wanted: [sqliteId]}] satisfies TestSearch[]});
    fs.writeFileSync(test, other(id));
    expect(allRow(run('--migrate'))).toMatch(/^all\s+1\s+0\.000\s/);
    fs.writeFileSync(terms, `${JSON.stringify({id, terms: ['tenancy agreement']})}\n`);
    const scored = run('--migrate', '--terms', terms);
    expect(scored).toContain('Search terms on 1 emails');
    expect(allRow(scored)).toMatch(/^all\s+1\s+1\.000\s/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual(['mail.sqlite', 'terms.jsonl', 'test.json']);
    expect(() => execFileSync(process.execPath, ['--no-warnings', script, test, '--terms', terms], {env: {...process.env, SETPOINT_DB: file}, stdio: 'pipe'})).toThrow(/--terms needs --migrate/);
  }, SPAWNING);
});
