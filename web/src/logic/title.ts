// The tab's title (DESIGN.md › Layout › Shell): "(3) Inbox" while attention mail is waiting, the
// subject when an email is open, "October 2026 · Calendar" on Calendar ("Oct 4 – 10, 2026 · Calendar"
// in the week view), and "News" or the open story's headline (after 2.0). Settings, a modal over the
// page, leaves the page's title as it is.
export type TitlePage = {page: 'inbox'; attention: number; subject: string | null} | {page: 'calendar'; title: string} | {page: 'news'; headline: string | null} | {page: 'sign-in'};

export function tabTitle(page: TitlePage): string {
  switch (page.page) {
    case 'inbox':
      if (page.subject) return page.subject;
      return page.attention > 0 ? `(${page.attention}) Inbox` : 'Inbox';
    case 'calendar':
      return `${page.title} · Calendar`;
    case 'news':
      return page.headline ?? 'News';
    case 'sign-in':
      return 'Setpoint';
  }
}
