// The adapter interface every provider implements (BUILD-PLAN.md › B1 › The sync engine): the
// engine schedules and records; adapters talk to their provider. B2 adds Gmail and iCloud, B5
// Google Calendar, Todoist and weather; the dev provider serves the seed.
import type {Credentials} from '@setpoint/shared';
import type * as t from '../db/schema.ts';
import type {Store} from '../store.ts';

export type SourceRow = typeof t.sources.$inferSelect;
export type CommandRow = typeof t.commands.$inferSelect;

export interface AdapterContext {
  store: Store;
  source: SourceRow;
  // Decrypted on demand; null for a source without credentials (the dev provider's).
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

export interface SyncResult {
  // The cursor to resume from next time; null keeps the one there is.
  cursor: string | null;
}

export interface SourceAdapter {
  /**
   * Incremental sync from the stored cursor (Gmail's history id, IMAP UIDs, a sync token); a null
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
   * Carries out a command (src/commands/). Resolves once the provider confirms it; throws a
   * ProviderError with the provider's own message otherwise. The mirror already shows the change
   * where the command layer applies it up front; an adapter may record what the provider assigned
   * (a new item's id).
   */
  execute(context: AdapterContext, command: CommandRow): Promise<void>;
  /**
   * A mail adapter's attachment, for the reader's preview: the email's source fetched again and the
   * part the record knows by `attachmentId` (its MIME part, as the sync's parse named it). Null when
   * the provider no longer has the email or the part.
   */
  attachment?(context: AdapterContext, message: {providerId: string}, attachmentId: string): Promise<AttachmentBytes | null>;
}

/** Which adapter serves a source: by provider for real ones, the dev provider for dev ones. */
export interface AdapterRegistry {
  adapterFor(source: SourceRow): SourceAdapter | null;
}
