// The phone's toast (ToastPill.tsx below 640 px) at 375 × 812. A line naming a long item stays inside
// the screen, its title giving way, and its Undo stays whole and uncovered. Its look is by eye.
import {afterEach, beforeEach, expect, test} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ToastPill} from '../../src/app/ToastPill.tsx';
import {dismissToast, showToast} from '../../src/app/toast.ts';

const toast = page.getByRole('status');

beforeEach(async () => {
  await page.viewport(375, 812);
  // The main area the app draws it over: the screen's width, the toast placed in it.
  await render(<div style={{position: 'relative', width: '100vw', height: '100vh'}}><ToastPill /></div>);
});

afterEach(() => dismissToast());

/** Whether a box lies wholly inside the screen. */
const onScreen = (box: DOMRect) => box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight;

test.each([
  ['a long title', 'Created Sign the lease renewal at the Parkside Apartments leasing office before the end of the month'],
  ['a long word', 'Saved Supercalifragilisticexpialidocious-and-then-some-more-letters-than-fit'],
])('with %s it fits the screen, and its Undo is whole and uncovered', async (_, line) => {
  showToast(line, {label: 'Undo', run: () => {}});
  const undo = page.getByRole('button', {name: 'Undo'});
  await expect.element(undo).toBeVisible();
  expect(onScreen(toast.element().getBoundingClientRect())).toBe(true);
  const box = undo.element().getBoundingClientRect();
  expect(onScreen(box)).toBe(true);
  // Undo's corners and middle are its own, not the line's or anything over it.
  const inset = 2;
  const points: [number, number][] = [[box.left + inset, box.top + inset], [box.right - inset, box.bottom - inset], [box.left + box.width / 2, box.top + box.height / 2]];
  for (const [x, y] of points) {
    expect(undo.element().contains(document.elementFromPoint(x, y))).toBe(true);
  }
});

test.each([
  ['a long reason', 'Failed to save Sign the lease renewal at the Parkside Apartments, Todoist is down (503) as of 7:26 PM'],
  ['a long word', 'Failed to save Supercalifragilisticexpialidocious-and-then-some-more-letters-than-fit'],
])('a failure with %s wraps inside the screen', async (_, line) => {
  showToast(line, null, 'failed');
  await expect.element(toast).toBeVisible();
  expect(onScreen(toast.element().getBoundingClientRect())).toBe(true);
});
