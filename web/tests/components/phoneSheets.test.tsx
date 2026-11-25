// The phone's shared pieces (app/phone/) on their own, at 390 × 844: the full-screen sheet (its top
// bar's Cancel or Back and action, Esc, the screen it covers, the focus it gives back), the bottom
// sheet (a choice runs and closes it; a tap outside, Esc or a long enough drag down closes it with no
// choice; a short drag doesn't) and the title menu (its rows with counts, dividers and the current
// one; a choice, Esc or a tap outside closes it, and that tap reaches nothing under it). How far a
// drag must go is logic/sheet.ts's, as a table (sheet.test.ts). Their motion is by eye.
import {useState} from 'react';
import type {ReactNode} from 'react';
import {beforeEach, expect, onTestFinished, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {BottomSheet, SheetChoice} from '../../src/app/phone/BottomSheet.tsx';
import {Sheet} from '../../src/app/phone/Sheet.tsx';
import type {SheetAction} from '../../src/app/phone/Sheet.tsx';
import {TitleMenu} from '../../src/app/phone/TitleMenu.tsx';

beforeEach(async () => {
  await page.viewport(390, 844);
});

/** An Open button, and what it opens until that closes itself. */
function Opener({children}: {children: (close: () => void) => ReactNode}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && children(() => setOpen(false))}
    </>
  );
}

const opener = page.getByRole('button', {name: 'Open', exact: true});

async function openSheet(props: {back?: string; action?: SheetAction} = {}) {
  await render(<Opener>{close => <Sheet title="New message" onClose={close} {...props}><p>What it holds</p></Sheet>}</Opener>);
  await opener.click();
  const sheet = page.getByRole('dialog', {name: 'New message'});
  await expect.element(sheet).toBeVisible();
  return sheet;
}

test('the full-screen sheet covers the screen under its top bar: Cancel, the title, the action, then what it holds', async () => {
  const send = vi.fn();
  const sheet = await openSheet({action: {label: 'Send', onClick: send}});
  // Where it rests, not where its slide is.
  const element = sheet.element() as HTMLElement;
  expect([element.offsetLeft, element.offsetTop, element.offsetWidth, element.offsetHeight]).toEqual([0, 0, 390, 844]);
  expect([...sheet.element().querySelectorAll('.ph-sheet-top > *')].map(part => part.textContent)).toEqual(['Cancel', 'New message', 'Send']);
  await expect.element(sheet.getByText('What it holds')).toBeVisible();
  await sheet.getByRole('button', {name: 'Send'}).click();
  expect(send).toHaveBeenCalledOnce();
  await expect.element(sheet).toBeVisible();
});

test('a disabled action can\'t be pressed', async () => {
  const save = vi.fn();
  const sheet = await openSheet({action: {label: 'Save', onClick: save, disabled: true}});
  await expect.element(sheet.getByRole('button', {name: 'Save'})).toBeDisabled();
});

test.each([
  ['Cancel', undefined],
  ['Back', 'Inbox'],
])('%s closes the sheet, and the focus goes back to what opened it', async (_, back) => {
  const sheet = await openSheet({back});
  const lead = sheet.getByRole('button', {name: back ?? 'Cancel'});
  if (back) expect(lead.element().classList.contains('ph-back')).toBe(true);
  await lead.click();
  await expect.element(sheet).not.toBeInTheDocument();
  expect(document.activeElement).toBe(opener.element());
});

test('Esc closes the sheet', async () => {
  const sheet = await openSheet();
  await userEvent.keyboard('{Escape}');
  await expect.element(sheet).not.toBeInTheDocument();
});

/**
 * The visual viewport, faked: the part of the screen the user sees, which the iPhone's keyboard
 * shortens without moving the page. `show` sets its top and height and says so, as Safari does.
 */
function fakeViewport() {
  const real = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const viewport = Object.assign(new EventTarget(), {offsetTop: 0, height: 844, width: 390});
  Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
  onTestFinished(() => {
    if (real) Object.defineProperty(window, 'visualViewport', real);
  });
  return (offsetTop: number, height: number) => {
    Object.assign(viewport, {offsetTop, height});
    viewport.dispatchEvent(new Event('resize'));
  };
}

