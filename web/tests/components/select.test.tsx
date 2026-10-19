// Settings' select (parts.tsx › Select, on its Menu): the shared menu, not the browser's list, from
// the pointer and the keyboard, its Esc going no further than the menu (S13, SV-25).
import {useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/settings/settings.css';
import {Page, Row, Section, Select} from '../../src/app/settings/parts.tsx';
import {colour} from './colour.ts';

const OPTIONS = [{value: 5, label: '5 min'}, {value: 10, label: '10 min'}, {value: 30, label: '30 min'}, {value: 60, label: '1 hour', disabled: true}];

/** A select keeping its own value, in a row of a Settings page as Notifications has it, with what reaches the page past it. */
function Picker({onChange, onKey}: {onChange: (value: number) => void; onKey: (key: string) => void}) {
  const [value, setValue] = useState(10);
  return (
    <div className="settings" onKeyDown={event => onKey(event.key)}>
      <Page title="Notifications">
        <Section label="Defaults">
          <Row title="Task reminders">
            <Select value={value} options={OPTIONS} label="Task reminders" onChange={next => {
              setValue(next);
              onChange(next);
            }} />
          </Row>
        </Section>
      </Page>
    </div>
  );
}

async function picker() {
  const onChange = vi.fn();
  const onKey = vi.fn();
  await render(<Picker onChange={onChange} onKey={onKey} />);
  return {onChange, onKey, chip: page.getByRole('button', {name: 'Task reminders'}), menu: page.getByRole('menu', {name: 'Task reminders'})};
}

test('a click opens the shared menu with the current choice checked, and a pick closes it and shows the choice', async () => {
  const {onChange, chip, menu} = await picker();
  await expect.element(chip).toHaveTextContent('10 min');
  await expect.element(chip).toHaveAttribute('aria-expanded', 'false');
  await chip.click();
  await expect.element(chip).toHaveAttribute('aria-expanded', 'true');
  expect(menu.getByRole('menuitemradio').all().map(item => item.element().textContent)).toEqual(OPTIONS.map(option => option.label));
  expect(menu.getByRole('menuitemradio', {checked: true}).all().map(item => item.element().textContent)).toEqual(['10 min']);
  await expect.element(menu.getByRole('menuitemradio', {name: '1 hour'})).toBeDisabled();

  await menu.getByRole('menuitemradio', {name: '30 min'}).click();
  await expect.element(menu).not.toBeInTheDocument();
  await expect.element(chip).toHaveTextContent('30 min');
  expect(onChange.mock.calls).toEqual([[30]]);
});

test('picking the current choice changes nothing; a press outside closes the menu', async () => {
  const {onChange, chip, menu} = await picker();
  await chip.click();
  await menu.getByRole('menuitemradio', {name: '10 min'}).click();
  await expect.element(menu).not.toBeInTheDocument();
  await chip.click();
  await expect.element(menu).toBeVisible();
  await userEvent.click(document.body, {position: {x: 600, y: 600}});
  await expect.element(menu).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

test('from the keyboard: Enter focuses the checked choice, ↓ and ↑ skip the disabled one and wrap round, Enter picks, and focus goes back to the chip', async () => {
  const {onChange, chip, menu} = await picker();
  chip.element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu.getByRole('menuitemradio', {checked: true})).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(menu.getByRole('menuitemradio', {name: '30 min'})).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(menu.getByRole('menuitemradio', {name: '5 min'})).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}{Enter}');
  await expect.element(menu).not.toBeInTheDocument();
  await expect.element(chip).toHaveTextContent('30 min');
  await expect.element(chip).toHaveFocus();
  expect(onChange.mock.calls).toEqual([[30]]);
});

test('Esc closes just the menu, hands focus back to the chip, and goes no further, so Settings stays open', async () => {
  const {onKey, chip, menu} = await picker();
  chip.element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(menu).not.toBeInTheDocument();
  await expect.element(chip).toHaveFocus();
  expect(onKey.mock.calls.flat()).not.toContain('Escape');
  // With the menu shut, Esc is the page's again.
  await userEvent.keyboard('{Escape}');
  expect(onKey.mock.calls.flat()).toContain('Escape');
});

test('the chip is the board\'s, not the browser\'s list, its ring `edgeOn` while its menu is open', async () => {
  const {chip, menu} = await picker();
  expect(document.querySelector('select')).toBeNull();
  const ring = () => getComputedStyle(chip.element()).boxShadow;
  await chip.click();
  // The pointer off the chip, onto its menu, so its ring is the open menu's, not the hover's.
  await userEvent.hover(menu.getByRole('menuitemradio', {name: '5 min'}));
  await expect.poll(ring).toBe(`${colour('var(--edgeOn)')} 0px 0px 0px 1px inset`);
});

