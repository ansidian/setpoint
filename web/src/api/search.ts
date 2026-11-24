// Search, Alfred and proposals (shared/src/api/search.ts has the routes). None of these is cached,
// because a search, an answer and a proposal belong to the screen that asked for them. Create is
// the one change here. It is a command: pending until its provider confirms it, failed with the
// provider's words.
import type {AnswerOut, AskContext, AskStepOut, CalendarSearchChip, ConversationOut, CalendarSearchOut, ItemKind, ProposalOut, ProposalPrefillOut, SearchChip, SearchOut, SearchRead, SearchSent, SearchSuggestOut} from '@setpoint/shared';
import {getJson, sendJson} from './client.ts';

export const SETTINGS_PATH = '/settings';

export interface SearchQuery {
  text: string;
  chips: SearchChip[];
  // A suggestion's chips, kept or what they left out.
  read?: SearchRead;
  // With `read`: the words as typed, which rank and which the chips' "more" number counts from.
  typed?: string;
  // A later page of the same search.
  page?: {search_id: number; offset: number};
  // Where it's searched from: the Inbox's with sent mail too, Sent's with sent mail only, in an account.
  scope?: SearchScope;
}

/** What a search covers besides its words: sent mail, and one account. The phone asks for neither. */
export interface SearchScope {
  sent?: SearchSent;
  account_id?: number;
}

export const searchMail = ({text, chips, read, typed, page, scope}: SearchQuery) =>
  sendJson<SearchOut>('POST', '/search', {text, chips, ...(read ? {read} : {}), ...(typed === undefined ? {} : {typed}), ...(page ?? {}), ...scope});

/**
 * A suggestion for the field's exact text. Without `model` it is the grammar's date alone. With
 * `model` it adds a reading too, the only way a search reaches a model. `signal` drops it once the
 * text has moved on.
 */
export const searchSuggestion = ({text, chips}: Pick<SearchQuery, 'text' | 'chips'>, model: boolean, signal: AbortSignal) =>
  sendJson<SearchSuggestOut>('POST', '/search/suggestion', {text, chips, model}, {signal});

/** The search log: a suggestion on screen, or accepted, so suggestions can be judged. */
export const searchSuggestionLog = (id: number, event: 'shown' | 'accepted', searchId?: number) =>
  sendJson<void>('POST', '/search/suggestion-log', {id, event, ...(searchId === undefined ? {} : {search_id: searchId})});

/** The search log: a chip the user took off a search, so a wrong reading can be seen. */
export const searchChipRemoved = (searchId: number, chip: SearchChip) => sendJson<void>('POST', '/search/chip-removed', {search_id: searchId, chip});

/** The calendar's search. A later page passes the last one's `next_offset`. Not logged. */
export const searchCalendar = ({text, chips, offset}: {text: string; chips: CalendarSearchChip[]; offset: number}) =>
  sendJson<CalendarSearchOut>('POST', '/calendar/search', {text, chips, ...(offset ? {offset} : {})});

/** The search log: which result the user opened, and where it was in the list. */
export const searchOpened = (searchId: number, messageId: number, position: number) =>
  sendJson<void>('POST', '/search/opened', {search_id: searchId, message_id: messageId, position});

/** A question. A follow-up names its conversation, and Ask about this email names the email. */
export const askAlfred = (question: string, {conversation, message, context, ask}: {conversation?: number | null; message?: number | null; context?: AskContext | null; ask?: string} = {}) =>
  sendJson<AnswerOut>('POST', '/alfred/ask', {question, ...(conversation ? {conversation_id: conversation} : {}), ...(message ? {message_id: message} : {}), ...(context ? {context} : {}), ...(ask ? {ask_id: ask} : {})});

/** A thread so far, read back after a reload, with whether the server has ended it. No model call. */
export const alfredConversation = (id: number) => getJson<ConversationOut>(`/alfred/conversations/${id}`);

/** What Alfred is doing for a question on its way, by the id the page gave it. */
export const alfredStep = (ask: string) => getJson<AskStepOut>(`/alfred/asks/${ask}`);

/** Add to calendar / Add as task: the item pre-filled from the email, created by nothing. */
export const proposeFromMessage = (messageId: number, kind: ItemKind) => sendJson<ProposalOut>('POST', '/proposals/from-message', {message_id: messageId, kind});

/** The same proposal with its fields read from the email by a model, or why there was no call. */
export const prefillFromMessage = (messageId: number, kind: ItemKind) => sendJson<ProposalPrefillOut>('POST', '/proposals/prefill', {message_id: messageId, kind});

