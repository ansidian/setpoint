// A provider's trouble in a sentence. The server keeps a provider's message as its words, then a code
// in brackets: an HTTP status ("Scheduled maintenance (503 Service Unavailable)"), or another code
// ("Token has been expired or revoked. (invalid_grant)"), or the status alone ("503 Service
// Unavailable"). Words with no status are Setpoint's own sentence ("Todoist didn't answer in time.",
// "Couldn't reach Todoist (ENOTFOUND).") or the provider's ("550 5.1.1 … User unknown") and stand as
// written, as does a provider's full sentence ("The calendar is read-only. (403 Forbidden)").
// Otherwise the status picks the verb: a 5xx "is down", a 429 "is limiting requests", any other
// refusal "is refusing Setpoint". The words follow in brackets, lowercased, and are left out when
// they only repeat the status. The code itself stays out of the sentence.
import type {CommandOut, SourceProvider} from '@setpoint/shared';
import {clockTime} from './format.ts';

export const PROVIDER_NAMES: Record<SourceProvider, string> = {gmail: 'Gmail', icloud: 'iCloud', google_calendar: 'Google Calendar', todoist: 'Todoist', weather: 'Weather'};

export interface ProviderMessage {
  // Its words without the code, as written.
  words: string;
  // The HTTP status, when the code is one.
  status: number | null;
  // The code in brackets, for a tooltip: "503 Service Unavailable", "invalid_grant".
  code: string | null;
  // Whether the words are a whole sentence, which stands as written.
  sentence: boolean;
}

// A code is a status with its phrase, or one token: "ENOTFOUND", "invalid_grant", "529".
const CODE = /^(\d{3}\b[^()]*|[A-Z0-9_]+|[a-z]+_[a-z_]+)$/;

/** A provider's message read into its words and its code, either of which may be missing. */
export function splitProviderMessage(message: string): ProviderMessage {
  const trimmed = message.trim();
  const bracketed = /^(.*?)\s*\(([^()]+)\)(\.?)$/.exec(trimmed);
  if (bracketed && CODE.test(bracketed[2]!.trim())) {
    const words = bracketed[1]!.trim();
    const code = bracketed[2]!.trim();
    const status = /^\d{3}\b/.test(code) ? Number(code.slice(0, 3)) : null;
    const phrase = status === null ? null : code.slice(3).trim();
    const said = words === phrase ? '' : words;
    return {words: said, status, code, sentence: status === null || /[.!?]$/.test(said) || (bracketed[3] === '.' && said !== '')};
  }
  if (/^\d{3} [A-Za-z' -]+$/.test(trimmed)) return {words: '', status: Number(trimmed.slice(0, 3)), code: trimmed, sentence: false};
  return {words: trimmed, status: null, code: null, sentence: true};
}

const verbFor = (status: number) => (status >= 500 ? 'is down' : status === 429 ? 'is limiting requests' : 'is refusing Setpoint');

// Lowercased in brackets: a label in title case wholly ("Rate Limit Exceeded" → "rate limit
// exceeded"), else its first letter; an abbreviation keeps its capitals.
const lowered = (words: string) => (/^([A-Z][a-z']*)( [A-Z][a-z']*)*$/.test(words)
  ? words.toLowerCase()
  : /^[A-Z][A-Z0-9]/.test(words) ? words : `${words.charAt(0).toLowerCase()}${words.slice(1)}`);
const unstopped = (words: string) => words.replace(/\.$/, '');

/**
 * The trouble without a name, for a row that already names its source ("is down (scheduled
 * maintenance)"), or null when the message is a sentence that stands as written.
 */
export function troubleWords(message: string): string | null {
  const {words, status, sentence} = splitProviderMessage(message);
  if (sentence || status === null) return null;
  return `${verbFor(status)}${words ? ` (${lowered(unstopped(words))})` : ''}`;
}

/** A line's tooltip: the line, then the message's code as metadata ("… · 503 Service Unavailable"). */
export function withCode(line: string, message: string | null | undefined): string {
  const code = message ? splitProviderMessage(message).code : null;
  return code ? `${line} · ${code}` : line;
}

/** The message as a sentence without its last full stop or its code: "Todoist didn't answer in time". */
const sentenceOf = (message: string) => {
  const words = unstopped(splitProviderMessage(message).words);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/**
 * "Todoist is down (scheduled maintenance)", or another name's ("Personal is down"), or the
 * message's own sentence ("Todoist didn't answer in time"). No last full stop.
 */
export function troubleLine(provider: SourceProvider | string | null, message: string): string {
  const name = provider === null ? 'The provider' : provider in PROVIDER_NAMES ? PROVIDER_NAMES[provider as SourceProvider] : provider;
  const words = troubleWords(message);
  return words === null ? sentenceOf(message) : `${name} ${words}`;
}

/**
 * Why a provider refused a change, standing alone beside it: its own sentence ("The calendar is
 * read-only."), else its trouble ("Todoist is down (scheduled maintenance)."). Never the code.
 */
export function refusalWords(provider: SourceProvider | null, message: string | null, fallback: string): string {
  if (!message) return fallback;
  const line = troubleLine(provider, message);
  return /[!?]$/.test(line) ? line : `${line}.`;
}

// Names a reason may start with, which keep their capital.
const NAMES = /^(Setpoint|Alfred|Anthropic|Gmail|iCloud|Google|Todoist|Weather|Pirate Weather|ntfy)\b/;

/**
 * A failure line, "Failed to pin, can't reach Setpoint": what failed, then why, its last full stop
 * gone and its first capital lowered unless it starts with a name or an abbreviation.
 */
export function failureText(what: string, why: string): string {
  const reason = why.trim().replace(/\.$/, '');
  const keep = NAMES.test(reason) || /^[A-Z][A-Z0-9]/.test(reason);
  return `${what}, ${keep ? reason : `${reason.charAt(0).toLowerCase()}${reason.slice(1)}`}`;
}

/**
 * A pending change its provider couldn't take for now, as of its latest try:
 * "Todoist is down (scheduled maintenance) as of 7:26 PM". Null when it isn't waiting to try again.
 */
export function retryingLine(command: Pick<CommandOut, 'state' | 'provider' | 'provider_message' | 'retry'> | null | undefined, timeZone: string): string | null {
  if (command?.state !== 'pending' || !command.provider_message || !command.retry) return null;
  return `${troubleLine(command.provider, command.provider_message)} as of ${clockTime(command.retry.failed_at, timeZone)}`;
}
