// Settings › Mail's rule form (Mail.tsx › RuleForm) as a written rule's Edit: filled in from the
// rule, each part changed and saved, Esc leaving it as it was, several senders and phrases as "or"
// lines, and the parts it can't draw shown as fixed lines and saved back as they were. Add rule's
// "or" lines too. The row turning into the form and the server's answer are settings.spec.ts's.
import type {RuleOut} from '@setpoint/shared';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/settings/settings.css';
import type {RuleFields} from '../../src/api/settings.ts';
import {RuleForm} from '../../src/app/settings/Mail.tsx';

const rule = (fields: Partial<RuleOut>): RuleOut => ({
  id: 7, origin: 'written', match: {from_domains: ['fabrikam.example'], subject_includes: ['Newsletter']}, lane: 'noise', kind: null, position: 0, enabled: true,
  mark_read: false, trash: '1w', imported: false, created_at: '2026-10-01T00:00:00Z', matches_this_month: 0, trashes_waiting: 0, ...fields,
});

async function edit(fields: Partial<RuleOut> = {}) {
  const save = vi.fn((_fields: RuleFields) => Promise.resolve(true));
  const onDone = vi.fn();
  await render(<div className="settings"><div className="set-group"><RuleForm rule={rule(fields)} save={save} onDone={onDone} /></div></div>);
  return {save, onDone};
}

test('Edit opens filled in from the rule, with From focused and Save for Add', async () => {
  await edit();
  await expect.element(page.getByRole('textbox', {name: 'From', exact: true})).toHaveValue('fabrikam.example');
  await expect.element(page.getByRole('textbox', {name: 'From', exact: true})).toHaveFocus();
  await expect.element(page.getByRole('textbox', {name: 'Subject contains', exact: true})).toHaveValue('Newsletter');
  await expect.element(page.getByRole('button', {name: 'Send to'})).toHaveTextContent('Noise');
  await expect.element(page.getByRole('switch', {name: 'Mark read'})).toHaveAttribute('aria-checked', 'false');
  await expect.element(page.getByRole('radio', {name: '1 week'})).toHaveAttribute('aria-checked', 'true');
  await expect.element(page.getByRole('button', {name: 'Save'})).toBeInTheDocument();
  await expect.element(page.getByRole('button', {name: 'Add', exact: true})).not.toBeInTheDocument();
});

test('the sender, words, lane, mark read and trash each change, and Save sends them all, then closes', async () => {
  const {save, onDone} = await edit();
  await page.getByRole('textbox', {name: 'From', exact: true}).fill('news.fabrikam.example');
  await page.getByRole('textbox', {name: 'Subject contains', exact: true}).fill('Weekly digest');
  await page.getByRole('button', {name: 'and…'}).click();
  await page.getByRole('menuitem', {name: 'Body doesn’t contain'}).click();
  await expect.element(page.getByRole('textbox', {name: 'Body doesn’t contain'})).toHaveFocus();
  await userEvent.keyboard('sale');
  await page.getByRole('button', {name: 'Send to'}).click();
  await page.getByRole('menuitemradio', {name: 'FYI · Updates'}).click();
  await page.getByRole('switch', {name: 'Mark read'}).click();
  await page.getByRole('radio', {name: 'Never'}).click();
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => onDone.mock.calls.length).toBe(1);
  expect(save.mock.calls).toEqual([[{
    match: {from_domains: ['news.fabrikam.example'], subject_includes: ['Weekly digest'], body_excludes: ['sale']}, lane: 'fyi', kind: 'updates', mark_read: true, trash: 'never',
  }]]);
});

test('a filter removed leaves the rule\'s match', async () => {
  const {save} = await edit();
  await page.getByRole('button', {name: 'Remove Subject contains', exact: true}).click();
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0].match).toEqual({from_domains: ['fabrikam.example']});
});

test('Esc leaves the rule as it was: nothing is saved, the form closes, and the key goes no further', async () => {
  const {save, onDone} = await edit();
  const outside = vi.fn();
  document.addEventListener('keydown', outside);
  try {
    await page.getByRole('textbox', {name: 'From', exact: true}).fill('other.example');
    await userEvent.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener('keydown', outside);
  }
});

