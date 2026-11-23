// A phone list's swipes (phone/swipe.tsx), driven by the pointer events a finger sends: a full
// swipe runs its side's first action, a shorter one rests open on its buttons, a press near the
// screen's left edge is Safari's and a drag up or down is the scroll's. No drag ends in its row's
// click, and a press elsewhere closes the open row without doing anything else.
import {beforeEach, expect, test} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {useSwipes} from '../../src/app/phone/swipe.tsx';
import type {SwipeActs} from '../../src/app/phone/swipe.tsx';

beforeEach(async () => {
  await page.viewport(390, 844);
});

const ACTS: SwipeActs = {
  lead: [{id: 'read', label: 'Read', icon: 'mark_email_read', tone: 'accent'}],
  trail: [{id: 'trash', label: 'Trash', icon: 'delete', tone: 'alert', leaves: true}, {id: 'pin', label: 'Pin', icon: 'keep', tone: 'sun'}],
};

function List({enabled = true, ran, opened}: {enabled?: boolean; ran: string[]; opened: string[]}) {
  const swipes = useSwipes({enabled, acts: () => ACTS, run: (key, act) => ran.push(`${key} ${act.id}`)});
  return (
    <section className="list all" {...swipes.handlers}>
      {['a', 'b'].map(key => (
        <div key={key} className="row" data-key={key} style={{height: 60}} onClick={() => opened.push(key)}>
          {swipes.tray(key)}
          <span className="from">Row {key}</span>
        </div>
      ))}
    </section>
  );
}

async function setUp(enabled = true) {
  const ran: string[] = [];
  const opened: string[] = [];
  await render(<List enabled={enabled} ran={ran} opened={opened} />);
  const row = (key: string) => document.querySelector<HTMLElement>(`.row[data-key="${key}"]`)!;
  return {ran, opened, row};
}

/**
 * A finger on `row` at x `from`, moved to `to` (and `dy` down) in steps, then lifted. Its click
 * follows, as the browser's would after a press that didn't scroll.
 */
function swipe(row: HTMLElement, from: number, to: number, dy = 0) {
  const y = row.getBoundingClientRect().y + 30;
  const fire = (type: string, x: number, down: number) => row.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerId: 5, pointerType: 'touch', button: 0, clientX: x, clientY: y + down}));
  fire('pointerdown', from, 0);
  for (const step of [0.1, 0.25, 0.5, 0.75, 1]) fire('pointermove', from + (to - from) * step, dy * step);
  fire('pointerup', to, dy);
  row.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: to, clientY: y + dy}));
}

test('a full swipe left runs the first trailing action, and the row\'s click opens nothing', async () => {
  const {ran, opened, row} = await setUp();
  swipe(row('a'), 340, 40);
  expect(ran).toEqual(['a trash']);
  expect(opened).toEqual([]);
});

test('a full swipe right runs the leading action', async () => {
  const {ran, opened, row} = await setUp();
  swipe(row('b'), 60, 300);
  expect(ran).toEqual(['b read']);
  expect(opened).toEqual([]);
});

test('a shorter swipe rests open on the buttons, the first at the edge; a button runs and closes it', async () => {
  const {ran, opened, row} = await setUp();
  swipe(row('a'), 300, 200);
  expect(ran).toEqual([]);
  const tray = page.elementLocator(row('a')).getByRole('button');
  await expect.element(tray.first()).toBeVisible();
  // Trash sits at the right edge, Pin inside it.
  const [trash, pin] = [...row('a').querySelectorAll('.sw-b')].map(button => button.getBoundingClientRect());
  expect(trash!.right).toBe(390);
  expect(pin!.right).toBe(trash!.left);
  await page.elementLocator(row('a')).getByRole('button', {name: 'Pin'}).click();
  expect(ran).toEqual(['a pin']);
  expect(opened).toEqual([]);
  await expect.element(page.elementLocator(row('a')).getByRole('button')).not.toBeInTheDocument();
});

test('a short pull settles back and runs nothing', async () => {
  const {ran, opened, row} = await setUp();
  swipe(row('a'), 300, 280);
  expect(ran).toEqual([]);
  expect(opened).toEqual([]);
  await expect.element(page.elementLocator(row('a')).getByRole('button')).not.toBeInTheDocument();
});

test('a press on another row closes the open one and opens nothing; a tap then opens', async () => {
  const {ran, opened, row} = await setUp();
  swipe(row('a'), 300, 200);
  await expect.element(page.elementLocator(row('a')).getByRole('button').first()).toBeVisible();
  swipe(row('b'), 200, 200);
  expect(opened).toEqual([]);
  await expect.element(page.elementLocator(row('a')).getByRole('button')).not.toBeInTheDocument();
  swipe(row('b'), 200, 200);
  expect(opened).toEqual(['b']);
  expect(ran).toEqual([]);
});

test('a press at the screen\'s left edge is Safari\'s Back: the row doesn\'t move', async () => {
  const {ran, row} = await setUp();
  swipe(row('a'), 8, 300);
  expect(ran).toEqual([]);
  expect(row('a').dataset.swipe).toBeUndefined();
});

test('a drag down is the scroll\'s: the row doesn\'t move', async () => {
  const {ran, row} = await setUp();
  swipe(row('a'), 200, 150, 120);
  expect(ran).toEqual([]);
  expect(row('a').dataset.swipe).toBeUndefined();
});

test('while swipes are off (Select) a drag does nothing and a tap is the row\'s', async () => {
  const {ran, opened, row} = await setUp(false);
  swipe(row('a'), 340, 40);
  expect(ran).toEqual([]);
  expect(row('a').dataset.swipe).toBeUndefined();
  expect(opened).toEqual(['a']);
});
