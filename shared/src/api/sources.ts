// Settings › Accounts and the other settings pages: accounts, sources and their health, settings,
// write-only secrets and notifications (DESIGN.md › Settings; BRIEF.md › Health and states).
//
//   GET   /api/accounts                          AccountOut[]
//   PATCH /api/accounts/:id     AccountUpdateInput   AccountOut
//   PUT   /api/accounts/order   {account_ids}        AccountOut[]
//   GET   /api/sources                           SourceOut[]
//   PUT   /api/sources/:id/credentials  CredentialsInput  204 (write-only: never returned)
//   POST  /api/sources/:id/check                 204 (check now)
//   POST  /api/accounts/gmail/authorize   GmailAuthorizeInput  GmailAuthorizeOut (Connect Gmail / Reconnect)
//   GET   /api/ea/accounts/gmail/callback?code=&state=   302 to /settings/accounts?connected=<id> or ?error=<code>
//         (Google's redirect, outside the session: the signed state is its proof; the path is v1's,
//         kept so the Google client's registration still matches)
//   POST  /api/accounts/icloud            ICloudConnectInput   AccountOut (201; Connect iCloud)
//   GET   /api/settings                          Settings
//   PATCH /api/settings         SettingsPatch    Settings
//   GET   /api/secrets                           SecretOut[]
//   PUT   /api/secrets/:name    {value}          204; DELETE removes it
//   GET   /api/notifications/status              NotifyStatusOut
//   POST  /api/notifications/test                NotificationOut (Send test)
import {z} from 'zod';
import {COLOURS} from '../enums.ts';
import type {AccountProvider, Colour, NotificationKind, NotifyTopic, SecretName, SourceProvider, SyncMode} from '../enums.ts';
import {id} from './common.ts';
import type {HealthOut} from './common.ts';

/** A mail account: the sidebar's rows and Settings › Accounts › Mail. */
export interface AccountOut {
  id: number;
  provider: AccountProvider;
  label: string;
  address: string;
  colour: Colour;
  icon: string;
  position: number;
  source_id: number | null;
  health: HealthOut;
}
export const accountUpdateInput = z.strictObject({
  label: z.string().trim().min(1).max(40),
  colour: z.enum(COLOURS),
  // A Material Symbols name from the bundled set.
  icon: z.string().regex(/^[a-z0-9_]{1,64}$/),
}).partial().refine(changes => Object.keys(changes).length > 0, 'Nothing to change');
export const accountOrderInput = z.strictObject({account_ids: z.array(id).min(1)});

/**
 * A provider connection with its health (Settings › Accounts): each account, and Google Calendar,
 * Todoist and weather. `name` is the account's label or the provider's name. Credentials are never
 * returned; `has_credentials` says whether there are any.
 */
export interface SourceOut {
  id: number;
  provider: SourceProvider;
  account_id: number | null;
  name: string;
  sync: {
    mode: SyncMode;
    interval_seconds: number;
    // A push channel's renewal ("Push · watch renews Oct 9").
    push_renews_at: string | null;
  };
  health: HealthOut;
  has_credentials: boolean;
  // The seed's in-process stand-in for a provider (never a real account).
  dev: boolean;
}

/**
 * New or renewed credentials for a source, write-only. iCloud takes an app password, Google and
 * Todoist the result of their OAuth consent (B2, B5), weather an API key if its provider needs one.
 */
export const credentialsInput = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('app_password'), username: z.string().min(1).max(320), password: z.string().min(1).max(200)}),
  z.strictObject({
    kind: z.literal('oauth'),
    refresh_token: z.string().min(1).max(4096),
    access_token: z.string().min(1).max(8192).nullable().default(null),
    expires_at: z.iso.datetime().nullable().default(null),
    scope: z.string().max(4096).nullable().default(null),
  }),
  z.strictObject({kind: z.literal('api_key'), key: z.string().min(1).max(4096)}),
]);
export type Credentials = z.infer<typeof credentialsInput>;

/**
 * Connect Gmail (one Google consent for Gmail and Calendar), or reconnect an account that needs
 * sign-in: the web app sends the browser to `url`, and Google returns it to the callback.
 */
export const gmailAuthorizeInput = z.strictObject({account_id: id.optional()});
export interface GmailAuthorizeOut {
  url: string;
}

/** Connect iCloud with an app-specific password (appleid.apple.com › App-Specific Passwords). */
export const icloudConnectInput = z.strictObject({
  address: z.email().max(320),
  app_password: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(40).optional(),
  colour: z.enum(COLOURS).optional(),
  icon: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
});
export type ICloudConnectInput = z.infer<typeof icloudConnectInput>;

/** An instance secret's state; its value is never returned. */
export interface SecretOut {
  name: SecretName;
  set: boolean;
  updated_at: string | null;
}
export const secretInput = z.strictObject({value: z.string().trim().min(1).max(8192)});

/** Settings › Notifications: "Connected · last sent 8:02 AM". */
export interface NotifyStatusOut {
  configured: boolean;
  last_sent_at: string | null;
  last_error: string | null;
}
export interface NotificationOut {
  id: number;
  kind: NotificationKind;
  topic: NotifyTopic;
  title: string;
  body: string;
  click: string | null;
  state: 'sent' | 'failed' | 'skipped';
  error: string | null;
  created_at: string;
}
