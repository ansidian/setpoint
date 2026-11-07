// The one toast (ToastPill.tsx on toast.ts): a new one replaces the last, it waits under the pointer
// and fades out; a failure stays longer. Its look is by eye (D269).
// The clock is Vitest's, so its six and eight seconds pass at once.
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ToastPill} from '../../src/app/ToastPill.tsx';
import {dismissToast, showToast, UNDO_MS} from '../../src/app/toast.ts';
import {motion} from '../../src/tokens.ts';

const toast = page.getByRole('status');

interface Worn {
  name: string;
  // On the test's clock, which runs on by itself, so a time is measured here rather than bounded by
  // what the test advanced: on a busy machine a read can come seconds of that clock late (SV-144).
  at: number;
}

/** Every class the toast wears from now on, so a fade too short to poll for is still seen. */
function classes(): () => Worn[] {
  const seen: Worn[] = [];
  const observer = new MutationObserver(() => {
    const pill = document.querySelector('.toast');
    if (pill && seen.at(-1)?.name !== pill.className) seen.push({name: pill.className, at: Date.now()});
  });
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
  return () => seen;
}
const wearing = (worn: Worn, name: string) => worn.name.split(' ').includes(name);
const fadedOut = (seen: Worn[]) => seen.some(worn => wearing(worn, 'leaving'));
/** The clock up to a moment and not past it, so a fade that starts there is drawn and seen. */
const advanceTo = (moment: number) => vi.advanceTimersByTime(Math.max(0, moment - Date.now()));

beforeEach(async () => {
  // Its clock runs on with the real one, so the locators' own retries still come round.
  vi.useFakeTimers({shouldAdvanceTime: true});
  // The pointer starts away from where a toast comes, or a slow frame lets it hold the toast.
  await userEvent.hover(page.elementLocator(document.documentElement), {position: {x: 0, y: 0}});
  await render(<ToastPill />);
});

afterEach(() => {
  dismissToast();
  vi.runAllTimers();
  vi.useRealTimers();
});

test('a new line replaces the last as a new toast, so it drops in afresh, and a line with no tone has no glyph', async () => {
  showToast('Marked Done', {label: 'Undo', run: () => {}});
  await expect.element(toast).toMatchTextContent('Marked Done');
  const first = toast.element();
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  await expect.element(toast).toMatchTextContent('Moved to Trash');
  expect(toast.element()).not.toBe(first);
  // A line with no tone of its own has no glyph.
  showToast('Added to Classes');
  await expect.element(toast).toMatchTextContent('Added to Classes');
  expect(toast.element().querySelector('.tone')).toBeNull();
});

test('under the pointer it waits past its time; left, it runs on with what it had left, then fades out before it goes', async () => {
  const seen = classes();
  const shown = Date.now();
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  await expect.element(toast).toBeVisible();
  // Only the test moves the clock until the pointer is on it, or a busy machine could run it out.
  vi.setTimerTickMode('manual');
  vi.advanceTimersByTime(UNDO_MS - 2000);
  await userEvent.hover(toast);
  vi.setTimerTickMode('interval');
  await expect.element(toast).toHaveClass('held');
  vi.advanceTimersByTime(UNDO_MS * 2);
  await expect.element(toast).toMatchTextContent('Moved to Trash');
  await expect.element(toast).not.toHaveClass('leaving');

  await userEvent.unhover(toast);
  await expect.element(toast).not.toHaveClass('held');
  // Its six seconds, less the time under the pointer: neither started again nor cut short.
  const held = seen().find(worn => wearing(worn, 'held'))!;
  const left = seen().find(worn => worn.at >= held.at && !wearing(worn, 'held'))!;
  advanceTo(left.at + UNDO_MS - (held.at - shown));
  await expect.element(toast).not.toBeInTheDocument();
  const leaving = seen().find(worn => wearing(worn, 'leaving'))!;
  expect(Math.abs(held.at - shown + leaving.at - left.at - UNDO_MS)).toBeLessThan(1000);
});

test('its action runs once, and the toast goes with it', async () => {
  const run = vi.fn();
  showToast('Moved to Trash', {label: 'Undo', run});
  const seen = classes();
  await toast.getByRole('button', {name: 'Undo'}).click();
  vi.advanceTimersByTime(motion.fast);
  await expect.element(toast).not.toBeInTheDocument();
  expect(fadedOut(seen())).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
});

test('a failure stays eight seconds', async () => {
  const seen = classes();
  const shown = Date.now();
  showToast('Couldn\'t pin it, Gmail didn\'t answer in time.', null, 'failed');
  await expect.element(toast).toHaveClass('failed');
  advanceTo(shown + 8000);
  await expect.element(toast).not.toBeInTheDocument();
  expect(Math.abs(seen().find(worn => wearing(worn, 'leaving'))!.at - shown - 8000)).toBeLessThan(1000);
});
