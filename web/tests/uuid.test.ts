// uuid() (app/uuid.ts): a v4 UUID from getRandomValues, so it works where randomUUID doesn't.
import {expect, test} from 'vitest';
import {uuid} from '../src/app/uuid.ts';

test('a v4 UUID, a new one each time', () => {
  const made = Array.from({length: 50}, () => uuid());
  for (const one of made) expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(made).size).toBe(made.length);
});
