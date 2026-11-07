// The dev seed's clock, and what it does with a database that isn't empty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, onTestFinished, test} from 'vitest';
import {zoned} from '../src/dev/sample.ts';
import {seedFile} from '../src/dev/seedFile.ts';

describe('seeding', () => {
  test('the seed\'s clock is Pacific, across the DST change', () => {
    expect(zoned('2026-03-03', '09:41')).toBe('2026-03-03T17:41:00.000Z');
  });

  test('a database that isn\'t empty is refused, unless reset', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-seed-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'setpoint.sqlite');
    seedFile(file);
    expect(() => seedFile(file)).toThrow(/isn't empty/);
    expect(seedFile(file, {reset: true}).emails).toBeGreaterThan(0);
  });
});
