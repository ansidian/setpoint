// Sent's header filter (app/SentAccounts.tsx): All, then each account. Tab and Shift-Tab step All and
// the accounts with sent mail only, from wherever the filter is, an empty account included. A click
// on an empty account still turns it on. How quiet it reads is by eye.
import {useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ALL_ACCOUNTS, SentAccounts} from '../../src/app/SentAccounts.tsx';
import {stepSegment} from '../../src/ui/Segmented.tsx';

const ACCOUNTS = [
  {id: 1, label: 'Business', colour: 'warm'},
  {id: 2, label: 'Personal', colour: 'cool'},
  {id: 3, label: 'Work', colour: 'comf'},
  {id: 4, label: 'Jobs', colour: 'violet'},
  {id: 5, label: 'iCloud', colour: 'ink2'},
] as const;
// Business and Jobs have sent nothing.
const WITH_MAIL = new Set([2, 3, 5]);

function Header({withMail = WITH_MAIL, onPick = () => {}}: {withMail?: ReadonlySet<number> | null; onPick?: (account: number) => void}) {
  const [value, setValue] = useState<number>(ALL_ACCOUNTS);
  const pick = (next: number) => {
    setValue(next);
    onPick(next);
  };
  return <SentAccounts accounts={ACCOUNTS} withMail={withMail} value={value} onPick={pick} />;
}

const pressed = (name: string) => page.getByRole('button', {name, exact: true});

test('it holds All, then each account by name', async () => {
  await render(<Header />);
  expect(page.getByRole('group', {name: 'Accounts'}).getByRole('button').all().map(segment => segment.element().textContent))
    .toEqual(['All', 'Business', 'Personal', 'Work', 'Jobs', 'iCloud']);
  await expect.element(pressed('All')).toHaveAttribute('aria-pressed', 'true');
});

test('Tab and Shift-Tab step All and the accounts with sent mail, passing over the empty ones, wrapping', async () => {
  const onPick = vi.fn();
  await render(<Header onPick={onPick} />);
  await userEvent.keyboard('{Tab}{Tab}{Tab}{Tab}');
  await expect.element(pressed('All')).toHaveAttribute('aria-pressed', 'true');
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  await expect.element(pressed('iCloud')).toHaveAttribute('aria-pressed', 'true');
  expect(onPick.mock.calls).toEqual([[2], [3], [5], [ALL_ACCOUNTS], [5]]);
});

test('a click on an empty account turns it on, and Tab goes on from it to the next with mail', async () => {
  const onPick = vi.fn();
  await render(<Header onPick={onPick} />);
  await pressed('Jobs').click();
  await expect.element(pressed('Jobs')).toHaveAttribute('aria-pressed', 'true');
  await expect.element(pressed('Jobs')).toHaveAttribute('data-tip', 'Nothing sent');
  await userEvent.keyboard('{Tab}');
  await expect.element(pressed('iCloud')).toHaveAttribute('aria-pressed', 'true');
  await pressed('Business').click();
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  await expect.element(pressed('All')).toHaveAttribute('aria-pressed', 'true');
  expect(onPick.mock.calls).toEqual([[4], [5], [1], [ALL_ACCOUNTS]]);
});

test('until the accounts with sent mail are known, Tab passes over none', async () => {
  const onPick = vi.fn();
  await render(<Header withMail={null} onPick={onPick} />);
  await userEvent.keyboard('{Tab}');
  await expect.element(pressed('Business')).toHaveAttribute('aria-pressed', 'true');
  expect(onPick.mock.calls).toEqual([[1]]);
});

test.each<[string, number, 1 | -1, number]>([
  ['from All, down', 0, 1, 2],
  ['from All, up', 0, -1, 5],
  ['from the last with mail, down, wrapping', 5, 1, 0],
  ['from an empty account, down', 1, 1, 2],
  ['from an empty account, up', 4, -1, 3],
])('stepping %s', (_name, from, delta, next) => {
  expect(stepSegment([0, 1, 2, 3, 4, 5], from, delta, new Set([1, 4]))).toBe(next);
});

test('with every segment passed over but the one on, a step stays put', () => {
  expect(stepSegment([0, 1, 2], 0, 1, new Set([1, 2]))).toBe(0);
});
