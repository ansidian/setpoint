// A provider's trouble in a sentence. The server keeps a provider's message as its own words, then
// the HTTP status in brackets ("Scheduled maintenance (503 Service Unavailable)"), or the status
// alone. The status picks the verb: a 5xx "is down", a 429 "is limiting requests", any other
// refusal "is refusing Setpoint", and no status at all "can't be reached". The provider's words
// follow in brackets, their first letter lowercased, and are left out when there are none. The
// status itself stays out of the sentence.
import type {CommandOut, SourceProvider} from '@setpoint/shared';
import {clockTime} from './format.ts';

export const PROVIDER_NAMES: Record<SourceProvider, string> = {gmail: 'Gmail', icloud: 'iCloud', google_calendar: 'Google Calendar', todoist: 'Todoist', weather: 'Weather'};

/** A provider's message split into its own words and its HTTP status, either of which may be missing. */
export function splitProviderMessage(message: string): {words: string; status: number | null} {
  const trimmed = message.trim();
  const bracketed = /^(.*?)\s*\((\d{3})\b[^()]*\)$/.exec(trimmed);
  if (bracketed) return {words: (bracketed[1] ?? '').trim(), status: Number(bracketed[2])};
  const bare = /^(\d{3})\b/.exec(trimmed);
  if (bare) return {words: '', status: Number(bare[1])};
  return {words: trimmed, status: null};
}

const verbFor = (status: number | null) =>
  status === null ? 'can\'t be reached' : status >= 500 ? 'is down' : status === 429 ? 'is limiting requests' : 'is refusing Setpoint';

/** "Todoist is down (scheduled maintenance)". */
export function troubleLine(provider: SourceProvider | null, message: string): string {
  const {words, status} = splitProviderMessage(message);
  const detail = words ? ` (${words.charAt(0).toLowerCase()}${words.slice(1).replace(/\.$/, '')})` : '';
  return `${provider ? PROVIDER_NAMES[provider] : 'The provider'} ${verbFor(status)}${detail}`;
}

/**
 * A pending change its provider couldn't take for now, as of its latest try:
 * "Todoist is down (scheduled maintenance) as of 7:26 PM". Null when it isn't waiting to try again.
 */
export function retryingLine(command: Pick<CommandOut, 'state' | 'provider' | 'provider_message' | 'retry'> | null | undefined, timeZone: string): string | null {
  if (command?.state !== 'pending' || !command.provider_message || !command.retry) return null;
  return `${troubleLine(command.provider, command.provider_message)} as of ${clockTime(command.retry.failed_at, timeZone)}`;
}
