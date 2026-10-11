// What every part of the API shares. Fields are snake_case, instants are ISO 8601 UTC strings
// ("2026-10-07T16:12:00.000Z") and dates are local `YYYY-MM-DD` in the owner's zone.
import {z} from 'zod';
import {COMMAND_KINDS, COMMAND_STATES, COMMAND_TARGETS, HEALTH_STATES, SOURCE_PROVIDERS} from '../enums.ts';
import type {CommandKind, CommandState, CommandTarget, HealthState, SourceProvider} from '../enums.ts';

/** Every refusal: a stable code to branch on and a sentence to show. */
export interface ApiError {
  error: {code: string; message: string; details?: unknown};
}

export const instant = z.iso.datetime();
export const localDate = z.iso.date();
export const id = z.int().positive();

/**
 * A source's health (decision 31; DESIGN.md › Health and states). `as_of` is the last successful
 * check, for "Personal, as of 9:14 PM"; `reason` is the provider's error while failing.
 */
export interface HealthOut {
  state: HealthState;
  as_of: string | null;
  reason: string | null;
  last_check_at: string | null;
}
export const healthStateSchema = z.enum(HEALTH_STATES);

/**
 * A change sent to a provider (DESIGN.md › Interaction rules: pending until the provider confirms,
 * failed in place with its own words otherwise). A row with an active command shows it: pending at
 * .5 opacity, failed with `provider_message`, Try again and, where `can_move_back`, Move back.
 */
export interface CommandOut {
  id: number;
  target: CommandTarget;
  target_id: number;
  kind: CommandKind;
  state: CommandState;
  // The provider that carries it out, for "Google Calendar · …"; null when it never reached one.
  provider: SourceProvider | null;
  provider_message: string | null;
  can_retry: boolean;
  can_move_back: boolean;
  // An item change's earlier time, for "From Fri, Oct 9" (board 19b); null otherwise.
  previous: ItemWhen | null;
  created_at: string;
  settled_at: string | null;
}

/** When an item happens: a timed event, an all-day event (end exclusive), or a task's due day. */
export interface ItemWhen {
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  due_at: string | null;
}

export const commandStateSchema = z.enum(COMMAND_STATES);
export const commandKindSchema = z.enum(COMMAND_KINDS);
export const commandTargetSchema = z.enum(COMMAND_TARGETS);
export const sourceProviderSchema = z.enum(SOURCE_PROVIDERS);

/** GET /api/commands?active=true: the changes still pending or failed. */
export const commandListInput = z.strictObject({active: z.stringbool().optional()});
