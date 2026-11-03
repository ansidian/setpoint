// The shared tooltip (Tip.tsx, DESIGN.md #299): a tip that only repeats its element's own words shows
// only while some of them are cut, so "No reply yet" on a line it fits never shows one, and a long
// subject cut short on the same line does (SV-171). How long each kind waits is judged by eye (D269).
import {afterEach, expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {Tip} from '../../src/app/Tip.tsx';
import {tip} from '../../src/tokens.ts';

const tooltip = page.getByRole('tooltip');
const SUBJECT = 'Update on your application for Software Engineer I at Northwind Talent';

afterEach(async () => {
  await userEvent.hover(page.elementLocator(document.documentElement), {position: {x: 0, y: 0}});
});

test('a tip that repeats words that fit never shows; the same line cut short shows them whole', async () => {
  await render(
    <>
      <Tip />
      <span className="ell" data-testid="fits" style={{display: 'block', width: 300}} data-tip="No reply yet">No reply yet</span>
      <span className="ell" data-testid="cut" style={{display: 'block', width: 120}} data-tip={SUBJECT}>{SUBJECT}</span>
    </>,
  );
  await userEvent.hover(page.getByTestId('fits'));
  // Nothing should show: a pause past the longer wait for it to have done so.
  await new Promise(resolve => setTimeout(resolve, tip.patientMs + 300));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();

  await userEvent.hover(page.getByTestId('cut'));
  // Past the patient wait, with room for a busy machine.
  await expect.element(tooltip, {timeout: 5000}).toHaveTextContent(SUBJECT);
});

test('a tip that says something its element doesn\'t shows whether or not anything is cut', async () => {
  await render(
    <>
      <Tip />
      <span data-testid="name" style={{display: 'inline-block'}} data-tip="megan@example.com" data-tip-quick>Megan Bowen</span>
    </>,
  );
  await userEvent.hover(page.getByTestId('name'));
  await expect.element(tooltip).toHaveTextContent('megan@example.com');
});
