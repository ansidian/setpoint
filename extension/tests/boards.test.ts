// The board a page is on, by its host (SV-202): each board's readers read only its own pages.
import {expect, test} from 'vitest';
import {boardOf} from '../src/boards.ts';

test.each([
  ['www.linkedin.com', 'LinkedIn'],
  ['www.indeed.com', 'Indeed'],
  ['ca.indeed.com', null],
  ['smartapply.indeed.com', null],
  ['linkedin.com', null],
])('%s is %s', (host, name) => {
  expect(boardOf(host)?.name ?? null).toBe(name);
});
