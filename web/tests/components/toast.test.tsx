// The one toast (ToastPill.tsx on toast.ts): it drops in, and again when a new one replaces it,
// leads with its tone's glyph, drains Undo as a hairline, waits under the pointer, and fades out.
// The clock is Vitest's, so its six and eight seconds pass at once.
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ToastPill} from '../../src/app/ToastPill.tsx';
import {dismissToast, showToast, UNDO_MS} from '../../src/app/toast.ts';
import {motion} from '../../src/tokens.ts';
import {colour} from './colour.ts';

const toast = page.getByRole('status');
const style = (element: Element, property: string, pseudo?: string) => getComputedStyle(element, pseudo).getPropertyValue(property);

/** Every class the toast wears from now on, so a fade too short to poll for is still seen. */
function classes(): () => string[] {
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const pill = document.querySelector('.toast');
    if (pill && seen.at(-1) !== pill.className) seen.push(pill.className);
  });
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
  return () => seen;
}
const fadedOut = (seen: string[]) => seen.some(name => name.split(' ').includes('leaving'));

beforeEach(async () => {
  // Its clock runs on with the real one, so the locators' own retries still come round.
  vi.useFakeTimers({shouldAdvanceTime: true});
  await render(<ToastPill />);
});

afterEach(() => {
  dismissToast();
  vi.runAllTimers();
  vi.useRealTimers();
});

test('Marked Done drops in led by `check` in `good`, its Undo draining as an `ink3` hairline over its six seconds', async () => {
  showToast('Marked Done', {label: 'Undo', run: () => {}});
  await expect.element(toast).toMatchTextContent('Marked Done');
  const pill = toast.element();
  expect([style(pill, 'animation-name'), style(pill, 'animation-duration')]).toEqual(['toast-in', `${motion.medium / 1000}s`]);
  const tone = pill.querySelector('.tone')!;
  expect(style(tone, 'color')).toBe(colour('var(--good)'));
  expect(tone.querySelector('svg')?.getAttribute('width')).toBe('16');
  expect([style(pill, 'animation-duration', '::after'), style(pill, 'animation-timing-function', '::after')]).toEqual([`${UNDO_MS / 1000}s`, 'linear']);
  expect(style(pill, 'background-color', '::after')).toBe(colour('color-mix(in oklch, var(--ink3) 45%, transparent)'));
});

test('a new line replaces the last as a new toast, so it drops in afresh, and its tone is its own', async () => {
  showToast('Marked Done', {label: 'Undo', run: () => {}});
  await expect.element(toast).toMatchTextContent('Marked Done');
  const first = toast.element();
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  await expect.element(toast).toMatchTextContent('Moved to Trash');
  expect(toast.element()).not.toBe(first);
  expect(style(toast.element().querySelector('.tone')!, 'color')).toBe(colour('var(--ink3)'));
  // A line with no tone of its own has no glyph.
  showToast('Added to Classes');
  await expect.element(toast).toMatchTextContent('Added to Classes');
  expect(toast.element().querySelector('.tone')).toBeNull();
});

test('under the pointer it waits, its hairline held, past its time; left, it runs on with what it had left, then fades out before it goes', async () => {
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  await expect.element(toast).toBeVisible();
  vi.advanceTimersByTime(UNDO_MS - 2000);
  await userEvent.hover(toast);
  await expect.element(toast).toHaveClass('held');
  expect(style(toast.element(), 'animation-play-state', '::after')).toBe('paused');
  vi.advanceTimersByTime(UNDO_MS * 2);
  await expect.element(toast).toMatchTextContent('Moved to Trash');
  await expect.element(toast).not.toHaveClass('leaving');

  await userEvent.unhover(toast);
  await expect.element(toast).not.toHaveClass('held');
  // It had two seconds left; the clock also runs on by itself between steps, so the bounds have room.
  const seen = classes();
  vi.advanceTimersByTime(1000);
  await expect.element(toast).toBeInTheDocument();
  expect(fadedOut(seen())).toBe(false);
  // Up to its end only, not on past its fade as well.
  vi.advanceTimersToNextTimer();
  await expect.element(toast).not.toBeInTheDocument();
  expect(fadedOut(seen())).toBe(true);
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

test('a failure leads with `error` in `alert`, wears an `alert` ring and wash, its words in `ink`, stays eight seconds, and has no hairline', async () => {
  showToast('Couldn\'t pin it, Gmail didn\'t answer in time.', null, 'failed');
  await expect.element(toast).toHaveClass('failed');
  const pill = toast.element();
  expect(style(pill.querySelector('.tone')!, 'color')).toBe(colour('var(--alert)'));
  expect(style(pill, 'box-shadow').startsWith(`${colour('color-mix(in oklch, var(--alert) 40%, transparent)')} 0px 0px 0px 1px inset`)).toBe(true);
  expect(style(pill, 'background-color')).toBe(colour('color-mix(in oklch, var(--alert) 8%, var(--cardOn))'));
  expect(style(pill.querySelector('span:not(.tone)')!, 'color')).toBe(colour('var(--ink)'));
  expect(style(pill, 'content', '::after')).toBe('none');
  const seen = classes();
  vi.advanceTimersByTime(UNDO_MS + 1000);
  await expect.element(toast).toBeInTheDocument();
  expect(fadedOut(seen())).toBe(false);
  // Up to its end only, not on past its fade as well.
  vi.advanceTimersToNextTimer();
  await expect.element(toast).not.toBeInTheDocument();
  expect(fadedOut(seen())).toBe(true);
});
