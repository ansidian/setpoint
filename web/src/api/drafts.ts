// Drafts and sending (shared/src/api/drafts.ts has the routes). A draft lives in Setpoint only, is
// started filled on the server, and saved as the user types. Send holds it on the server for
// SEND_HOLD_MS with Undo. The Drafts list, the draft itself and its email's row refresh by the live
// stream's `drafts` key (logic/live.ts).
import type {DraftCreateInput, DraftFileOut, DraftFilesTakeInput, DraftOut, DraftSavedOut, DraftUpdateInput, DraftWriteInput, DraftWrittenOut, PeopleOut, Recipient} from '@setpoint/shared';
import {getCached, getJson, refreshIfShown, sendJson, setCached, updateCached} from './client.ts';
import {messagePath} from './mail.ts';

export const DRAFTS_PATH = '/mail/drafts';
export const FROM_PATH = '/mail/from';
export const draftPath = (id: number) => `/mail/drafts/${id}`;

/** Starts a draft, or answers the one this email already has of that kind. */
export async function startDraft(input: DraftCreateInput): Promise<DraftOut> {
  const draft = await sendJson<DraftOut>('POST', DRAFTS_PATH, input);
  // An email's draft this tab already has stays as the tab has it: the answer may be older than a
  // save that landed meanwhile (two starts of the same draft).
  if (!getCached<DraftOut>(draftPath(draft.id))) setCached(draftPath(draft.id), draft);
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

/** Discards a draft; `keepalive` lets it outlive a closing tab. */
export async function discardDraft(id: number, messageId: number | null, {keepalive = false} = {}): Promise<void> {
  await sendJson<void>('DELETE', draftPath(id), undefined, {keepalive});
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

/**
 * Attaches a file to a draft: its bytes in their own type, its name in the address. Refused 413
 * `too_large` with the reason when the attachments would cross 25 MB.
 */
export async function uploadDraftFile(id: number, file: File): Promise<DraftFileOut> {
  const added = await sendJson<DraftFileOut>('POST', `${draftPath(id)}/files?name=${encodeURIComponent(file.name)}`, new Blob([file], {type: file.type || 'application/octet-stream'}));
  updateCached<DraftOut>(draftPath(id), draft => ({...draft, files: [...draft.files.filter(one => one.id !== added.id), added]}));
  return added;
}

/** Takes a file off a draft. Its bytes go from the server at once. */
export async function removeDraftFile(id: number, fileId: number): Promise<void> {
  updateCached<DraftOut>(draftPath(id), draft => ({...draft, files: draft.files.filter(one => one.id !== fileId)}));
  await sendJson<void>('DELETE', `${draftPath(id)}/files/${fileId}`);
}

/** Takes files onto a draft by id: a discarded draft's (Undo), or the draft a kind switch replaces. */
export async function takeDraftFiles(id: number, ids: number[]): Promise<DraftFileOut[]> {
  if (!ids.length) return getCached<DraftOut>(draftPath(id))?.files ?? [];
  const {files} = await sendJson<{files: DraftFileOut[]}>('POST', `${draftPath(id)}/files/take`, {ids} satisfies DraftFilesTakeInput);
  updateCached<DraftOut>(draftPath(id), draft => ({...draft, files}));
  return files;
}
