// The right-click menu's rows (ContextMenu.tsx, DESIGN.md #248, D447): a disabled item reads as
// unavailable, in `ink3` without its key hint, and a note (a read-only event's reason) is a quiet
// line the cursor passes over and a click doesn't run. Which items a read-only event's menu offers
// stays in detail.spec.ts, on the seed's Veterans Day.
import type {MouseEvent} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import type {MenuAction} from '../../src/app/ContextMenu.tsx';
import {ContextMenu, closeContextMenu, openContextMenu} from '../../src/app/ContextMenu.tsx';
import {colour} from './colour.ts';

/** A row to right-click, opening `actions`, beside the menu. */
async function opened(actions: MenuAction[]) {
  const screen = await render(
    <>
      <div className="row" style={{width: 200, height: 40}} onContextMenu={(event: MouseEvent<HTMLDivElement>) => openContextMenu(event, event.currentTarget, actions)}>Row</div>
      <ContextMenu />
    </>,
  );
  await userEvent.click(page.getByText('Row'), {button: 'right'});
  await expect.element(page.getByRole('menu')).toBeVisible();
  return screen;
}

const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu .menu-i')];

test('a disabled item is drawn in ink3 without its key hint, beside an enabled one that keeps its hint', async () => {
  const screen = await opened([
    {id: 'edit', label: 'Edit', icon: 'edit', hint: 'E', run: () => {}},
    {id: 'delete', label: 'Delete', icon: 'delete', hint: 'Del', danger: true, disabled: true, run: () => {}},
  ]);
  expect(rows().map(row => [row.textContent, row.disabled])).toEqual([['EditE', false], ['Delete', true]]);
  expect(getComputedStyle(rows()[1]!).color).toBe(colour('var(--ink3)'));
  closeContextMenu();
  await screen.unmount();
});

test('a note is a quiet line: the cursor starts past it, ↑ doesn\'t land on it, and a click on it runs nothing and keeps the menu', async () => {
  const run = vi.fn();
  const screen = await opened([
    {id: 'read-only', label: 'This calendar is read-only', icon: 'lock', note: true, run},
    {id: 'open-link', label: 'Open example.com', icon: 'open_in_new', hint: 'O', run: () => {}},
  ]);
  const [note, link] = rows();
  expect([note!.textContent, link!.textContent]).toEqual(['This calendar is read-only', 'Open example.comO']);
  expect(link!.classList.contains('cur')).toBe(true);
  // At full strength in ink3, unlike a disabled item.
  expect([getComputedStyle(note!).color, getComputedStyle(note!).opacity]).toEqual([colour('var(--ink3)'), '1']);
  await userEvent.keyboard('{ArrowUp}');
  expect(link!.classList.contains('cur')).toBe(true);
  expect(note!.classList.contains('cur')).toBe(false);
  await userEvent.click(note!, {force: true});
  expect(run).not.toHaveBeenCalled();
  await expect.element(page.getByRole('menu')).toBeVisible();
  closeContextMenu();
  await screen.unmount();
});
