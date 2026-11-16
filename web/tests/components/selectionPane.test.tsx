// The selection's pane (app/SelectionPane.tsx), as Drafts gives it its tools: the heading, each
// selected one in order with its own ×, a click on one opening it, the page's tools and Clear. Past
// eight it says how many more. What the pages put in it, and its keys, are the browser checks'.
import {useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {SelectionPane} from '../../src/app/SelectionPane.tsx';
import type {SelectionLine} from '../../src/app/SelectionPane.tsx';

const line = (id: number, to: string, subject: string): SelectionLine => ({id, from: <span className="from">{to}</span>, subject, name: subject});
const THREE = [line(1, 'To Sam Lee +2', 'Dinner'), line(2, 'To June Park', 'Lab notes'), line(3, 'No recipients', 'No subject')];

function Drafts({lines, onOpen = () => {}, onClear = () => {}, onDiscard = () => {}}: {lines: SelectionLine[]; onOpen?: (id: number) => void; onClear?: () => void; onDiscard?: () => void}) {
  const [shown, setShown] = useState(lines);
  return (
    <SelectionPane label="Selected drafts" heading={`${shown.length} drafts selected`} lines={shown} onClear={onClear} onOpen={onOpen}
      onDrop={id => setShown(shown.filter(one => one.id !== id))}
      tools={<button className="tool trash" type="button" onClick={onDiscard}>Discard 2</button>} />
  );
}

const listed = () => page.getByRole('listitem').all().map(item => item.element().textContent);

test('it heads the selection and lists each in order, who it\'s to and its subject', async () => {
  await render(<Drafts lines={THREE} />);
  await expect.element(page.getByRole('region', {name: 'Selected drafts'}).getByRole('heading')).toHaveTextContent('3 drafts selected');
  expect(listed()).toEqual(['To Sam Lee +2Dinner', 'To June ParkLab notes', 'No recipientsNo subject']);
});

test('its × takes one out, and a click on a line opens that one', async () => {
  const onOpen = vi.fn();
  await render(<Drafts lines={THREE} onOpen={onOpen} />);
  await page.getByRole('button', {name: 'Unselect Lab notes'}).click();
  await expect.element(page.getByRole('heading')).toHaveTextContent('2 drafts selected');
  expect(listed()).toEqual(['To Sam Lee +2Dinner', 'No recipientsNo subject']);
  await page.getByRole('button', {name: 'To Sam Lee +2 Dinner'}).click();
  expect(onOpen.mock.calls).toEqual([[1]]);
});

test('the page\'s tools come first, then Clear', async () => {
  const onClear = vi.fn();
  const onDiscard = vi.fn();
  await render(<Drafts lines={THREE} onClear={onClear} onDiscard={onDiscard} />);
  expect(page.getByRole('region').element().querySelectorAll('.rd-tools .tool').length).toBe(2);
  await page.getByRole('button', {name: 'Discard 2'}).click();
  await page.getByRole('button', {name: /Clear/}).click();
  expect([onDiscard.mock.calls.length, onClear.mock.calls.length]).toEqual([1, 1]);
});

test('past eight it lists eight and says how many more', async () => {
  await render(<Drafts lines={Array.from({length: 11}, (_, at) => line(at + 1, 'To Sam Lee', `Draft ${at + 1}`))} />);
  expect(listed().length).toBe(9);
  expect(listed().at(-1)).toBe('and 3 more');
});
