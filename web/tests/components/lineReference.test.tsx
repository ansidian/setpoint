// What the line reads (LineReference.tsx; darma SV-114, D295): the ? at the editor's line opens the
// reference under it, every example with what it reads; Esc closes it and not the editor, focus
// going back to the ?; a press outside closes it. That the examples read so is lineReference.test.ts;
// the ? on the line, beside the email's mark, is editor.spec.ts.
import {expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/editor.css';
import {LineReference} from '../../src/app/calendar/LineReference.tsx';
import {LINE_REFERENCE} from '../../src/logic/lineReference.ts';

let escaped = 0;

function Line() {
  return (
    // Esc that reaches the editor would close it.
    <form className="editor" onKeyDown={event => event.key === 'Escape' && (escaped += 1)}>
      <div className="ed-line">
        <label className="field big nl"><input className="nl-input" aria-label="Describe the event" /></label>
        <LineReference />
      </div>
      <button type="button">Elsewhere</button>
    </form>
  );
}

const question = page.getByRole('button', {name: 'What the line reads'});
const card = page.getByRole('dialog', {name: 'What the line reads'});
const rows = () => [...document.querySelectorAll('.lr-pop li')].map(row => row.textContent);

test('the ? opens every example with what it reads, focus in it; Esc closes it, not the editor, and the ? has focus again', async () => {
  escaped = 0;
  await render(<Line />);
  await expect.element(card).not.toBeInTheDocument();
  await question.click();
  await expect.element(card).toBeVisible();
  await expect.element(card).toHaveFocus();
  await expect.element(question).toHaveAttribute('aria-expanded', 'true');
  expect(rows()).toEqual(LINE_REFERENCE.flatMap(section => section.rows.map(row => `${row.example} → ${row.reads}`)));
  expect([...document.querySelectorAll('.lr-title')].map(title => title.textContent)).toEqual(LINE_REFERENCE.map(section => section.title));
  await userEvent.keyboard('{Escape}');
  await expect.element(card).not.toBeInTheDocument();
  await expect.element(question).toHaveFocus();
  expect(escaped).toBe(0);
  // Closed, Esc is the editor's again.
  await userEvent.keyboard('{Escape}');
  expect(escaped).toBe(1);
});

test('from the keys: Tab from the line reaches the ?, Enter opens it, and Tab on leaves it closed', async () => {
  await render(<Line />);
  await page.getByLabelText('Describe the event').click();
  await userEvent.tab();
  await expect.element(question).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(card).toHaveFocus();
  await userEvent.tab();
  await expect.element(page.getByRole('button', {name: 'Elsewhere'})).toHaveFocus();
  await expect.element(card).not.toBeInTheDocument();
});

test('a press outside closes it, and the ? pressed again does too', async () => {
  await render(<Line />);
  await question.click();
  await expect.element(card).toBeVisible();
  await page.getByLabelText('Describe the event').click();
  await expect.element(card).not.toBeInTheDocument();
  await question.click();
  await expect.element(card).toBeVisible();
  await question.click();
  await expect.element(card).not.toBeInTheDocument();
  await expect.element(question).toHaveFocus();
});

test('the kept phrase is marked in its example, under the note that says how', async () => {
  await render(<Line />);
  await question.click();
  const kept = LINE_REFERENCE.flatMap(section => section.rows).filter(row => row.plain).map(row => row.plain);
  expect([...document.querySelectorAll('.lr-kept')].map(span => span.textContent)).toEqual(kept);
  await expect.element(page.getByText('Click a lit phrase, or press ⌥⌫ inside it, and it stays words.')).toBeVisible();
});
