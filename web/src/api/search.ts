// Search, Alfred and proposals (shared/src/api/search.ts has the routes). None of these is cached:
// a search, an answer and a proposal belong to the screen that asked for them. Create is the one
// change here, a command: pending until its provider confirms it, failed with the provider's words.
import type {AnswerOut, AskStepOut, CalendarSearchChip, CalendarSearchOut, CommandOut, ItemKind, ProposalItemOut, ProposalOut, SearchChip, SearchOut} from '@setpoint/shared';
import {getJson, sendJson} from './client.ts';
import {untilSettled} from './items.ts';

export const SETTINGS_PATH = '/settings';

export interface SearchQuery {
  text: string;
  chips: SearchChip[];
  account: number | null;
  // A later page of the same search.
  page?: {search_id: number; offset: number};
}

export const searchMail = ({text, chips, account, page}: SearchQuery) =>
  sendJson<SearchOut>('POST', '/search', {text, chips, ...(account ? {account_id: account} : {}), ...(page ?? {})});

/** SV-23: the calendar's search; a later page passes the last one's `next_offset`. Not logged. */
export const searchCalendar = ({text, chips, offset}: {text: string; chips: CalendarSearchChip[]; offset: number}) =>
  sendJson<CalendarSearchOut>('POST', '/calendar/search', {text, chips, ...(offset ? {offset} : {})});

/** The search log: which result the user opened, and where it was in the list. */
export const searchOpened = (searchId: number, messageId: number, position: number) =>
  sendJson<void>('POST', '/search/opened', {search_id: searchId, message_id: messageId, position});

/** A question; a follow-up names its conversation; Ask about this email names the email. */
export const askAlfred = (question: string, {conversation, message, ask}: {conversation?: number | null; message?: number | null; ask?: string} = {}) =>
  sendJson<AnswerOut>('POST', '/alfred/ask', {question, ...(conversation ? {conversation_id: conversation} : {}), ...(message ? {message_id: message} : {}), ...(ask ? {ask_id: ask} : {})});

/** What Alfred is doing for a question on its way, by the id the page gave it. */
export const alfredStep = (ask: string) => getJson<AskStepOut>(`/alfred/asks/${ask}`);

/** Add to calendar / Add as task: the item pre-filled from the email, created by nothing. */
export const proposeFromMessage = (messageId: number, kind: ItemKind) => sendJson<ProposalOut>('POST', '/proposals/from-message', {message_id: messageId, kind});

/**
 * Create: POST /api/items, then the command until its provider settles it. Resolves with the
 * command as it last stood (still pending if the provider takes over a minute).
 */
export async function createItem(item: ProposalItemOut & {reminders?: number[]; create_project?: boolean}, onPending: (command: CommandOut) => void): Promise<CommandOut> {
  const command = await sendJson<CommandOut>('POST', '/items', item);
  onPending(command);
  return untilSettled(command);
}
