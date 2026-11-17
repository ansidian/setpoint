// The selection's pane (app/SelectionPane.tsx), as Drafts gives it its tools: the heading, the front
// card and the strips behind it, each with its own ×, the page's tools and Clear. Past five strips it
// says how many more. What the pages put in it, and its keys, are the browser checks'.
import {useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {SelectionPane} from '../../src/app/SelectionPane.tsx';
import type {SelectionLine} from '../../src/app/SelectionPane.tsx';

const line = (id: number, to: string, subject: string): SelectionLine => ({id, from: <span className="from">{to}</span>, subject, name: subject});
const THREE = [line(1, 'To Sam Lee +2', 'Dinner'), line(2, 'To June Park', 'Lab notes'), line(3, 'No recipients', 'No subject')];

function Drafts({lines, onFront = () => {}, onClear = () => {}, onDiscard = () => {}}: {lines: SelectionLine[]; onFront?: (id: number) => void; onClear?: () => void; onDiscard?: () => void}) {
  const [shown, setShown] = useState(lines);
  return (
    <SelectionPane label="Selected drafts" heading={`${shown.length} drafts selected`} lines={shown} front={<p style={{height: 200}}>{shown[0]?.subject}</p>} onClear={onClear} onFront={onFront}
      onDrop={id => setShown(shown.filter(one => one.id !== id))}
      tools={<button className="tool trash" type="button" onClick={onDiscard}>Discard 2</button>} />
  );
}

// The strips, nearest the front card first.
const listed = () => [...document.querySelectorAll('.sel-strip')].map(strip => strip.textContent).reverse();

test('it heads the selection, the first in front and the rest behind, who it\'s to and its subject', async () => {
  await render(<Drafts lines={THREE} />);
  await expect.element(page.getByRole('region', {name: 'Selected drafts'}).getByRole('heading')).toHaveTextContent('3 drafts selected');
  await expect.element(page.getByRole('article', {name: 'Dinner'})).toBeInTheDocument();
  expect(listed()).toEqual(['To June ParkLab notes', 'No recipientsNo subject']);
});

test('its × takes one out, and a click on a strip asks for that one in front', async () => {
  const onFront = vi.fn();
  await render(<Drafts lines={THREE} onFront={onFront} />);
  await page.getByRole('button', {name: 'Unselect Lab notes'}).click();
  await expect.element(page.getByRole('heading')).toHaveTextContent('2 drafts selected');
  expect(listed()).toEqual(['No recipientsNo subject']);
  await page.getByRole('button', {name: 'No recipients No subject'}).click();
  expect(onFront.mock.calls).toEqual([[3]]);
});

test('the front card has its own ×, and the next one takes its place', async () => {
  await render(<Drafts lines={THREE} />);
  await page.getByRole('article', {name: 'Dinner'}).getByRole('button', {name: 'Unselect Dinner'}).click();
  await expect.element(page.getByRole('heading')).toHaveTextContent('2 drafts selected');
  await expect.element(page.getByRole('article', {name: 'Lab notes'})).toBeInTheDocument();
  expect(listed()).toEqual(['No recipientsNo subject']);
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

test('past five strips behind the front it says how many more', async () => {
  await render(<Drafts lines={Array.from({length: 11}, (_, at) => line(at + 1, 'To Sam Lee', `Draft ${at + 1}`))} />);
  expect(listed()).toEqual([2, 3, 4, 5, 6].map(n => `To Sam LeeDraft ${n}`));
  await expect.element(page.getByText('and 5 more')).toBeVisible();
});
