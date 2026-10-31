import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';

const before = process.env.SQLITE_TMPDIR;
afterEach(() => {
  if (before === undefined) delete process.env.SQLITE_TMPDIR;
  else process.env.SQLITE_TMPDIR = before;
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