// Where the sheet rests, not where its slide is.
const box = (element: HTMLElement) => [element.offsetTop, element.offsetHeight];

/** Whether the field shows in the sheet, under its top bar and above its foot. */
function inSheet(sheet: HTMLElement, field: HTMLElement) {
  const top = sheet.getBoundingClientRect().top;
  const at = field.getBoundingClientRect();
  const bar = sheet.querySelector<HTMLElement>('.ph-sheet-top')!;
  return at.top - top >= bar.offsetTop + bar.offsetHeight && at.bottom - top <= sheet.offsetHeight;
}

test('the full-screen sheet follows the part of the screen the user sees: the keyboard shortens it, its bar stays at its top, and the field with the caret stays in sight', async () => {
  const show = fakeViewport();
  await render(
    <Opener>{close => (
      <Sheet title="New message" onClose={close}>
        <div style={{height: 600}} />
        <input aria-label="Last field" />
      </Sheet>
    )}</Opener>,
  );
  await opener.click();
  const sheet = page.getByRole('dialog', {name: 'New message'}).element() as HTMLElement;
  expect(box(sheet)).toEqual([0, 844]);
  const field = page.getByRole('textbox', {name: 'Last field'}).element() as HTMLInputElement;
  field.focus({preventScroll: true});
  expect(inSheet(sheet, field)).toBe(true);
  // The keyboard comes up, and Safari slides the page 120 px up to show the caret.
  show(120, 420);
  expect(box(sheet)).toEqual([120, 420]);
  expect(sheet.hasAttribute('data-keyboard')).toBe(true);
  expect(inSheet(sheet, field)).toBe(true);
  // It goes down: the sheet takes the screen again.
  show(0, 844);
  expect(box(sheet)).toEqual([0, 844]);
  expect(sheet.hasAttribute('data-keyboard')).toBe(false);
});

test('with the keyboard up, the page under the full-screen sheet stays covered: its ground spans the whole screen, wherever Safari has slid the part the user sees', async () => {
  const show = fakeViewport();
  await render(
    <>
      <p style={{position: 'fixed', inset: 0}}>The email under it</p>
      <Opener>{close => <Sheet title="New event" onClose={close}><input aria-label="Title" /></Sheet>}</Opener>
    </>,
  );
  await opener.click();
  const sheet = page.getByRole('dialog', {name: 'New event'}).element() as HTMLElement;
  // The keyboard up, Safari has slid the page 120 px: the sheet takes the 420 px the user sees.
  show(120, 420);
  expect(box(sheet)).toEqual([120, 420]);
  const covered = (x: number, y: number) => sheet.contains(document.elementFromPoint(x, y));
  // Above it, below it (under Safari's form bar and the keys) and in it: the sheet's, never the email's.
  expect([[195, 10], [195, 100], [195, 300], [195, 560], [195, 700], [5, 843], [389, 843]].map(([x, y]) => covered(x!, y!))).toEqual(Array(7).fill(true));
  // It adds nothing to scroll.
  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(844);
});

async function openBottomSheet() {
  const chosen: string[] = [];
  await render(
    <Opener>{close => (
      <BottomSheet title="Snooze until" onClose={close}>
        <SheetChoice icon="snooze" label="Later today" detail="6:00 PM" onChoose={() => chosen.push('later')} />
        <SheetChoice icon="snooze" label="Tomorrow" detail="Thu 9:00 AM" onChoose={() => chosen.push('tomorrow')} />
      </BottomSheet>
    )}</Opener>,
  );
  await opener.click();
  const sheet = page.getByRole('dialog', {name: 'Snooze until'});
  await expect.element(sheet).toBeVisible();
  return {sheet, chosen};
}

