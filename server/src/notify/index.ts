// The one notification outlet (BRIEF.md › ntfy): reminders, Time to Leave, a source that needs
// reconnecting and Send test all go through notify(), which logs each one and delivers it by ntfy.
// Nothing else knows about ntfy (the lint enforces it). Topics come from Settings › Notifications
// (`setpoint-reminders`, `setpoint-mail`), and each notification's click opens the exact email,
// item or Settings page: in the iPhone app while one is paired, for an email or item (SV-87).
// The link is chosen as each notification is sent, so a retry follows a pairing or a Revoke since.
// ntfy is one delivery; APNs could later be a second beside it, given the same Notification.
import {appLink, deepLinkPath} from '@setpoint/shared';
import type {DeepLink, NotificationKind, NotificationOut, NotifyStatusOut, NotifyTopic} from '@setpoint/shared';
import {desc, eq} from 'drizzle-orm';
import {hasPairedDevice} from '../auth/devices.ts';
import * as t from '../db/schema.ts';
import {readSecret} from '../secrets/store.ts';
import {getSettings} from '../settings.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {publishToNtfy} from './ntfy.ts';

export interface Notification {
  kind: NotificationKind;
  topic: NotifyTopic;
  title: string;
  body: string;
  link?: DeepLink;
  // Sends at most once per key ("reconnect:3:2026-10-07T…", "reminder:12@…").
  dedupe?: string;
}

export interface NotifierOptions {
  // Setpoint's own origin, for web click links; without it, only the app's links go.
  publicUrl: string | null;
  // The network: tests pass a fake ntfy's.
  fetch?: typeof fetch;
}

const TAGS: Record<NotificationKind, string[]> = {
  reminder: ['calendar'], time_to_leave: ['car'], reconnect: ['warning'], mail: ['email'], test: ['white_check_mark'],
};

type Row = typeof t.notifications.$inferSelect;
const present = (row: Row): NotificationOut => ({
  id: row.id, kind: row.kind, topic: row.topic, title: row.title, body: row.body, click: row.click, state: row.state, error: row.error, created_at: row.createdAt,
});

export class Notifier {
  private readonly store: Store;
  private readonly options: NotifierOptions;
  private readonly fetcher: typeof fetch;

  constructor(store: Store, options: NotifierOptions) {
    this.store = store;
    this.options = options;
    this.fetcher = options.fetch ?? fetch;
  }

  /**
   * Logs and sends one notification. A dedupe key already sent is not sent again; one that failed
   * is tried again. It's skipped, and logged as skipped, when ntfy isn't set up or Settings turns
   * that kind off (the reminders topic, except Send test; attention mail; reconnect alerts).
   */
  async notify(notification: Notification): Promise<NotificationOut> {
    const {store} = this;
    const earlier = notification.dedupe ? store.db.select().from(t.notifications).where(eq(t.notifications.dedupe, notification.dedupe)).get() : undefined;
    if (earlier && earlier.state !== 'failed') return present(earlier);
    const settings = getSettings(store).notifications;
    const click = this.click(notification.link);
    let state: Row['state'] = 'sent';
    let error: string | null = null;
    if (!settings.ntfy_server) [state, error] = ['skipped', 'ntfy isn\'t set up.'];
    else if (notification.kind === 'mail' && !settings.attention_mail) [state, error] = ['skipped', 'Attention mail notifications are off.'];
    else if (notification.topic === 'reminders' && notification.kind !== 'test' && !settings.reminders) [state, error] = ['skipped', `${settings.topics.reminders} is off.`];
    else if (notification.kind === 'reconnect' && !settings.reconnect_alerts) [state, error] = ['skipped', 'Reconnect alerts are off.'];
    else {
      try {
        await publishToNtfy(this.fetcher, settings.ntfy_server, readSecret(store, 'ntfy_token'), {
          topic: settings.topics[notification.topic], title: notification.title, message: notification.body, click,
          tags: TAGS[notification.kind], priority: notification.kind === 'reconnect' || notification.kind === 'time_to_leave' ? 4 : 3,
        });
      } catch (caught) {
        [state, error] = ['failed', caught instanceof Error ? caught.message : String(caught)];
      }
    }
    const values = {
      kind: notification.kind, topic: notification.topic, title: notification.title, body: notification.body, click,
      dedupe: notification.dedupe ?? null, state, error, createdAt: isoNow(store),
    };
    const row = earlier
      ? store.db.update(t.notifications).set(values).where(eq(t.notifications.id, earlier.id)).returning().get()
      : store.db.insert(t.notifications).values(values).returning().get();
    return present(row!);
  }

  /** The app's link while an iPhone is paired, else the web's on the public URL; none without either. */
  private click(link: DeepLink | undefined): string | null {
    if (!link) return null;
    const app = hasPairedDevice(this.store) ? appLink(link) : null;
    if (app) return app;
    return this.options.publicUrl ? new URL(deepLinkPath(link), this.options.publicUrl).href : null;
  }

  /** Settings › Notifications' Send test. */
  sendTest(): Promise<NotificationOut> {
    return this.notify({kind: 'test', topic: 'reminders', title: 'Setpoint', body: 'Notifications from Setpoint arrive here.', link: {to: 'settings', page: 'notifications'}});
  }

  /** "Connected · last sent 8:02 AM", or the last error. */
  status(): NotifyStatusOut {
    const settings = getSettings(this.store).notifications;
    const last = this.store.db.select().from(t.notifications).orderBy(desc(t.notifications.id)).limit(20).all();
    const lastSent = last.find(row => row.state === 'sent');
    const lastTried = last.find(row => row.state !== 'skipped');
    return {
      configured: settings.ntfy_server !== null,
      last_sent_at: lastSent?.createdAt ?? null,
      last_error: lastTried?.state === 'failed' ? lastTried.error : null,
    };
  }
}
