// An item's description, in the rich-text model the mail composer's body shares: it lives in
// shared/src/richText.ts, so the server writes a draft's HTML and plain text the same way.
export * from '@setpoint/shared/richText';

/**
 * The account and Gmail message id in a link of the form Open in Gmail writes,
 * https://mail.google.com/mail/?authuser=<account>#all/<message id>; null for any other address,
 * Gmail's own address-bar links (#inbox/FMfcg…) among them, which name a different id.
 */
export function gmailLinkOf(href: string | null): {account: string; id: string} | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com' || !/^\/mail\/?$/.test(url.pathname)) return null;
  const account = url.searchParams.get('authuser');
  // An address-bar link pasted from All Mail has this shape too. Its id just isn't found.
  const id = /^#all\/([^/?#]+)$/.exec(url.hash)?.[1];
  if (!account || !id) return null;
  try {
    return {account, id: decodeURIComponent(id)};
  } catch {
    return null;
  }
}