/** A press on the sheet dragged `by` px down, then let go. */
function drag(sheet: HTMLElement, by: number) {
  const at = sheet.getBoundingClientRect();
  const fire = (type: string, y: number) => sheet.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerId: 7, button: 0, clientX: at.x + 100, clientY: y}));
  fire('pointerdown', at.y + 20);
  for (const step of [0.25, 0.5, 0.75, 1]) fire('pointermove', at.y + 20 + by * step);
  fire('pointerup', at.y + 20 + by);
}

test('the bottom sheet rises from the bottom under its title; a choice runs and closes it', async () => {
  const {sheet, chosen} = await openBottomSheet();
  const element = sheet.element() as HTMLElement;
  expect([element.offsetLeft, element.offsetWidth, element.offsetTop + element.offsetHeight]).toEqual([0, 390, 844]);
  expect(sheet.element().querySelector('.ph-bs-title')!.textContent).toBe('Snooze until');
  expect([...sheet.element().querySelectorAll('.ph-bs-i')].map(choice => choice.textContent)).toEqual(['Later today6:00 PM', 'TomorrowThu 9:00 AM']);
  await sheet.getByRole('button', {name: /^Tomorrow/}).click();
  await expect.element(sheet).not.toBeInTheDocument();
  expect(chosen).toEqual(['tomorrow']);
});

test('a tap outside the bottom sheet closes it with no choice', async () => {
  const {sheet, chosen} = await openBottomSheet();
  await page.elementLocator(document.querySelector('.ph-bs-scrim')!).click({position: {x: 195, y: 100}});
  await expect.element(sheet).not.toBeInTheDocument();
  expect(chosen).toEqual([]);
});

test('Esc closes the bottom sheet, and the focus goes back', async () => {
  const {sheet} = await openBottomSheet();
  await userEvent.keyboard('{Escape}');
  await expect.element(sheet).not.toBeInTheDocument();
  expect(document.activeElement).toBe(opener.element());
});

test('a drag down far enough closes the bottom sheet, and the click it ends in chooses nothing', async () => {
  const {sheet, chosen} = await openBottomSheet();
  const choice = sheet.element().querySelector<HTMLElement>('.ph-bs-i')!;
  drag(choice, 140);
  choice.click();
  await expect.element(sheet).not.toBeInTheDocument();
  expect(chosen).toEqual([]);
});

test('a short drag down settles the bottom sheet back, open, with nothing chosen', async () => {
  const {sheet, chosen} = await openBottomSheet();
  const choice = sheet.element().querySelector<HTMLElement>('.ph-bs-i')!;
  drag(choice, 20);
  choice.click();
  await expect.element(sheet).toBeVisible();
  expect(sheet.element().style.transform).toBe('');
  expect(chosen).toEqual([]);
  // The next tap is a choice again.
  await sheet.getByRole('button', {name: /^Later today/}).click();
  expect(chosen).toEqual(['later']);
});

/** A bottom sheet with more choices than the screen holds. */
async function openLongSheet() {
  await page.viewport(390, 500);
  await render(
    <Opener>{close => (
      <BottomSheet title="More" onClose={close}>
        {Array.from({length: 14}, (_, index) => <SheetChoice key={index} icon="snooze" label={`Choice ${index + 1}`} onChoose={() => {}} />)}
      </BottomSheet>
    )}</Opener>,
  );
  await opener.click();
  const sheet = page.getByRole('dialog', {name: 'More'});
  await expect.element(sheet).toBeVisible();
  const element = sheet.element() as HTMLElement;
  expect(element.scrollHeight).toBeGreaterThan(element.clientHeight);
  return element;
}

/** Whether a finger's vertical pan reaches `element`: nothing from it up to the sheet takes the touch for itself. */
const pans = (element: HTMLElement, sheet: HTMLElement) => {
  for (let at: HTMLElement | null = element; at; at = at === sheet ? null : at.parentElement) {
    if (!['auto', 'pan-y', 'manipulation'].some(value => getComputedStyle(at!).touchAction.includes(value))) return false;
  }
  return true;
};

