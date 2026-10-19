// An event's days in its Date field (Pickers.tsx › DateField with a range, SV-29): one sheet, a
// first click and then a last, either side of it (#103), the band between following the pointer in
// `cool` (#104), and typed too. The editor's own fields and its save stay in editor.spec.ts.
import {useState} from 'react';
import {expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/editor.css';
import {DateField} from '../../src/app/calendar/Pickers.tsx';
import {dayTitle} from '../../src/logic/calendar.ts';
import {parseDay, parseDays} from '../../src/logic/compose.ts';
import {colour} from './colour.ts';

const TODAY = '2026-10-09';

/** The field as the editor holds it for an event: its first day and its last. */
function Days({from: first, to: last}: {from: string; to: string}) {
  const [days, setDays] = useState({from: first, to: last});
  return (
    <div className="editor">
      <DateField className="date" label="Date" value={days.from} today={TODAY}
        shown={days.from === days.to ? dayTitle(days.from) : `${dayTitle(days.from)} – ${dayTitle(days.to)}`}
        read={text => parseDay(text, TODAY)} onValue={date => setDays({from: date, to: date})}
        range={{to: days.to, read: text => parseDays(text, TODAY), onRange: (from, to) => setDays({from, to})}} />
    </div>
  );
}

const field = page.getByLabelText('Date', {exact: true});
const sheet = (which: 'first' | 'last') => page.getByRole('dialog', {name: `Date: pick the ${which} day`});
const day = (date: string) => page.getByRole('dialog').getByRole('button', {name: date, exact: true});
const band = () => [...document.querySelectorAll('.datepop .mini .in')].map(element => element.textContent);
/** `cool` at `percent`, as the page mixes it (a fill computes as a colour does). */
const cool = (percent: number) => colour(`color-mix(in oklch, var(--cool) ${percent}%, transparent)`);

test('a first click, then a last: the sheet asks for each, Sunday first, the band following the pointer to the day picked', async () => {
  await render(<Days from="2026-10-09" to="2026-10-09" />);
  await field.click();
  await expect.element(sheet('first')).toBeVisible();
  expect([...document.querySelectorAll('.datepop .mini .h')].map(head => head.textContent)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  await day('2026-10-13').click();
  await expect.element(sheet('last')).toBeVisible();
  await expect.element(field).toHaveValue('Tue, Oct 13');
  await userEvent.hover(day('2026-10-16'));
  await expect.poll(band).toEqual(['13', '14', '15', '16']);
  await day('2026-10-16').click();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await expect.element(field).toHaveValue('Tue, Oct 13 – Fri, Oct 16');
});

test('the other end may come before the first: the band runs back with the pointer, `cool` at 28% between, 50% at an end and 60% under the pointer, and the earlier day starts it', async () => {
  await render(<Days from="2026-10-13" to="2026-10-16" />);
  await field.click();
  await day('2026-10-16').click();
  await expect.element(sheet('last')).toBeVisible();
  await userEvent.hover(day('2026-10-13'));
  await expect.poll(band).toEqual(['13', '14', '15', '16']);
  const fills = () => [...document.querySelectorAll('.datepop .mini .in')].map(element => getComputedStyle(element).backgroundColor);
  await expect.poll(fills).toEqual([cool(60), cool(28), cool(28), cool(50)]);
  await day('2026-10-13').click();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await expect.element(field).toHaveValue('Tue, Oct 13 – Fri, Oct 16');
});

test('typed: two days read as both ends; a lone day keeps the length; what doesn\'t read goes back', async () => {
  await render(<Days from="2026-10-13" to="2026-10-16" />);
  await field.fill('oct 20 - oct 22');
  await userEvent.keyboard('{Enter}');
  await expect.element(field).toHaveValue('Tue, Oct 20 – Thu, Oct 22');
  await field.fill('oct 26');
  await userEvent.keyboard('{Enter}');
  await expect.element(field).toHaveValue('Mon, Oct 26 – Wed, Oct 28');
  await field.fill('not a day');
  await userEvent.keyboard('{Enter}');
  await expect.element(field).toHaveValue('Mon, Oct 26 – Wed, Oct 28');
});

test('from the keys: ↓ moves the cursor a week, Enter picks the first day, Esc closes the sheet and leaves the days be', async () => {
  await render(<Days from="2026-10-13" to="2026-10-16" />);
  await field.click();
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(day('2026-10-20')).toHaveClass('cur');
  await userEvent.keyboard('{Enter}');
  await expect.element(sheet('last')).toBeVisible();
  await expect.element(field).toHaveValue('Tue, Oct 20');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});
