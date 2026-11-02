// The dev seed's clock, and what it does with a database that isn't empty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SEED_NOW} from '@setpoint/shared';
import {count} from 'drizzle-orm';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {seedFile} from '../src/dev/seedFile.ts';

describe('seeding', () => {
  test('SEED_NOW is Wed, Oct 7, 2026, 9:12 AM Pacific', () => {
    expect(zoned('2026-10-07', '09:12')).toBe(SEED_NOW);
    expect(zoned('2026-03-03', '09:41')).toBe('2026-03-03T17:41:00.000Z');
  });

  test('a database that isn\'t empty is refused, unless reset', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-seed-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'setpoint.sqlite');
    seedFile(file);
    expect(() => seedFile(file)).toThrow(/isn't empty/);
    expect(seedFile(file, {reset: true}).emails).toBeGreaterThan(19);
    const {sqlite, db} = openDatabase(file);
    expect(db.select({n: count()}).from(t.accounts).get()!.n).toBe(5);
    sqlite.close();
  });
});
