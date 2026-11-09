// The right-click menu's rows (ContextMenu.tsx, DESIGN.md #248, D447): a disabled item reads as
// unavailable, without its key hint, and a note (a read-only event's reason) is a quiet line the
// cursor passes over and a click doesn't run. Which items a read-only event's menu offers stays in
// detail.spec.ts, on the seed's Veterans Day. An event's colours are swatches in the menu itself
// (#325), a row the cursor passes over. How the rows and swatches look is by eye (D477).
import type {MouseEvent} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import type {MenuAction} from '../../src/app/ContextMenu.tsx';
import {ContextMenu, closeContextMenu, openContextMenu} from '../../src/app/ContextMenu.tsx';
import '../../src/app/calendar/detail/detail.css';
import {ColourPanel} from '../../src/app/calendar/detail/DetailContent.tsx';

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
  await userEvent.keyboard('{ArrowUp}');
  expect(link!.classList.contains('cur')).toBe(true);
  expect(note!.classList.contains('cur')).toBe(false);
  await userEvent.click(note!, {force: true});
  expect(run).not.toHaveBeenCalled();
  await expect.element(page.getByRole('menu')).toBeVisible();
  closeContextMenu();
  await screen.unmount();
});

test('an inline row sits in the menu between its hairlines: the cursor passes over it, and a pick in it closes the menu', async () => {
  const picked = vi.fn();
  const screen = await opened([
    {id: 'copy', group: 'copy', label: 'Copy', icon: 'content_copy', run: () => {}},
    {id: 'colour', group: 'colour', label: 'Colour', icon: 'contrast', run: () => {},
      inline: close => <ColourPanel item={null} calendar={undefined} onPick={colour => {
        close();
        picked(colour);
      }} />},
    {id: 'delete', group: 'delete', label: 'Delete', icon: 'delete', run: () => {}},
  ]);
  expect(rows().map(row => row.textContent)).toEqual(['Copy', 'Delete']);
  expect(document.querySelectorAll('.ctx-menu .menu-inline .swatch')).toHaveLength(10);
  expect(document.querySelectorAll('.ctx-menu .menu-sep')).toHaveLength(2);
  await userEvent.keyboard('{ArrowDown}');
  expect(rows()[1]!.classList.contains('cur')).toBe(true);
  await userEvent.click(page.getByRole('radio', {name: 'warm'}));
  expect(picked).toHaveBeenCalledWith('warm');
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  await screen.unmount();
});
