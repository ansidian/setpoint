// An email's quoted history folded behind ••• (QuotedHistory.tsx): it starts folded, ••• shows it
// again and folds it back, and a reader that holds the fold itself hears each press.
import {expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {useState} from 'react';
import {QuotedHistory} from '../../src/app/QuotedHistory.tsx';

const QUOTE = 'On Nov 24, 2026, Sam Ortiz wrote: Could you send the plan?';

test('the history starts folded, ••• shows it again and folds it back', async () => {
  await render(<QuotedHistory><p>{QUOTE}</p></QuotedHistory>);
  const show = page.getByRole('button', {name: 'Show quoted text'});
  await expect.element(show).toHaveAttribute('aria-expanded', 'false');
  await expect.element(show).toHaveTextContent('•••');
  expect(document.body.textContent).not.toContain(QUOTE);

  await userEvent.click(show);
  const hide = page.getByRole('button', {name: 'Hide quoted text'});
  await expect.element(hide).toHaveAttribute('aria-expanded', 'true');
  await expect.element(page.getByText(QUOTE)).toBeVisible();

  await userEvent.click(hide);
  await expect.element(page.getByRole('button', {name: 'Show quoted text'})).toBeVisible();
  expect(document.body.textContent).not.toContain(QUOTE);
});

test('a reader that holds the fold itself (an HTML email\'s frame) hears each press', async () => {
  function Frame() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <p>{open ? 'the full email' : 'the email without its history'}</p>
        <QuotedHistory open={open} onToggle={setOpen} />
      </>
    );
  }
  await render(<Frame />);
  await expect.element(page.getByText('the email without its history')).toBeVisible();
  await userEvent.click(page.getByRole('button', {name: 'Show quoted text'}));
  await expect.element(page.getByText('the full email')).toBeVisible();
  await userEvent.click(page.getByRole('button', {name: 'Hide quoted text'}));
  await expect.element(page.getByText('the email without its history')).toBeVisible();
});