test('a rule with several senders and phrases opens with each on its own "or" line, and a pattern and words found nowhere stay fixed and are saved as they were', async () => {
  const match = {from_domains: ['northwind.example', 'tailspintoys.example'], subject_includes: ['Your order', 'Shipment'], body_regex: 'tracking (number|#)', none_includes: ['refund']};
  const {save} = await edit({match, lane: 'fyi', kind: 'deliveries', trash: 'never'});
  await expect.element(page.getByRole('textbox', {name: 'From', exact: true})).toHaveValue('northwind.example');
  await expect.element(page.getByRole('textbox', {name: 'From 2'})).toHaveValue('tailspintoys.example');
  await expect.element(page.getByRole('textbox', {name: 'Subject contains', exact: true})).toHaveValue('Your order');
  await expect.element(page.getByRole('textbox', {name: 'Subject contains 2'})).toHaveValue('Shipment');
  expect(page.getByText(/Body matches|nowhere in the email/).all().map(line => line.element().textContent))
    .toEqual(['Body matches /tracking (number|#)/', '“refund” nowhere in the email']);
  // Subject contains is shown, so "and…" doesn't offer it again.
  await page.getByRole('button', {name: 'and…'}).click();
  await expect.element(page.getByRole('menuitem', {name: 'Body contains'})).toBeInTheDocument();
  expect(page.getByRole('menuitem').all().map(item => item.element().textContent)).not.toContain('Subject contains');
  await page.getByRole('menuitem', {name: 'Sender name contains'}).click();
  await userEvent.keyboard('Orders');
  // A third subject phrase, the first one taken out, and a sender changed.
  await page.getByRole('button', {name: 'Or subject contains'}).click();
  await expect.element(page.getByRole('textbox', {name: 'Subject contains 3'})).toHaveFocus();
  await userEvent.keyboard('Delivered');
  await page.getByRole('button', {name: 'Remove Subject contains', exact: true}).click();
  await page.getByRole('textbox', {name: 'From 2'}).fill('sam@tailspintoys.example');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0]).toEqual({
    match: {from_domains: ['northwind.example'], from_addresses: ['sam@tailspintoys.example'], subject_includes: ['Shipment', 'Delivered'], from_name_includes: ['Orders'], body_regex: 'tracking (number|#)', none_includes: ['refund']},
    lane: 'fyi', kind: 'deliveries', mark_read: false, trash: 'never',
  });
});

test('Add rule takes several senders and several phrases, leaving blank "or" lines out', async () => {
  const save = vi.fn((_fields: RuleFields) => Promise.resolve(true));
  await render(<div className="settings"><div className="set-group"><RuleForm save={save} onDone={() => {}} /></div></div>);
  await page.getByRole('textbox', {name: 'From', exact: true}).fill('northwind.example');
  await page.getByRole('button', {name: 'Or from'}).click();
  await expect.element(page.getByRole('textbox', {name: 'From 2'})).toHaveFocus();
  await userEvent.keyboard('tailspintoys.example');
  await page.getByRole('button', {name: 'Or from'}).click();
  await page.getByRole('button', {name: 'and…'}).click();
  await page.getByRole('menuitem', {name: 'Subject doesn’t contain'}).click();
  await userEvent.keyboard('Return');
  await page.getByRole('button', {name: 'Or subject doesn’t contain'}).click();
  await userEvent.keyboard('Refund');
  await page.getByRole('button', {name: 'Or subject doesn’t contain'}).click();
  await page.getByRole('button', {name: 'Add', exact: true}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0].match).toEqual({from_domains: ['northwind.example', 'tailspintoys.example'], subject_excludes: ['Return', 'Refund']});
});

test('"or…" is offered until a field holds the server\'s 50, senders counted together', async () => {
  const many = (count: number, word: string) => Array.from({length: count}, (_, index) => `${word}${index}`);
  await edit({match: {from_domains: many(25, 'a').map(one => `${one}.example`), from_addresses: many(24, 'b').map(one => `${one}@c.example`), subject_includes: many(49, 'p'), body_includes: many(50, 'q')}});
  await expect.element(page.getByRole('button', {name: 'Or subject contains'})).toBeInTheDocument();
  await expect.element(page.getByRole('button', {name: 'Or body contains'})).not.toBeInTheDocument();
  await page.getByRole('button', {name: 'Or from'}).click();
  await expect.element(page.getByRole('textbox', {name: 'From 50'})).toBeInTheDocument();
  await expect.element(page.getByRole('button', {name: 'Or from'})).not.toBeInTheDocument();
  await page.getByRole('button', {name: 'Or subject contains'}).click();
  await expect.element(page.getByRole('button', {name: 'Or subject contains'})).not.toBeInTheDocument();
});

test('From left blank on a rule with a sender asks for one and saves nothing', async () => {
  const {save} = await edit();
  await page.getByRole('textbox', {name: 'From', exact: true}).fill('');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('From needs a domain such as woodgrovebank.example, or an address.');
  expect(save).not.toHaveBeenCalled();
});

test('a rule with no sender saves with From blank', async () => {
  const {save} = await edit({match: {subject_includes: ['Registrar']}, lane: 'attention'});
  await expect.element(page.getByRole('textbox', {name: 'From', exact: true})).toHaveValue('');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0].match).toEqual({subject_includes: ['Registrar']});
});
