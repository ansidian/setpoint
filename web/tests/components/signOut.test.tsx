// Sign out at Settings' foot (SignOut.tsx) on its own: it asks in place of itself, with focus on the
// question. On the desktop Esc cancels it and Enter answers it, the page seeing neither key, while a
// held key's repeat, a modifier or a field's own Enter and Esc don't answer. Cancel puts focus back on
// Sign out. Answered, Settings closes and the sign-out goes to the server. ⌘K's ask opens Settings
// asking, and another page cancels it. The phone asks the same way but leaves the keys alone. The
// server is faked at `fetch`. Its look is by eye, and the journeys are the browser's (palette.spec.ts,
// passkey.spec.ts, phoneShell.spec.ts).
import {afterEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {SignOut} from '../../src/app/settings/SignOut.tsx';
import {askSignOut, closeSettings, openSettings, useSettingsPage, useSigningOut} from '../../src/app/settings/store.ts';

const question = page.getByRole('group', {name: 'Sign out of Setpoint?'});
const trigger = page.getByRole('button', {name: 'Sign out', exact: true});

/** The sign-outs the page sent. */
function server() {
  const sent: string[] = [];
  vi.spyOn(window, 'fetch').mockImplementation(async input => {
    sent.push(String(input));
    return new Response(null, {status: 204});
  });
  return sent;
}

/** A key pressed on what has focus, as the keyboard does, answering whether the page saw it. */
function press(key: string, on: Element = document.activeElement ?? document.body, init: KeyboardEventInit = {}) {
  let pageSaw = false;
  const seen = () => { pageSaw = true; };
  window.addEventListener('keydown', seen);
  on.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...init}));
  window.removeEventListener('keydown', seen);
  return pageSaw;
}

/** Settings' page and whether it's asking, as the modal around the foot reads them. */
function Around({phone = false}: {phone?: boolean}) {
  const settings = useSettingsPage();
  const asking = useSigningOut();
  return <div data-page={settings ?? ''} data-asking={String(asking)}><SignOut phone={phone} /></div>;
}
const around = () => document.querySelector<HTMLElement>('[data-page]')!.dataset;

afterEach(() => {
  closeSettings();
  vi.restoreAllMocks();
});

test('Sign out asks in place of itself; Esc cancels it unseen by the page, focus back on Sign out', async () => {
  const sent = server();
  openSettings('mail');
  await render(<Around />);
  await trigger.click();
  await expect.element(question).toHaveFocus();
  await expect.element(trigger).not.toBeInTheDocument();
  expect(press('Escape')).toBe(false);
  await expect.element(trigger).toHaveFocus();
  expect(around().page).toBe('mail');
  expect(sent).toEqual([]);
});

test('Enter answers it once, not on a held key\'s repeat or with a modifier; Settings closes and the sign-out is sent', async () => {
  const sent = server();
  openSettings('mail');
  await render(<Around />);
  await trigger.click();
  await expect.element(question).toHaveFocus();
  expect(press('Enter', document.activeElement!, {repeat: true})).toBe(true);
  expect(press('Enter', document.activeElement!, {metaKey: true})).toBe(true);
  await expect.element(question).toBeInTheDocument();
  expect(press('Enter')).toBe(false);
  await vi.waitFor(() => expect(around().page).toBe(''));
  await vi.waitFor(() => expect(sent).toEqual(['/api/auth/sign-out']));
});

test('a field keeps its own Enter and Esc while it asks', async () => {
  const sent = server();
  openSettings('mail');
  await render(<Around />);
  await trigger.click();
  await expect.element(question).toBeInTheDocument();
  const field = document.body.appendChild(document.createElement('input'));
  expect(press('Enter', field)).toBe(true);
  expect(press('Escape', field)).toBe(true);
  await expect.element(question).toBeInTheDocument();
  expect(sent).toEqual([]);
  field.remove();
});

test('Cancel and Sign out answer it by click', async () => {
  const sent = server();
  openSettings('mail');
  await render(<Around />);
  await trigger.click();
  await question.getByRole('button', {name: /Cancel/}).click();
  await expect.element(trigger).toBeInTheDocument();
  expect(sent).toEqual([]);
  await trigger.click();
  await question.getByRole('button', {name: /Sign out/}).click();
  await vi.waitFor(() => expect(sent).toEqual(['/api/auth/sign-out']));
});

test('⌘K\'s ask opens Settings asking, keeps an open page, and another page cancels it', async () => {
  server();
  await render(<Around />);
  askSignOut();
  await expect.element(question).toBeInTheDocument();
  expect(around().page).toBe('accounts');
  openSettings('mail');
  await expect.element(trigger).toBeInTheDocument();
  askSignOut();
  await expect.element(question).toBeInTheDocument();
  expect(around().page).toBe('mail');
  closeSettings();
  await expect.element(trigger).toBeInTheDocument();
  expect(around().asking).toBe('false');
});

test('the phone asks the same way and leaves the keys to the page', async () => {
  const sent = server();
  await render(<Around phone />);
  await trigger.click();
  await expect.element(question).toBeInTheDocument();
  expect(press('Enter')).toBe(true);
  expect(press('Escape')).toBe(true);
  await expect.element(question).toBeInTheDocument();
  await question.getByRole('button', {name: 'Sign out'}).click();
  await vi.waitFor(() => expect(sent).toEqual(['/api/auth/sign-out']));
});
