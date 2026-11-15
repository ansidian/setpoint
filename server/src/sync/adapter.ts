// The adapter interface every provider implements. The engine schedules and records. Adapters talk
// to their provider: Gmail, iCloud, Google Calendar, Todoist and weather. The dev provider serves
// the seed.
import type {Credentials} from '@setpoint/shared';
import type * as t from '../db/schema.ts';
import type {Store} from '../store.ts';

export type SourceRow = typeof t.sources.$inferSelect;
export type CommandRow = typeof t.commands.$inferSelect;

export interface AdapterContext {
  store: Store;
  source: SourceRow;
  // Decrypted on demand. Null for a source without credentials (the dev provider's).
  credentials(): Credentials | null;
  // Aborted when the check times out or the engine stops.
  signal: AbortSignal;
}

/** An attachment's bytes and how to serve them. */
export interface AttachmentBytes {
  content: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * An email to send (src/sending/), built once for both providers. `raw` keeps the Bcc line, as
 * Gmail's send and the copy filed in Sent need; `delivered` leaves it out, for SMTP, whose
 * recipients are the envelope's.
 */
export interface OutgoingMail {
  raw: Buffer;
  delivered: Buffer;
  // The Message-ID Setpoint set, with its angle brackets.
  rfc822Id: string;
  // The envelope: who it's from and every To, Cc and Bcc address.
  sender: string;
  recipients: string[];
  // The provider's thread to send it in (a reply's, on Gmail). Null for a new conversation.
  threadId: string | null;
}

/** What the provider made of a sent email: its id in the record's form, and its thread where it says. */
export interface SentMail {
  providerId: string;
  threadId: string | null;
}

export interface SyncResult {
  // The cursor to resume from next time. Null keeps the one there is.
  cursor: string | null;
}

export interface SourceAdapter {
  /**
   * Incremental sync from the stored cursor (Gmail's history id, IMAP UIDs, a sync token). A null
   * cursor is the first run. Writes what changed to the mirror, noting live events.
   */
  sync(context: AdapterContext, cursor: string | null): Promise<SyncResult>;
  /** The reconciliation sweep: re-reads a window and repairs what a missed push or cursor gap left. */
  sweep(context: AdapterContext): Promise<void>;
  /**
   * The push trigger, for providers that have one: starts or renews it (Pub/Sub pull, a Calendar
   * watch channel), calling `pushed` whenever the provider says something changed. Returns when it
   * must be renewed.
   */
  watch?(context: AdapterContext, pushed: () => void): Promise<{renewBy: string | null}>;
  /**
   * The heartbeat for a quiet source: a cheap call the provider must answer (IMAP NOOP, a token
   * refresh). Without one, the scheduled sync or sweep is the heartbeat.
   */
  heartbeat?(context: AdapterContext): Promise<void>;
  /**
   * Carries out a command (src/commands/). Resolves once the provider confirms it. Otherwise throws
   * a ProviderError with the provider's own message. The mirror already shows the change where the
   * command layer applies it up front. An adapter may record what the provider assigned (a new
   * item's id).
   */
  execute(context: AdapterContext, command: CommandRow): Promise<void>;
  /**
   * A mail adapter's attachment, for the reader's preview: the email's source fetched again and the
   * part the record knows by `attachmentId` (its MIME part, as the sync's parse named it). Null when
   * the provider no longer has the email or the part.
   */
  attachment?(context: AdapterContext, message: {providerId: string}, attachmentId: string): Promise<AttachmentBytes | null>;
  /**
   * A mail adapter's email, its RFC 822 source fetched again: a USPS digest's scans, which
   * the record doesn't keep. Null when the provider no longer has the email.
   */
  source?(context: AdapterContext, message: {providerId: string}): Promise<Buffer | null>;
  /**
   * A mail adapter's send: the provider takes the email, and the copy is in its sent mail. Resolves
   * with the sent email's id once the provider accepted it; otherwise throws a ProviderError in the
   * provider's words.
   */
  send?(context: AdapterContext, mail: OutgoingMail): Promise<SentMail>;
  /**
   * The sent email with this Message-ID, when the provider's sent mail holds it: asked before a send
   * runs again after one that reached the provider (a restart mid-send), so it never goes twice.
   * `certain` says whether "not there" means it was never accepted (Gmail files every send in SENT)
   * or only that no copy is there yet.
   */
  findSent?(context: AdapterContext, rfc822Id: string): Promise<{sent: SentMail | null; certain: boolean}>;
}

/** Which adapter serves a source: by provider for real ones, the dev provider for dev ones. */
export interface AdapterRegistry {
  adapterFor(source: SourceRow): SourceAdapter | null;
}
