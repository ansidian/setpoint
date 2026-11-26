// An attachment's preview on the desktop (Attachments.tsx): it opens expanded over the window above
// a scrim, Shrink and Expand switch it between the window and the reading pane, and Esc, × or a
// click on the scrim closes it from either. That it covers the sidebar and list is mail.spec.ts's.
// The server is faked at `fetch`, answering the attachment's bytes as a CSV.
import type {AttachmentOut} from '@setpoint/shared';
import {afterEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {Attachments} from '../../src/app/Attachments.tsx';

const FILE: AttachmentOut = {id: 7, filename: 'Rent.csv', mime_type: 'text/csv', size_bytes: 120, previewable: true};

afterEach(() => {
  vi.restoreAllMocks();
});

async function shown() {
  vi.spyOn(window, 'fetch').mockImplementation(() => Promise.resolve(new Response('Month,Rent\nOctober,2060\n', {headers: {'Content-Type': 'text/csv'}})));
  const screen = await render(<Attachments messageId={3} files={[FILE]} />);
  return screen;
}

const preview = () => document.querySelector('.attach-preview');
const expanded = () => [preview()?.classList.contains('expanded'), document.querySelector('.preview-scrim') !== null];

async function open() {
  await userEvent.click(page.getByRole('button', {name: /Rent\.csv/}));
  await expect.element(page.getByText('October')).toBeVisible();
}

test('a preview opens expanded; Shrink puts it over the pane and Expand brings it back; a reopened one starts expanded', async () => {
  const screen = await shown();
  await open();
  expect(expanded()).toEqual([true, true]);
  await userEvent.click(page.getByRole('button', {name: 'Shrink'}));
  expect(expanded()).toEqual([false, false]);
  await userEvent.click(page.getByRole('button', {name: 'Expand'}));
  expect(expanded()).toEqual([true, true]);
  await userEvent.click(page.getByRole('button', {name: 'Shrink'}));
  await userEvent.click(page.getByRole('button', {name: 'Close preview'}));
  expect(preview()).toBeNull();
  await open();
  expect(expanded()).toEqual([true, true]);
  await screen.unmount();
});

test('Esc, × and a click on the scrim each close the expanded preview at once', async () => {
  const screen = await shown();
  await open();
  await userEvent.keyboard('{Escape}');
  expect(preview()).toBeNull();
  await open();
  await userEvent.click(page.getByRole('button', {name: 'Close preview'}));
  expect(preview()).toBeNull();
  await open();
  (document.querySelector('.preview-scrim') as HTMLElement).click();
  await expect.poll(preview).toBeNull();
  expect(document.querySelector('.preview-scrim')).toBeNull();
  await screen.unmount();
});
