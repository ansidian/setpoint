// Setpoint's mail state for Home Assistant, which mantel's mail chip shows (BRIEF.md › The mail chip
// in mantel; DESIGN.md › mantel's mail chip). Read-only, and outside the owner's session:
//
//   GET /api/status/ha     Authorization: Bearer <token>     HaStatusOut, or 401 (WWW-Authenticate: Bearer)
//
// The token comes from `npm run cli -- ha-token` (shown once; running it again rotates it, and
// `ha-token --revoke` revokes it). It reads this endpoint and nothing else; no other method or route
// takes it. Responses are `Cache-Control: no-store`.
//
// What the Home Assistant integration (`setpoint`, in the private ops workspace, in the finance
// importer's pattern) reads from it, polling every 60 s (D93):
//
// - `attention`: a sensor for the chip's tone-C half, "✉ 3 attention". Attention mail not Done,
//   read or not: the same number as Setpoint's sidebar pill (one query feeds both).
// - `unread_fyi`: a sensor for the plain half, "11 FYI".
// - `attention_emails`: the popover's rows, at most three, newest first (dot from `account.colour`,
//   `sender`, `subject`, age from `received_at`, a read one's sender in ink2 by `unread`); each row
//   opens `url`. "Open Setpoint ›" opens `open_url`.
// - `needs_reconnect`: one alert chip per entry, "<label> needs sign-in" (decision 42), opening
//   `url` (Settings › Accounts). An account's sources share one sign-in, so Gmail and Calendar on
//   one Google account are one entry.
// - `all_clear`: true only when there's nothing to show at all. A source needing reconnect is never
//   all clear, whatever the counts say. A failed or timed-out request makes the sensors unavailable,
//   which hides the chip: a broken connection never reads as all clear either.
// - `as_of`: when Setpoint computed this.
//
// Links are absolute, on Setpoint's public URL (SETPOINT_PUBLIC_URL, else the origin HA asked), and
// follow `deepLinkPath`.
import {z} from 'zod';
import {COLOURS, SOURCE_PROVIDERS} from '../enums.ts';
import {id, instant} from './common.ts';

/** The chip's popover can show this many attention emails. */
export const HA_ATTENTION_EMAILS = 3;

export const haAttentionEmailSchema = z.strictObject({
  id,
  // What Setpoint's row shows: the organisation ("Northwind Talent"), else the sender's name.
  sender: z.string(),
  from_name: z.string(),
  organisation: z.string().nullable(),
  subject: z.string(),
  account: z.strictObject({id, label: z.string(), colour: z.enum(COLOURS)}),
  received_at: instant,
  unread: z.boolean(),
  // Opens this email in Setpoint ("/inbox/12").
  path: z.string().startsWith('/'),
  url: z.url(),
});
export type HaAttentionEmail = z.infer<typeof haAttentionEmailSchema>;

export const haReconnectSchema = z.strictObject({
  // "Business" (an account's label) or a provider's name ("Todoist"), for "Business needs sign-in".
  label: z.string(),
  account_id: id.nullable(),
  // The sources that need it, such as ["gmail", "google_calendar"].
  providers: z.array(z.enum(SOURCE_PROVIDERS)).min(1),
  // Settings › Accounts.
  path: z.string().startsWith('/'),
  url: z.url(),
});
export type HaReconnect = z.infer<typeof haReconnectSchema>;

export const haStatusSchema = z.strictObject({
  as_of: instant,
  all_clear: z.boolean(),
  attention: z.int().nonnegative(),
  unread_fyi: z.int().nonnegative(),
  attention_emails: z.array(haAttentionEmailSchema).max(HA_ATTENTION_EMAILS),
  needs_reconnect: z.array(haReconnectSchema),
  open_url: z.url(),
});
export type HaStatusOut = z.infer<typeof haStatusSchema>;
