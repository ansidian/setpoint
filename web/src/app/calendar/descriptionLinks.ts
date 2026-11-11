// SV-270 (D555, D556): a description's Gmail link, in the form Open in Gmail writes, opens the email in
// Setpoint's reader when Setpoint has it, its tooltip saying so; otherwise, and for every other
// link, it opens in a new tab as ever. Which email a link names is asked once and kept (api/client.ts).
import type {GmailLinkOut} from '@setpoint/shared';
import {getCached, loadingOf, prefetch, useResource} from '../../api/client.ts';
import {gmailLinkPath} from '../../api/mail.ts';
import {gmailLinkOf} from '../../logic/description.ts';
import {navigate} from '../router.ts';

export const OPENS_IN_SETPOINT = 'Opens in Setpoint';

const pathOf = (href: string | null) => {
  const link = gmailLinkOf(href);
  return link ? gmailLinkPath(link.account, link.id) : null;
};

/** The email a link names, once it's known; null for one Setpoint doesn't have or that isn't Gmail's. */
export function useLinkedEmail(href: string | null): number | null {
  const {data} = useResource<GmailLinkOut>(pathOf(href));
  return data?.message_id ?? null;
}

/** The same, for a link the page didn't draw (the editor's field): asked now, answered when it's known. */
export async function linkedEmail(href: string | null): Promise<number | null> {
  const path = pathOf(href);
  if (!path) return null;
  prefetch(path);
  await loadingOf(path);
  return getCached<GmailLinkOut>(path)?.message_id ?? null;
}

/** What it already knows, for a click that can't wait. */
export function knownEmail(href: string | null): number | null {
  const path = pathOf(href);
  return path ? getCached<GmailLinkOut>(path)?.message_id ?? null : null;
}

export const openEmail = (id: number) => navigate({page: 'inbox', open: id});
