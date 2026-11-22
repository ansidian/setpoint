/**
 * The sender's unsubscribe page from an email's `List-Unsubscribe` header: its first `<…>` entry
 * that is an https address. Null for none, a mailto only, plain http or a value that doesn't parse.
 * Setpoint only opens that page; it never posts to it or sends the mailto.
 */
export function unsubscribeUrl(value: string | undefined): string | null {
  if (!value) return null;
  const unfolded = value.replace(/\r?\n[ \t]+/g, ' ');
  for (const [, entry] of unfolded.matchAll(/<([^>]*)>/g)) {
    try {
      const url = new URL(entry!.trim());
      if (url.protocol === 'https:') return url.href;
    } catch {
      // Not an address: try the next entry.
    }
  }
  return null;
}
