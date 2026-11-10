// The one toast (ToastPill.tsx on toast.ts): a new one replaces the last, it doesn't wait under the
// pointer, it swipes away (D506) and fades out; a failure stays longer; what's held back until it goes
// is let go however it goes. Its look and its motion are by eye (D269): a swipe is read by its outcome.
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

test('under the pointer it doesn\'t wait: it goes at its six seconds all the same', async () => {
  const seen = classes();
  const shown = Date.now();
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  await userEvent.hover(toast);
  advanceTo(shown + UNDO_MS);
  await expect.element(toast).not.toBeInTheDocument();
  expect(Math.abs(seen().find(worn => wearing(worn, 'leaving'))!.at - shown - UNDO_MS)).toBeLessThan(1000);
});

/** A press on the pill, carried `by` px across and let go, as a pointer does. */
function drag(by: number) {
  const pill = toast.element();
  const {x, y, height} = pill.getBoundingClientRect();
  const at = {clientX: x + 30, clientY: y + height / 2, pointerId: 1, button: 0, bubbles: true};
  pill.dispatchEvent(new PointerEvent('pointerdown', at));
  document.dispatchEvent(new PointerEvent('pointermove', {...at, clientX: at.clientX + by}));
  document.dispatchEvent(new PointerEvent('pointerup', {...at, clientX: at.clientX + by}));
}

test('dragged either way past its distance it goes, its action unrun; dragged short it stays', async () => {
  const run = vi.fn();
  for (const by of [150, -150]) {
    showToast('Moved to Trash', {label: 'Undo', run});
    await expect.element(toast).toBeVisible();
    drag(by);
    vi.advanceTimersByTime(motion.fast);
    await expect.element(toast).not.toBeInTheDocument();
  }
  showToast('Moved to Trash', {label: 'Undo', run});
  await expect.element(toast).toBeVisible();
  drag(30);
  vi.advanceTimersByTime(motion.fast);
  await expect.element(toast).not.toHaveClass('leaving');
  expect(run).not.toHaveBeenCalled();
});

test('two fingers across a trackpad swipe it away, and the page doesn\'t take the swipe; a vertical scroll doesn\'t', async () => {
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  await expect.element(toast).toBeVisible();
  const scroll = new WheelEvent('wheel', {deltaY: 150, bubbles: true, cancelable: true});
  toast.element().dispatchEvent(scroll);
  expect(scroll.defaultPrevented).toBe(false);
  await expect.element(toast).not.toHaveClass('leaving');
  const swipe = new WheelEvent('wheel', {deltaX: 150, bubbles: true, cancelable: true});
  toast.element().dispatchEvent(swipe);
  expect(swipe.defaultPrevented).toBe(true);
  vi.advanceTimersByTime(motion.fast);
  await expect.element(toast).not.toBeInTheDocument();
});

test('what waits on a toast is let go once, however it goes: its time, a swipe, a newer toast, or its action', async () => {
  const gone = vi.fn();
  const shown = Date.now();
  showToast('Deleted Dentist', {label: 'Undo', run: () => {}}, undefined, gone);
  advanceTo(shown + UNDO_MS);
  await expect.element(toast).not.toBeInTheDocument();
  expect(gone).toHaveBeenCalledTimes(1);

  showToast('Deleted Dentist', {label: 'Undo', run: () => {}}, undefined, gone);
  await expect.element(toast).toBeVisible();
  drag(150);
  expect(gone).toHaveBeenCalledTimes(2);

  showToast('Deleted Dentist', {label: 'Undo', run: () => {}}, undefined, gone);
  showToast('Deleted Gym');
  expect(gone).toHaveBeenCalledTimes(3);

  showToast('Deleted Dentist', {label: 'Undo', run: () => {}}, undefined, gone);
  await toast.getByRole('button', {name: 'Undo'}).click();
  expect(gone).toHaveBeenCalledTimes(4);
  vi.runAllTimers();
  expect(gone).toHaveBeenCalledTimes(4);
});

test('a check\'s hold keeps it past its time until it goes another way, and the next one runs its own time', async () => {
  const shown = Date.now();
  showToast('Moved to Trash', {label: 'Undo', run: () => {}});
  document.documentElement.setAttribute('data-hold-toast', '');
  advanceTo(shown + UNDO_MS * 3);
  await expect.element(toast).not.toHaveClass('leaving');
  const next = Date.now();
  showToast('Marked Done', {label: 'Undo', run: () => {}});
  expect(document.documentElement.hasAttribute('data-hold-toast')).toBe(false);
  advanceTo(next + UNDO_MS);
  await expect.element(toast).not.toBeInTheDocument();
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
