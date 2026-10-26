// The editor's Reminders row (Reminders.tsx; darma SV-109, D287–D289): the presets with Custom…
// last, a date and a time picked kept as its offset and worded as its moment, refused past 4 weeks
// either side, a custom chip reopening at its moment, and a task with no date. The save reaching the
// API stays in editor.spec.ts.
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {useState} from 'react';
import {expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/editor.css';
import {RemindersRow} from '../../src/app/calendar/Reminders.tsx';
import {useMenuRef} from '../../src/ui/popover.ts';

const ZONE = SEED_TIME_ZONE;
const TODAY = '2026-10-20';
// Tue, Oct 27 at 2:00 PM in the seed's zone.
const ANCHOR = Date.parse('2026-10-27T14:00:00-07:00');

let saved: number[] = [];
let escaped = 0;

function Row({start = [], anchor = ANCHOR, countsFrom = null}: {start?: number[]; anchor?: number | null; countsFrom?: string | null}) {
  const [reminders, setReminders] = useState(start);
  const [open, setOpen] = useState(false);
  const menuRef = useMenuRef(open, () => setOpen(false));
  return (
    // Esc that reaches the editor would close it.
    <div className="editor" onKeyDown={event => event.key === 'Escape' && (escaped += 1)}>
      <div className="eg">
        <RemindersRow reminders={reminders} anchor={anchor} countsFrom={countsFrom} timeZone={ZONE} today={TODAY} menuOpen={open} menuRef={menuRef} onMenu={setOpen}
          onChange={next => {
            saved = next;
            setReminders(next);
          }} />
      </div>
    </div>
  );
}

const add = page.getByRole('button', {name: 'Add reminder'});
const items = () => [...document.querySelectorAll('[role="menu"] .menu-i')].map(item => item.textContent);
const dateField = page.getByLabelText('Reminder date');
const timeField = page.getByLabelText('Reminder time');
const chips = () => [...document.querySelectorAll('.qchip')].map(chip => chip.textContent);

test('the presets, then Custom… last; a date and a time picked are kept as their offset and read as their moment', async () => {
  saved = [];
  await render(<Row start={[10]} />);
  await add.click();
  await expect.poll(items).toEqual(['At the start', '5 min before', '15 min before', '30 min before', '1 hour before', '2 hours before', '1 day before', 'Custom…']);
  await page.getByRole('menuitem', {name: 'Custom…'}).click();
  // It opens at the item's moment, the date focused.
  await expect.element(dateField).toHaveValue('Tue, Oct 27');
  await expect.element(dateField).toHaveFocus();
  await expect.element(timeField).toHaveValue('2:00 PM');
  await userEvent.clear(dateField);
  await userEvent.type(dateField, 'oct 25');
  await userEvent.click(timeField);
  await userEvent.clear(timeField);
  await userEvent.type(timeField, '8pm{Enter}');
  await expect.element(page.getByText('1 day 18 hrs before')).toBeVisible();
  await page.getByRole('button', {name: 'Add', exact: true}).click();
  expect(saved).toEqual([10, 2520]);
  await expect.element(dateField).not.toBeInTheDocument();
  // Focus goes back to Add reminder, so the editor's keys keep working.
  await expect.element(add).toHaveFocus();
  expect(chips()).toEqual(['10 min before', 'Sun, Oct 25, 8:00 PM1 day 18 hrs before']);
});

test('past 4 weeks either side it\'s refused, saying why', async () => {
  saved = [];
  await render(<Row />);
  await add.click();
  await page.getByRole('menuitem', {name: 'Custom…'}).click();
  await userEvent.clear(dateField);
  await userEvent.type(dateField, 'dec 1{Enter}');
  await expect.element(page.getByRole('alert')).toHaveTextContent('That\'s more than 4 weeks after: a reminder goes within 4 weeks either side.');
  await expect.element(page.getByRole('button', {name: 'Add', exact: true})).toBeDisabled();
  // Back within: allowed, after the start.
  await userEvent.clear(dateField);
  await userEvent.type(dateField, 'oct 28{Enter}');
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
  await page.getByRole('button', {name: 'Add', exact: true}).click();
  expect(saved).toEqual([-1440]);
});

test('a custom chip reopens the picker at its moment, and Done puts the new one in its place', async () => {
  saved = [];
  await render(<Row start={[0, -120]} />);
  expect(chips()).toEqual(['At the start', 'Tue, Oct 27, 4:00 PM2 hrs after']);
  await page.getByRole('button', {name: 'Change reminder Tue, Oct 27, 4:00 PM, 2 hrs after'}).click();
  await expect.element(dateField).toHaveValue('Tue, Oct 27');
  await expect.element(timeField).toHaveValue('4:00 PM');
  await userEvent.click(timeField);
  await userEvent.clear(timeField);
  await userEvent.type(timeField, '5pm{Enter}');
  await page.getByRole('button', {name: 'Done'}).click();
  expect(saved).toEqual([0, -180]);
});

test('Esc closes the picker, not the editor', async () => {
  escaped = 0;
  await render(<Row />);
  await add.click();
  await page.getByRole('menuitem', {name: 'Custom…'}).click();
  await expect.element(dateField).toHaveFocus();
  // The date's own month closes first, then the picker.
  await userEvent.keyboard('{Escape}');
  await userEvent.keyboard('{Escape}');
  await expect.element(dateField).not.toBeInTheDocument();
  expect(escaped).toBe(0);
});

test('a task without a time says what Custom… counts from; one with no date has no Custom… and says why', async () => {
  const screen = await render(<Row countsFrom="Counts from 9:00 AM" />);
  await add.click();
  await expect.poll(items).toContain('Custom…Counts from 9:00 AM');
  await page.getByRole('menuitem', {name: /^Custom…/}).click();
  await expect.element(page.getByText('At the start · Counts from 9:00 AM')).toBeVisible();
  await screen.unmount();
  await render(<Row anchor={null} start={[-60]} />);
  await expect.element(page.getByText('Reminders need a date')).toBeVisible();
  expect(chips()).toEqual(['1 hr after']);
  await add.click();
  await expect.poll(items).toEqual(['At the start', '5 min before', '10 min before', '15 min before', '30 min before', '1 hour before', '2 hours before', '1 day before']);
});