test('a bottom sheet whose choices overflow the screen scrolls under a finger, and its last choice can be reached', async () => {
  const sheet = await openLongSheet();
  const last = page.getByRole('button', {name: 'Choice 14'}).element() as HTMLElement;
  expect(pans(last, sheet)).toBe(true);
  sheet.scrollTop = sheet.scrollHeight;
  // Where it rests, not where its slide is: the last choice inside the part of the sheet that shows.
  expect(last.offsetTop + last.offsetHeight - sheet.scrollTop).toBeLessThanOrEqual(sheet.clientHeight);
});

test('scrolled down, a drag down on its choices scrolls rather than moving the sheet; its title still drags it closed', async () => {
  const sheet = await openLongSheet();
  sheet.scrollTop = 200;
  drag(page.getByRole('button', {name: 'Choice 8'}).element() as HTMLElement, 140);
  await expect.element(page.getByRole('dialog', {name: 'More'})).toBeVisible();
  expect(sheet.style.transform).toBe('');
  sheet.scrollTop = 0;
  drag(sheet.querySelector<HTMLElement>('.ph-bs-title')!, 300);
  await expect.element(page.getByRole('dialog', {name: 'More'})).not.toBeInTheDocument();
});

async function openTitleMenu() {
  const chosen: string[] = [];
  const under = vi.fn();
  await render(
    <>
      <header className="hd">
        <TitleMenu title="Inbox" rows={[
          {label: 'Inbox', count: 19, checked: true, onChoose: () => chosen.push('inbox')},
          {label: 'All', onChoose: () => chosen.push('all')},
          'divider',
          {label: 'Drafts', count: 2, onChoose: () => chosen.push('drafts')},
        ]} />
      </header>
      <button type="button" style={{position: 'fixed', left: 0, top: 600, width: 390, height: 60}} onClick={under}>Under</button>
    </>,
  );
  const title = page.getByRole('button', {name: 'Inbox'});
  await expect.element(title).toHaveAttribute('aria-expanded', 'false');
  await title.click();
  const menu = page.getByRole('menu', {name: 'Inbox'});
  await expect.element(menu).toBeVisible();
  return {title, menu, chosen, under};
}

test('the title opens its menu: each row with its count, the current one checked, the divider between', async () => {
  const {title, menu} = await openTitleMenu();
  await expect.element(title).toHaveAttribute('aria-expanded', 'true');
  expect([...menu.element().children].map(row => (row.getAttribute('role') === 'separator' ? '—' : `${row.textContent}${row.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`)))
    .toEqual(['Inbox19 ✓', 'All', '—', 'Drafts2']);
  // It hangs under the title, inside the screen, where it rests rather than where it grows from.
  const pop = menu.element() as HTMLElement;
  const anchor = pop.parentElement!.getBoundingClientRect();
  const [top, left] = [anchor.top + pop.offsetTop, anchor.left + pop.offsetLeft];
  expect(top).toBeGreaterThanOrEqual(title.element().getBoundingClientRect().bottom - 4);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(left + pop.offsetWidth).toBeLessThanOrEqual(390);
});

test('a row of the title menu runs and closes it', async () => {
  const {title, menu, chosen} = await openTitleMenu();
  await menu.getByRole('menuitemradio', {name: /^Drafts/}).click();
  await expect.element(menu).not.toBeInTheDocument();
  await expect.element(title).toHaveAttribute('aria-expanded', 'false');
  expect(chosen).toEqual(['drafts']);
});

test('a tap outside the title menu closes it and reaches nothing under it', async () => {
  const {menu, chosen, under} = await openTitleMenu();
  await page.elementLocator(document.querySelector('.ph-title-catch')!).click({position: {x: 195, y: 630}});
  await expect.element(menu).not.toBeInTheDocument();
  expect(under).not.toHaveBeenCalled();
  expect(chosen).toEqual([]);
});

test('Esc closes the title menu, the focus back on the title', async () => {
  const {title, menu} = await openTitleMenu();
  await userEvent.keyboard('{Escape}');
  await expect.element(menu).not.toBeInTheDocument();
  expect(document.activeElement).toBe(title.element());
});
