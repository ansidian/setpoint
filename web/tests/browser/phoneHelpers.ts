// What the phone's specs share (phoneShell, phoneInbox, phoneReader, phoneAgenda): the seed's
// counts and emails, the Inbox at 390 × 844 (board 21), and an element's box once it rests.
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {rested} from './harness.ts';
import type {Setpoint} from './harness.ts';

export const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');

/** The seed's emails by the start of their subject. */
export async function email(setpoint: Setpoint, subject: string): Promise<number> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  return inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith(subject))!.id;
}

export async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

export const box = async (page: Page, selector: string) => (await rested(() => page.locator(selector).first().boundingBox()))!;
