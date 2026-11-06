// The one segmented control (ui/Segmented.tsx, DESIGN.md #317, SV-211): its segments say which is on
// as their role asks, its thumb travels to the segment turned on and is placed at once otherwise, and
// where a page turns it on, Tab and Shift-Tab step it, wrapping, but not in a field, a popover, the
// editor or a dialog. How the slide looks and paces is by eye (D416); the pages' keys are the specs'.
import {useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {Segmented, stepSegment} from '../../src/ui/Segmented.tsx';
import type {SegmentRole} from '../../src/ui/Segmented.tsx';

const VIEWS = ['all', 'local', 'tech'] as const;
type View = (typeof VIEWS)[number];
const SEGMENTS = VIEWS.map(view => ({value: view, label: view === 'all' ? 'All' : view[0]!.toUpperCase() + view.slice(1)}));

function Views({role, tabs = false, onChange = () => {}, labels = SEGMENTS}: {role?: SegmentRole; tabs?: boolean; onChange?: (next: View) => void; labels?: typeof SEGMENTS}) {
  const [value, setValue] = useState<View>('all');
  const set = (next: View) => {
    setValue(next);
    onChange(next);
  };
  return <Segmented label="Views" role={role} value={value} segments={labels} onChange={set} onTab={tabs ? set : undefined} />;
}

const seg = () => document.querySelector<HTMLElement>('.seg')!;
const on = () => seg().querySelector<HTMLElement>(':scope > .on')!;
/** Where the thumb is headed, and the `on` segment's box. */
const thumb = () => ({to: [seg().style.getPropertyValue('--thumb-x'), seg().style.getPropertyValue('--thumb-w')], on: [`${on().offsetLeft}px`, `${on().offsetWidth}px`]});
/** The thumb's transitions running now, by property. */
const moving = () => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect | null)?.target === seg()).map(animation => (animation as CSSTransition).transitionProperty).sort();

test.each<[SegmentRole | undefined, string, string, string]>([
  [undefined, 'group', 'button', 'aria-pressed'],
  ['radio', 'radiogroup', 'radio', 'aria-checked'],
  ['tab', 'tablist', 'tab', 'aria-selected'],
])('as %s: a %s of %ss, the one on saying %s, and a click turns another on', async (role, group, each, state) => {
  const onChange = vi.fn();
  await render(<Views role={role} onChange={onChange} />);
  const segments = page.getByRole(group as 'group', {name: 'Views'}).getByRole(each as 'button');
  expect(segments.all().map(segment => segment.element().textContent)).toEqual(['All', 'Local', 'Tech']);
  await expect.element(page.getByRole(each as 'button', {name: 'All'})).toHaveAttribute(state, 'true');
  await page.getByRole(each as 'button', {name: 'Tech'}).click();
  await expect.element(page.getByRole(each as 'button', {name: 'Tech'})).toHaveAttribute(state, 'true');
  await expect.element(page.getByRole(each as 'button', {name: 'All'})).toHaveAttribute(state, 'false');
  expect(onChange.mock.calls).toEqual([['tech']]);
});

test('the thumb is placed under the segment that\'s on at once, then travels, place and width together, to the one turned on', async () => {
  await render(<Views />);
  await expect.poll(() => thumb().to).toEqual(thumb().on);
  expect(moving(), 'placed at once').toEqual([]);
  // A click's render, its observer and the style it starts, all in this one task.
  page.getByRole('button', {name: 'Tech'}).element().dispatchEvent(new MouseEvent('click', {bubbles: true}));
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  expect(moving()).toEqual(['transform', 'width']);
  expect(thumb().to).toEqual(thumb().on);
  // The `on` segment draws no fill of its own: the thumb is its fill, so nothing hands over.
  expect(getComputedStyle(on()).backgroundColor).toBe('rgba(0, 0, 0, 0)');
});

test('the on segment\'s words changing its width move the thumb at once, without a slide', async () => {
  const {rerender} = await render(<Views />);
  await expect.poll(() => thumb().to).toEqual(thumb().on);
  const before = on().offsetWidth;
  await rerender(<Views labels={SEGMENTS.map(segment => (segment.value === 'all' ? {...segment, label: 'All of them'} : segment))} />);
  await expect.poll(() => on().offsetWidth).toBeGreaterThan(before);
  await expect.poll(() => thumb().to).toEqual(thumb().on);
  expect(moving()).toEqual([]);
});

test.each<[View, 1 | -1, View]>([
  ['all', 1, 'local'],
  ['local', 1, 'tech'],
  ['tech', 1, 'all'],
  ['all', -1, 'tech'],
  ['local', -1, 'all'],
])('from %s by %i: %s, wrapping', (from, delta, next) => {
  expect(stepSegment(VIEWS, from, delta)).toBe(next);
});

test('where a page turns it on, Tab and Shift-Tab step the segments from anywhere, wrapping, and its tip says so', async () => {
  const onChange = vi.fn();
  await render(<Views tabs onChange={onChange} />);
  expect(seg().dataset.tip).toBe('Tab · ⇧Tab');
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  await expect.element(page.getByRole('button', {name: 'Tech'})).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard('{Tab}{Tab}');
  await expect.element(page.getByRole('button', {name: 'Local'})).toHaveAttribute('aria-pressed', 'true');
  expect(onChange.mock.calls).toEqual([['tech'], ['all'], ['local']]);
});

test('off, Tab is the browser\'s and there\'s no tip', async () => {
  const onChange = vi.fn();
  await render(<Views onChange={onChange} />);
  expect(seg().dataset.tip).toBeUndefined();
  await userEvent.keyboard('{Tab}');
  await expect.element(page.getByRole('button', {name: 'All'})).toHaveFocus();
  expect(onChange).not.toHaveBeenCalled();
});

test.each<[string, string]>([
  ['in a text field', '<input aria-label="Field">'],
  ['with a popover or menu open', '<div class="pop"><button>In the menu</button></div>'],
  ['with a modal open', '<div aria-modal="true"><button>In the modal</button></div>'],
  ['with the editor open', '<form class="rpane editor"><button type="button">In the editor</button></form>'],
  ['in a dialog', '<div role="dialog"><button>In the dialog</button></div>'],
])('Tab is the browser\'s %s', async (_, html) => {
  const onChange = vi.fn();
  await render(<><Views tabs onChange={onChange} /><div dangerouslySetInnerHTML={{__html: html}} /></>);
  const target = document.querySelector<HTMLElement>('input, .pop button, [aria-modal] button, .editor button, [role="dialog"] button')!;
  target.focus();
  await userEvent.keyboard('{Tab}');
  await expect.poll(() => document.activeElement).not.toBe(target);
  expect(onChange).not.toHaveBeenCalled();
  await expect.element(page.getByRole('button', {name: 'All'})).toHaveAttribute('aria-pressed', 'true');
});
