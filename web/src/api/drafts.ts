// Drafts and sending (shared/src/api/drafts.ts has the routes). A draft lives in Setpoint only, is
// started filled on the server, and saved as the user types. Send holds it on the server for
// SEND_HOLD_MS with Undo. The Drafts list, the draft itself and its email's row refresh by the live
// stream's `drafts` key (logic/live.ts).
import type {DraftCreateInput, DraftOut, DraftSavedOut, DraftUpdateInput, DraftWriteInput, DraftWrittenOut, PeopleOut, Recipient} from '@setpoint/shared';
import {getJson, refreshIfShown, sendJson, setCached, updateCached} from './client.ts';
import {messagePath} from './mail.ts';

export const DRAFTS_PATH = '/mail/drafts';
export const FROM_PATH = '/mail/from';
export const draftPath = (id: number) => `/mail/drafts/${id}`;

/** Starts a draft, or answers the one this email already has of that kind. */
export async function startDraft(input: DraftCreateInput): Promise<DraftOut> {
  const draft = await sendJson<DraftOut>('POST', DRAFTS_PATH, input);
  setCached(draftPath(draft.id), draft);
  refreshIfShown(DRAFTS_PATH);
  return draft;
}

/** Saves what changed. The answer is small: the draft in the cache takes the change at once. */
export async function saveDraft(id: number, changes: DraftUpdateInput, {keepalive = false} = {}): Promise<DraftSavedOut> {
  updateCached<DraftOut>(draftPath(id), draft => ({...draft, ...changes} as DraftOut));
  const saved = await sendJson<DraftSavedOut>('PATCH', draftPath(id), changes, {keepalive});
  updateCached<DraftOut>(draftPath(id), draft => ({...draft, updated_at: saved.updated_at}));
  return saved;
}

export async function discardDraft(id: number, messageId: number | null): Promise<void> {
  await sendJson<void>('DELETE', draftPath(id));
  refreshIfShown(DRAFTS_PATH);
  if (messageId !== null) refreshIfShown(messagePath(messageId));
}

/** Send, and Try again after a failure: the server holds it SEND_HOLD_MS. */
export async function sendDraft(id: number): Promise<DraftOut> {
  const draft = await sendJson<DraftOut>('POST', `${draftPath(id)}/send`);
  setCached(draftPath(id), draft);
  refreshIfShown(DRAFTS_PATH);
  return draft;
}

/** Undo within the hold: the draft comes back untouched. 409 `draft_not_held` once it has gone. */
export async function undoSend(id: number): Promise<DraftOut> {
  const draft = await sendJson<DraftOut>('POST', `${draftPath(id)}/undo`);
  setCached(draftPath(id), draft);
  refreshIfShown(DRAFTS_PATH);
  return draft;
}

/** Help me write: the new body, or the selection's new text, as blocks. Nothing is saved by it. */
export const writeDraft = (id: number, input: DraftWriteInput) => sendJson<DraftWrittenOut>('POST', `${draftPath(id)}/write`, input);

/** The draft as the server has it now. */
export const loadDraft = (id: number) => getJson<DraftOut>(draftPath(id));

/** People to suggest for what's typed in a recipient field. */
export async function suggestPeople(query: string): Promise<Recipient[]> {
  return (await getJson<PeopleOut>(`/mail/people?q=${encodeURIComponent(query)}&limit=6`)).people;
}
