// The phone's shell and the keyboard at 375 × 812 (phone/keyboard.ts): Safari's keyboard covers the
// page rather than shortening it, so while it's up the shell ends above it, the tab bar gives way and a
// toast raised then shows above the keys; when it goes, a page Safari left slid up comes back.
import {afterEach, beforeEach, expect, onTestFinished, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {usePhoneKeyboard} from '../../src/app/phone/keyboard.ts';
import {ToastPill} from '../../src/app/ToastPill.tsx';
import {dismissToast, showToast} from '../../src/app/toast.ts';

beforeEach(async () => {
  await page.viewport(375, 812);
});

afterEach(() => dismissToast());

/** The visual viewport, faked: `show` sets the part of the screen the user sees and says so, as Safari does. */
function fakeViewport() {
  const real = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const viewport = Object.assign(new EventTarget(), {offsetTop: 0, height: 812, width: 375});
  Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
  onTestFinished(() => {
    if (real) Object.defineProperty(window, 'visualViewport', real);
  });
  return (offsetTop: number, height: number) => {
    Object.assign(viewport, {offsetTop, height});
    viewport.dispatchEvent(new Event('resize'));
  };
}

function Shell() {
  usePhoneKeyboard(true);
  return (
    <div style={{height: '100vh'}}>
      <div className="app">
        <main className="main">
          <header className="hd"><input aria-label="Search mail" /></header>
          <div className="content"><div className="list" /></div>
          <ToastPill />
        </main>
        <nav className="ph-tabs" aria-label="Tabs"><a href="/inbox" className="ph-tab">Inbox</a></nav>
      </div>
    </div>
  );
}

test('with the keyboard up the shell ends above the keys, the tab bar gives way, and a toast shows above them', async () => {
  const show = fakeViewport();
  await render(<Shell />);
  const main = document.querySelector<HTMLElement>('.main')!;
  expect(main.getBoundingClientRect().bottom).toBeLessThan(812);
  page.getByRole('textbox', {name: 'Search mail'}).element().focus();
  // The keyboard covers the bottom 360 px.
  show(0, 452);
  expect(main.getBoundingClientRect().bottom).toBeLessThanOrEqual(452);
  const tabs = document.querySelector<HTMLElement>('.ph-tabs')!;
  expect(tabs.checkVisibility()).toBe(false);
  showToast('Saved');
  const toast = page.getByRole('status');
  await expect.element(toast).toBeVisible();
  // Where it rests, not where its rise is.
  const pill = toast.element() as HTMLElement;
  expect(pill.offsetParent!.getBoundingClientRect().top + pill.offsetTop + pill.offsetHeight).toBeLessThanOrEqual(452);
  // It goes down: the shell takes the screen again, the tab bar back.
  show(0, 812);
  expect(tabs.checkVisibility()).toBe(true);
  expect(tabs.getBoundingClientRect().bottom).toBe(812);
});

test('a page Safari slid up under the keyboard comes back to the top when it goes', async () => {
  const show = fakeViewport();
  const scrollTo = vi.spyOn(window, 'scrollTo');
  onTestFinished(() => scrollTo.mockRestore());
  await render(<Shell />);
  show(140, 452);
  expect(scrollTo).not.toHaveBeenCalled();
  show(0, 812);
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
});
