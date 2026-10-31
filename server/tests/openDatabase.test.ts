import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {openDatabase, openImage} from '../src/db/open.ts';

const before = process.env.SQLITE_TMPDIR;
afterEach(() => {
  if (before === undefined) delete process.env.SQLITE_TMPDIR;
  else process.env.SQLITE_TMPDIR = before;
});

test('a copy of an image holds what the database held, connects the same way and writes only to itself', () => {
  const original = openDatabase(':memory:');
  original.sqlite.exec('CREATE TABLE parents (id INTEGER PRIMARY KEY); CREATE TABLE children (parent INTEGER REFERENCES parents(id));');
  const image = original.sqlite.serialize();
  original.sqlite.close();

  const one = openImage(image);
  const two = openImage(image);
  try {
    one.sqlite.prepare('INSERT INTO parents DEFAULT VALUES').run();
    expect(one.sqlite.prepare('SELECT count(*) AS rows FROM parents').get()).toEqual({rows: 1});
    expect(two.sqlite.prepare('SELECT count(*) AS rows FROM parents').get()).toEqual({rows: 0});
    expect(two.sqlite.prepare('SELECT count(*) AS rows FROM __drizzle_migrations').get()).not.toEqual({rows: 0});
    expect(() => one.sqlite.prepare('INSERT INTO children VALUES (99)').run()).toThrow(/FOREIGN KEY/);
    expect(one.sqlite.prepare('SELECT search_body_of(\'words\') AS body').get()).toEqual({body: 'words'});
  } finally {
    one.sqlite.close();
    two.sqlite.close();
  }
});

test('a large migration\'s temporary data sits beside the database, not in a small /tmp', () => {
  delete process.env.SQLITE_TMPDIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-open-'));
  try {
    const {sqlite} = openDatabase(path.join(dir, 'setpoint.sqlite'));
    sqlite.close();
    expect(process.env.SQLITE_TMPDIR).toBe(dir);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('a temporary directory the host chose stays', () => {
  process.env.SQLITE_TMPDIR = '/chosen';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-open-'));
  try {
    openDatabase(path.join(dir, 'setpoint.sqlite')).sqlite.close();
    expect(process.env.SQLITE_TMPDIR).toBe('/chosen');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
