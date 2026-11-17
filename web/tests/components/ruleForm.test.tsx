// Settings › Mail's rule form (Mail.tsx › RuleForm) as a written rule's Edit: filled in from the
// rule, each part changed and saved, Esc leaving it as it was, and the parts it can't draw shown as
// fixed lines and saved back as they were. The row turning into the form and the server's answer are
// settings.spec.ts's.
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
  await expect.element(page.getByRole('textbox', {name: 'From'})).toHaveValue('fabrikam.example');
  await expect.element(page.getByRole('textbox', {name: 'From'})).toHaveFocus();
  await expect.element(page.getByRole('textbox', {name: 'Subject contains'})).toHaveValue('Newsletter');
  await expect.element(page.getByRole('button', {name: 'Send to'})).toHaveTextContent('Noise');
  await expect.element(page.getByRole('switch', {name: 'Mark read'})).toHaveAttribute('aria-checked', 'false');
  await expect.element(page.getByRole('radio', {name: '1 week'})).toHaveAttribute('aria-checked', 'true');
  await expect.element(page.getByRole('button', {name: 'Save'})).toBeInTheDocument();
  await expect.element(page.getByRole('button', {name: 'Add', exact: true})).not.toBeInTheDocument();
});

test('the sender, words, lane, mark read and trash each change, and Save sends them all, then closes', async () => {
  const {save, onDone} = await edit();
  await page.getByRole('textbox', {name: 'From'}).fill('news.fabrikam.example');
  await page.getByRole('textbox', {name: 'Subject contains'}).fill('Weekly digest');
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
  await page.getByRole('button', {name: 'Remove Subject contains'}).click();
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0].match).toEqual({from_domains: ['fabrikam.example']});
});

test('Esc leaves the rule as it was: nothing is saved, the form closes, and the key goes no further', async () => {
  const {save, onDone} = await edit();
  const outside = vi.fn();
  document.addEventListener('keydown', outside);
  try {
    await page.getByRole('textbox', {name: 'From'}).fill('other.example');
    await userEvent.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener('keydown', outside);
  }
});

test('a rule with parts the form can\'t draw shows them as fixed lines, and a save keeps them exactly as they were', async () => {
  const match = {from_domains: ['northwind.example', 'tailspintoys.example'], subject_includes: ['Your order', 'Shipment'], body_regex: 'tracking (number|#)', none_includes: ['refund']};
  const {save} = await edit({match, lane: 'fyi', kind: 'deliveries', trash: 'never'});
  // The senders stand where From's field would be; each other part on its own line.
  await expect.element(page.getByRole('textbox', {name: 'From'})).not.toBeInTheDocument();
  expect(page.getByText(/northwind\.example or tailspintoys\.example|Subject contains “|Body matches|nowhere in the email/).all().map(line => line.element().textContent))
    .toEqual(['northwind.example or tailspintoys.example', 'Subject contains “Your order” or “Shipment”', 'Body matches /tracking (number|#)/', '“refund” nowhere in the email']);
  // The form holds the focus, so Esc reaches it, though it has no From field.
  expect(document.querySelector('form')!.contains(document.activeElement)).toBe(true);
  // Subject contains is fixed, so "and…" doesn't offer it.
  await page.getByRole('button', {name: 'and…'}).click();
  await expect.element(page.getByRole('menuitem', {name: 'Body contains'})).toBeInTheDocument();
  expect(page.getByRole('menuitem').all().map(item => item.element().textContent)).not.toContain('Subject contains');
  await page.getByRole('menuitem', {name: 'Sender name contains'}).click();
  await userEvent.keyboard('Orders');
  await page.getByRole('switch', {name: 'Mark read'}).click();
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0]).toEqual({match: {...match, from_name_includes: ['Orders']}, lane: 'fyi', kind: 'deliveries', mark_read: true, trash: 'never'});
});

test('From left blank on a rule with a sender asks for one and saves nothing', async () => {
  const {save} = await edit();
  await page.getByRole('textbox', {name: 'From'}).fill('');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('From needs a domain such as woodgrovebank.example, or an address.');
  expect(save).not.toHaveBeenCalled();
});

test('a rule with no sender saves with From blank', async () => {
  const {save} = await edit({match: {subject_includes: ['Registrar']}, lane: 'attention'});
  await expect.element(page.getByRole('textbox', {name: 'From'})).toHaveValue('');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect(save.mock.calls[0]![0].match).toEqual({subject_includes: ['Registrar']});
});
