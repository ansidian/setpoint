// The sidebar's fold and the reading pane's width are kept per screen (screen.ts). Moving the
// window to another screen, its size unchanged, takes that screen's choice without waiting for
// something else to draw.
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, expect, test, vi} from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test('moving to another screen folds or opens the sidebar as that screen keeps it, on the screen\'s own change', async () => {
  // The test page is 1280 wide, where the sidebar starts as the rail; this screen opened it.
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
  await act(async () => (screen as Screen & EventTarget).dispatchEvent(new Event('change')));
  expect(host.textContent).toBe('rail');

  // Back on the first screen, a browser that fires nothing on the move catches up when the window takes focus.
  vi.restoreAllMocks();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.textContent).toBe('open');
  root.unmount();
  host.remove();
});
