// The web app's deep links: an ntfy notification's click opens the exact email, item or Settings
// page (BRIEF.md › ntfy; F8). The server builds them and the web app routes them, from this one
// definition. While an iPhone is paired, an email or item opens in the app instead (appLink).
export type DeepLink =
  | {to: 'message'; id: number}
  | {to: 'item'; id: number; occurrence_start?: string | null}
  | {to: 'day'; date: string}
  | {to: 'settings'; page: 'accounts' | 'notifications' | 'mail' | 'calendar' | 'todoist' | 'ai' | 'appearance' | 'security'};

/**
 * The iPhone app's link for an email or item, such as "setpoint://mail/12" or "setpoint://item/3",
 * with the ids /api/mail/messages/:id and /api/items/:id take (SV-87). The app has no screen for a
 * day or a Settings page, so those have none (null).
 */
export function appLink(link: DeepLink): string | null {
  switch (link.to) {
    case 'message':
      return `setpoint://mail/${link.id}`;
    case 'item':
      return `setpoint://item/${link.id}`;
    case 'day':
    case 'settings':
      return null;
  }
}

/** The path of a deep link, such as "/inbox/12" or "/calendar/item/3?at=2026-10-07T21:30:00.000Z". */
export function deepLinkPath(link: DeepLink): string {
  switch (link.to) {
    case 'message':
      return `/inbox/${link.id}`;
    case 'item':
      return `/calendar/item/${link.id}${link.occurrence_start ? `?at=${encodeURIComponent(link.occurrence_start)}` : ''}`;
    case 'day':
      return `/calendar/${link.date}`;
    case 'settings':
      return `/settings/${link.page}`;
  }
}
