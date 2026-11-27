// Safari's Screen is no EventTarget, so it has no change event to listen to: the app still starts
// there, and a move to another screen is caught on the window's focus instead.
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, expect, test, vi} from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test('without the screen\'s change event the sidebar still starts, and takes a new screen\'s fold on focus', async () => {
  Object.defineProperty(screen, 'addEventListener', {value: undefined, configurable: true});
  const here = `${screen.width}x${screen.height}`;
  localStorage.setItem('setpoint.sidebarRail', JSON.stringify({[here]: 'open', '2560x1440': 'rail'}));
  const {useRail} = await import('../../src/app/sidebarRail.ts');
  const Shown = () => <p>{useRail() ? 'rail' : 'open'}</p>;
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => root.render(<Shown />));
  expect(host.textContent).toBe('open');

  vi.spyOn(screen, 'width', 'get').mockReturnValue(2560);
  vi.spyOn(screen, 'height', 'get').mockReturnValue(1440);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).toBe('rail');
  root.unmount();
  host.remove();
  delete (screen as {addEventListener?: unknown}).addEventListener;
});
