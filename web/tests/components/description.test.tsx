// An item's description on screen (SV-264, D546, D547): the floating detail's row (formatted, drawn
// from the short list of formats and never from the provider's markup; folded at 6 lines under More)
// and the editor's Description field (the bar while it has focus, an event's Underline and a task's
// none, typing, a format, a link, a paste read through the same list). The reading and writing of
// each format is description.test.ts's table; the save reaching the API stays in editor.spec.ts.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {useLayoutEffect} from 'react';
import type {ReactNode} from 'react';
import {expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/detail/detail.css';
import '../../src/app/calendar/editor.css';
import {DescriptionField, linkTarget} from '../../src/app/calendar/DescriptionField.tsx';
import {DetailContent} from '../../src/app/calendar/detail/DetailContent.tsx';
import {readHtml, readMarkdown, writeHtml, writeMarkdown} from '../../src/logic/description.ts';
import type {Block} from '../../src/logic/description.ts';
import {ICONS} from '../../src/ui/glyphs.ts';

const CALENDAR: CalendarOut = {id: 2, provider: 'google', account_id: 1, name: 'Classes', colour: 'good', position: 1, visible: true, listed: true, writable: true, command: null};
const GOOGLE = '<b>Midterm review</b>, library room 3B<br><i>Bring</i> last week\'s <u>problem set</u><br><ol><li>Recursion</li><li>Big O</li></ol><ul><li>Laptop</li></ul><br><a href="https://classes.example.edu/cs101/midterm">Practice exam</a>';
const LONG = Array.from({length: 30}, (_, line) => `Line ${line + 1} of the fair's notes`).join('\n');

function item(fields: Partial<ItemOut>): ItemOut {
  return {
    key: '6', id: 6, calendar_id: 2, kind: 'event', title: 'Study group', time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: ['Sam Lee'], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null,
    all_day: false, starts_at: '2026-10-10T01:30:00.000Z', ends_at: '2026-10-10T03:30:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, ...fields,
  };
}

async function card(one: ItemOut) {
  return render(
    <div className="fd" role="dialog" aria-label={one.title} style={{position: 'relative'}}>
      <div className="card float"><div className="fd-body"><div className="fd-layer in">
        <DetailContent target={{item: one, date: '2026-10-09', calendar: CALENDAR}} timeZone={SEED_TIME_ZONE} onClose={() => {}} onEdit={() => {}} />
      </div></div></div>
    </div>,
  );
}

const facts = () => [...document.querySelectorAll('.card-b .fact')].map(fact => fact.className);
const shown = () => document.querySelector('.fd-desc')!;

test('the detail: a description sits after who\'s coming, under the notes glyph, formatted as Google\'s editor wrote it', async () => {
  await card(item({description: GOOGLE}));
  await expect.element(page.getByText('Midterm review')).toBeVisible();
  expect(facts()).toEqual(['fact', 'fact description', 'fact cal']);
  expect(document.querySelector('.fact.description .icon path')!.getAttribute('d')).toBe(ICONS.notes);
  expect(shown().querySelector('b')!.textContent).toBe('Midterm review');
  expect(shown().querySelector('i')!.textContent).toBe('Bring');
  expect(shown().querySelector('u')!.textContent).toBe('problem set');
  expect([...shown().querySelectorAll('ol li')].map(line => line.textContent)).toEqual(['Recursion', 'Big O']);
  expect([...shown().querySelectorAll('ul li')].map(line => line.textContent)).toEqual(['Laptop']);
  const link = page.getByRole('link', {name: 'Practice exam'});
  await expect.element(link).toHaveAttribute('href', 'https://classes.example.edu/cs101/midterm');
  await expect.element(link).toHaveAttribute('target', '_blank');
  await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('the detail: a nested list sits inside its item, as Google Calendar draws it (SV-268)', async () => {
  await card(item({description: '<ul><li><b>Parking</b>:<ul><li>On the street</li><li>The lot behind</li></ul></li><li>Bring a pen</li></ul>'}));
  await expect.element(page.getByText('On the street')).toBeVisible();
  const outer = [...shown().querySelectorAll(':scope > ul > li')];
  expect(outer.map(line => line.firstChild!.textContent)).toEqual(['Parking', 'Bring a pen']);
  expect([...outer[0]!.querySelectorAll(':scope > ul > li')].map(line => line.textContent)).toEqual(['On the street', 'The lot behind']);
});

test('the detail: none has no row; a task\'s is read as Markdown, an event\'s never is', async () => {
  const none = await card(item({}));
  await expect.element(page.getByText('Sam Lee')).toBeVisible();
  expect(facts()).toEqual(['fact', 'fact cal']);
  await none.unmount();
  const task = await card(item({kind: 'task', due_date: '2026-10-08', starts_at: null, ends_at: null, all_day: true, attendees: [], project: 'Home', description: '**Due by Oct 31**\n\n1. Smog check\n\n<b>not markup</b>'}));
  await expect.element(page.getByText('Due by Oct 31')).toBeVisible();
  expect(shown().querySelector('b')!.textContent).toBe('Due by Oct 31');
  expect([...shown().querySelectorAll('ol li')].map(line => line.textContent)).toEqual(['Smog check']);
  await expect.element(page.getByText('<b>not markup</b>')).toBeVisible();
  await task.unmount();
  await card(item({description: '**stars** stay stars'}));
  await expect.element(page.getByText('**stars** stay stars')).toBeVisible();
  // Short enough to show whole: no More.
  expect(page.getByRole('button', {name: 'More'}).elements()).toHaveLength(0);
});

test('the detail: markup outside the list is never drawn: no script, image, frame, style or handler, and a link Setpoint won\'t open is only its text', async () => {
  (window as unknown as {ran?: boolean}).ran = false;
  await card(item({description: 'Hello<script>window.ran = true</script><img src="https://example.com/t.gif" onerror="window.ran = true"><iframe src="https://example.com"></iframe><b onclick="window.ran = true" style="position:fixed">bold</b> <a href="javascript:window.ran = true">tap</a>'}));
  await expect.element(page.getByText('bold')).toBeVisible();
  expect(shown().querySelectorAll('script, img, iframe, [onclick], [style], a')).toHaveLength(0);
  expect(shown().textContent).toBe('Hellobold tap');
  await userEvent.click(page.getByText('tap'));
  expect((window as unknown as {ran?: boolean}).ran).toBe(false);
});

test('the detail: a long description folds to 6 lines under More, which opens it in place to 320 px with the rest inside; Less folds it again', async () => {
  await card(item({description: LONG}));
  const more = page.getByRole('button', {name: 'More'});
  await expect.element(more).toHaveAttribute('aria-expanded', 'false');
  expect(shown().clientHeight).toBe(120);
  expect(shown().scrollHeight).toBeGreaterThan(320);
  await more.click();
  const less = page.getByRole('button', {name: 'Less'});
  await expect.element(less).toHaveAttribute('aria-expanded', 'true');
  expect(shown().clientHeight).toBe(320);
  expect(getComputedStyle(shown()).overflowY).toBe('auto');
  // The rows after it stay in the card, under the opened text.
  const calendar = document.querySelector('.fact.cal')!.getBoundingClientRect();
  expect(calendar.top).toBeGreaterThanOrEqual(less.element().getBoundingClientRect().bottom);
  await less.click();
  await expect.element(more).toBeVisible();
  expect(shown().clientHeight).toBe(120);
});

/** A parent that reads the card's height in its own layout effect, as the floating detail's motion does before it places and glides the card. */
function Measured({heights, children}: {heights: number[]; children: ReactNode}) {
  useLayoutEffect(() => {
    heights.push(document.querySelector<HTMLElement>('.fd-layer')!.offsetHeight);
  });
  return <>{children}</>;
}

test('the detail: a description\'s row has its final height when the card is first drawn, More included, so the card is measured once (SV-267)', async () => {
  for (const description of [LONG, 'One line']) {
    const heights: number[] = [];
    const one = item({description});
    const drawn = await render(
      <Measured heights={heights}>
        <div className="fd" style={{position: 'relative'}}><div className="card float"><div className="fd-body"><div className="fd-layer in">
          <DetailContent target={{item: one, date: '2026-10-09', calendar: CALENDAR}} timeZone={SEED_TIME_ZONE} onClose={() => {}} onEdit={() => {}} />
        </div></div></div></div>
      </Measured>,
    );
    await expect.element(page.getByText('Sam Lee')).toBeVisible();
    // The first reading is the height it keeps: nothing is added to the card after it's measured.
    expect(heights[0]).toBe(document.querySelector<HTMLElement>('.fd-layer')!.offsetHeight);
    expect(page.getByRole('button', {name: 'More'}).elements()).toHaveLength(description === LONG ? 1 : 0);
    await drawn.unmount();
  }
});

// ---- The editor's field ----

let read: Block[] | null = null;
let escaped = 0;
let submitted = 0;

async function field(kind: 'event' | 'task', blocks: Block[] = [], note: string | null = null) {
  read = null;
  escaped = 0;
  submitted = 0;
  return render(
    // Esc or Enter that reaches the editor would close or save it.
    <div className="editor" style={{width: 400}} onKeyDown={event => {
      if (event.key === 'Escape') escaped += 1;
      if (event.key === 'Enter') submitted += 1;
    }}>
      <div className="eg">
        <span className="icon" />
        <DescriptionField blocks={blocks} kind={kind} note={note} onChange={blocks => (read = blocks)} />
      </div>
    </div>,
  );
}

const box = page.getByRole('textbox', {name: 'Description'});
const bar = () => [...document.querySelectorAll('.desc-bar button')].map(button => button.getAttribute('aria-label'));
const selectAll = () => userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');

test('the field: empty it says "Add description" on one line; its bar shows only while it has focus, with Underline for an event', async () => {
  await field('event');
  await expect.element(box).toHaveAttribute('data-placeholder', 'Add description');
  await expect.element(box).toHaveAttribute('data-empty');
  expect(box.element().clientHeight).toBe(34);
  expect(bar()).toEqual([]);
  await box.click();
  await expect.element(page.getByRole('toolbar', {name: 'Formatting'})).toBeVisible();
  expect(bar()).toEqual(['Bold', 'Italic', 'Underline', 'Numbered list', 'Bulleted list', 'Link']);
  // Under the text, so the text doesn't move when it's clicked into.
  expect(document.querySelector('.desc-bar')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.element().getBoundingClientRect().bottom);
  await userEvent.keyboard('Bring the form');
  expect(read).toEqual([{type: 'paragraph', runs: [{text: 'Bring the form', marks: [], href: null}]}]);
  await expect.element(box).not.toHaveAttribute('data-empty');
});

test('the field: a task has no Underline, in the bar or by its key', async () => {
  await field('task');
  await box.click();
  await expect.element(page.getByRole('button', {name: 'Bold'})).toBeVisible();
  expect(bar()).toEqual(['Bold', 'Italic', 'Numbered list', 'Bulleted list', 'Link']);
  await userEvent.keyboard('Pay rent');
  await selectAll();
  await userEvent.keyboard('{ControlOrMeta>}u{/ControlOrMeta}');
  await page.getByRole('button', {name: 'Italic'}).click();
  expect(writeMarkdown(read!)).toBe('*Pay rent*');
});

test('the field: it opens on the item\'s description as it reads, a format from the bar applies to the selection and lights its button, and a list is a list', async () => {
  const opened = await field('event', readHtml(GOOGLE).blocks);
  await expect.element(page.getByText('Midterm review')).toBeVisible();
  expect(readHtml(box.element().innerHTML, {literal: true}).blocks).toEqual(readHtml(GOOGLE).blocks);
  await opened.unmount();
  await field('event');
  await box.click();
  await userEvent.keyboard('Agenda');
  await selectAll();
  const bold = page.getByRole('button', {name: 'Bold'});
  await bold.click();
  expect(writeHtml(read!)).toBe('<b>Agenda</b>');
  await expect.element(bold).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Numbered list'}).click();
  expect(writeHtml(read!)).toBe('<ol><li><b>Agenda</b></li></ol>');
  await expect.element(page.getByRole('button', {name: 'Numbered list'})).toHaveAttribute('aria-pressed', 'true');
});

test('the field: Link asks for an address under the text; Enter there links the selection and stays in the editor, a bare host goes by https, and none removes the link', async () => {
  await field('event');
  await box.click();
  await userEvent.keyboard('Practice exam');
  await selectAll();
  await page.getByRole('button', {name: 'Link'}).click();
  const address = page.getByRole('textbox', {name: 'Link address'});
  await expect.element(address).toHaveFocus();
  await userEvent.keyboard('classes.example.edu/midterm{Enter}');
  expect(writeHtml(read!)).toBe('<a href="https://classes.example.edu/midterm">Practice exam</a>');
  expect(submitted).toBe(0);
  await expect.element(box).toHaveFocus();
  // Again on the link: its address is there to change, and Esc leaves it as it was without closing the editor.
  await selectAll();
  await page.getByRole('button', {name: 'Link'}).click();
  await expect.element(address).toHaveValue('https://classes.example.edu/midterm');
  await userEvent.keyboard('{Escape}');
  expect(escaped).toBe(0);
  expect(writeHtml(read!)).toBe('<a href="https://classes.example.edu/midterm">Practice exam</a>');
  await selectAll();
  await page.getByRole('button', {name: 'Link'}).click();
  await address.fill('');
  await page.getByRole('button', {name: 'Remove'}).click();
  expect(writeHtml(read!)).toBe('Practice exam');
});

test.each<[string, string | null]>([
  ['https://example.com/a', 'https://example.com/a'], ['example.com/a?b=1', 'https://example.com/a?b=1'], ['mailto:sam@example.org', 'mailto:sam@example.org'],
  ['javascript:alert(1)', null], ['not a link', null], ['', null],
])('the field: the address "%s" links to %s', (typed, target) => {
  expect(linkTarget(typed)).toBe(target);
});

test('the field: a paste goes in read through the list: its bold and link stay, its script, image and styles don\'t; a task\'s loses its underline', async () => {
  const paste = (html: string) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'plain');
    box.element().dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
  };
  (window as unknown as {ran?: boolean}).ran = false;
  const first = await field('event');
  await box.click();
  paste('<meta charset="utf-8"><b style="color:red">Bring</b> <u>ID</u><script>window.ran = true</script><img src="https://example.com/t.gif" onerror="window.ran = true"> <a href="https://example.com/map">map</a>');
  await expect.element(page.getByText('Bring')).toBeVisible();
  expect(box.element().querySelectorAll('script, img, [style], [onerror]')).toHaveLength(0);
  expect(writeHtml(read!)).toBe('<b>Bring</b> <u>ID</u> <a href="https://example.com/map">map</a>');
  expect((window as unknown as {ran?: boolean}).ran).toBe(false);
  await first.unmount();
  await field('task');
  await box.click();
  paste('<b>Bring</b> <u>ID</u>');
  await expect.element(page.getByText('Bring')).toBeVisible();
  expect(writeMarkdown(read!)).toBe('**Bring** ID');
});

test('the field: a task\'s Todoist formats it has no button for are kept through an edit; its note shows under it when given', async () => {
  const source = '# Plan\n> Said so\n~~old~~ and `code`';
  await field('task', readMarkdown(source).blocks, 'Saving drops formatting Setpoint can\'t show');
  await expect.element(page.getByText('Saving drops formatting Setpoint can\'t show')).toBeVisible();
  await box.click();
  document.getSelection()!.selectAllChildren(box.element());
  document.getSelection()!.collapseToStart();
  await userEvent.keyboard('The ');
  expect(writeMarkdown(read!)).toBe('# The Plan\n> Said so\n~~old~~ and `code`');
});

test('the field: it grows with its text to 8 lines, then keeps its height with the rest inside', async () => {
  await field('event', readHtml(LONG).blocks);
  await expect.element(page.getByText('Line 1 of the fair\'s notes')).toBeVisible();
  expect(box.element().clientHeight).toBe(174);
  expect(box.element().scrollHeight).toBeGreaterThan(174);
  expect(getComputedStyle(box.element()).overflowY).toBe('auto');
});
