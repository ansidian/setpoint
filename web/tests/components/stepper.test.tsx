// Settings' stepper (parts.tsx › Stepper): − and +, and its number a field to type in that takes
// the limit as it's typed, set on Enter or leaving it, Esc putting the value back and going no further.
import {useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/settings/settings.css';
import {Stepper} from '../../src/app/settings/parts.tsx';

/** Overdue for as Settings › Tasks has it, 1 to 30 days, keeping its own value, with what reaches the page past it. */
function Days({onChange, onKey}: {onChange: (value: number) => void; onKey: (key: string) => void}) {
  const [value, setValue] = useState(3);
  return (
    <div className="settings" onKeyDown={event => onKey(event.key)}>
      <Stepper value={value} min={1} max={30} unit={days => (days === 1 ? 'day' : 'days')} label="Overdue for" onChange={next => {
        setValue(next);
        onChange(next);
      }} />
    </div>
  );
}

async function days() {
  const onChange = vi.fn();
  const onKey = vi.fn();
  await render(<Days onChange={onChange} onKey={onKey} />);
  return {onChange, onKey, field: page.getByRole('textbox', {name: 'Overdue for'}), group: page.getByRole('group', {name: 'Overdue for'})};
}

test('a click selects the number, a number past the most becomes it as it\'s typed, and Enter sets it', async () => {
  const {onChange, field, group} = await days();
  await field.click();
  await userEvent.keyboard('5');
  await expect.element(field).toHaveValue('5');
  await userEvent.keyboard('0');
  await expect.element(field).toHaveValue('30');
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(30);
  await expect.element(field).toHaveValue('30');
  await expect.element(group.getByText('days', {exact: true})).toBeVisible();
  // Still in the field, the next number replaces it.
  await userEvent.keyboard('0');
  await expect.element(field).toHaveValue('1');
});

test('a negative becomes the least, a letter isn\'t taken, and leaving the field sets it', async () => {
  const {onChange, field, group} = await days();
  await field.click();
  await userEvent.keyboard('-');
  await expect.element(field).toHaveValue('-');
  await userEvent.keyboard('2');
  await expect.element(field).toHaveValue('1');
  await userEvent.keyboard('x');
  await expect.element(field).toHaveValue('1');
  await userEvent.keyboard('{Tab}');
  expect(onChange).toHaveBeenLastCalledWith(1);
  await expect.element(field).toHaveValue('1');
  await expect.element(group.getByText('day', {exact: true})).toBeVisible();
});

test('Esc puts the value back and goes no further, and emptied it keeps the value', async () => {
  const {onChange, onKey, field} = await days();
  await field.click();
  await userEvent.keyboard('9{Escape}');
  await expect.element(field).toHaveValue('3');
  expect(onKey).not.toHaveBeenCalledWith('Escape');
  await userEvent.keyboard('{Backspace}{Enter}');
  await expect.element(field).toHaveValue('3');
  expect(onChange).not.toHaveBeenCalled();
});

test('− and + and ↑ ↓ step it, never past its limits', async () => {
  const {onChange, field} = await days();
  await page.getByRole('button', {name: 'More'}).click();
  expect(onChange).toHaveBeenLastCalledWith(4);
  await field.click();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
  await expect.element(field).toHaveValue('1');
  await userEvent.keyboard('{ArrowDown}');
  await page.getByRole('button', {name: 'Less'}).click();
  await expect.element(field).toHaveValue('1');
  expect(onChange.mock.calls.map(([value]) => value)).toEqual([4, 3, 2, 1]);
});
