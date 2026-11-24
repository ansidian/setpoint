// The phone's editor: the desktop's editor (calendar/Editor.tsx) in the full-screen sheet, with its
// line and fields, the day and times as iOS's own pickers and one item at a time (no Add another),
// and the .ics import review in a sheet of its own. Created from an email, it turns into the new
// item's detail. Anything on the phone
// opens it with `openEditorSheet`: the Agenda's + (a new item on a day) and Edit (an item), an
// email's Add to calendar or Add as task (`message`, which fills it from the email's proposal as the
// desktop's More options does), an invitation's Add to calendar (`ics`, one event as a draft), and
// Alfred's proposal card (`openProposalSheet`, the draft his answer proposed).
// An invitation of two or more events opens the review instead (importRun.ts's `openReview`), which
// shows here too. The shell draws one `PhoneSheets`.
import type {CalendarOut, ItemOut, ItemsOut, ProposalOut} from '@setpoint/shared';
import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, itemsPath} from '../../api/items.ts';
import {itemDays, itemsByDay} from '../../logic/calendar.ts';
import {emptyDraft, fromProposal} from '../../logic/editorDraft.ts';
import {addDays, localDate} from '../../logic/format.ts';
import {editedImport, eventDay} from '../../logic/icsImport.ts';
import {scopeChoices} from '../../logic/scope.ts';
import {useNow} from '../clock.ts';
import {Editor} from '../calendar/Editor.tsx';
import type {EditorOpen} from '../calendar/Editor.tsx';
import {ImportPane} from '../calendar/ImportPane.tsx';
import {handIcs, importFromEditor, useHandedIcs, useImportReview} from '../calendar/importRun.ts';
import {CreatedItemDetail} from '../CreatedItem.tsx';
import {BottomSheet, SheetChoice} from './BottomSheet.tsx';
import {createFromSheet, deleteWithUndo, saveFromSheet} from './itemActions.ts';
import './editorSheet.css';

type Opened = EditorOpen & {seq: number};

let opened: Opened | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const set = (next: Opened | null) => {
  opened = next;
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Opens the editor sheet: a new event or task on `date` (`kind`), filled from an email (`message`)
 * or an .ics event (`ics`), or an existing item to edit (`item`). One is open at a time.
 */
export function openEditorSheet(open: EditorOpen) {
  made = null;
  set({...open, seq: ++seq});
}

/**
 * Opens the editor sheet on a proposal as it stands, Alfred's in an answer: his title, day, times
 * and place, not the email's own reading of them again (`message` would ask the server for that).
 */
export function openProposalSheet(proposal: ProposalOut, today: string, zone: string, onActed?: () => void) {
  const draft = fromProposal(emptyDraft(proposal.kind, today), {proposal, reminders: null, newProject: false}, zone);
  openEditorSheet({kind: proposal.kind, date: draft.date, kept: {drafts: [draft], active: draft.id, kind: proposal.kind}, onActed});
}

export const closeEditorSheet = () => set(null);

// An item just created from an email (`message` or `ics`): the sheet turns into its detail
// (CreatedItem.tsx), held by a skeleton until the server names it (`id` null). Gone when it couldn't be made.
let made: {seq: number; id: number | null} | null = null;
const showMade = (next: typeof made) => {
  made = next;
  listeners.forEach(listener => listener());
};
const closeMade = () => showMade(null);
/** The detail for the item the sheet `seq` is making, once the server names it. A later sheet has the place. */
const madeAs = (seq: number) => (id: number | null) => {
  if (made?.seq === seq) showMade(id === null ? null : {seq, id});
};

export const useEditorSheet = () => useSyncExternalStore(subscribe, () => opened);

// A repeating event's Delete, asking which of its events go.
let asking: ItemOut | null = null;
const ask = (item: ItemOut | null) => {
  asking = item;
  listeners.forEach(listener => listener());
};

/**
 * Delete on the phone: with Undo in the toast (itemActions.ts). A repeating event first asks This
 * event, This and following or All events in the bottom sheet, as the desktop asks beside it.
 */
export function removeItem(item: ItemOut) {
  if (item.kind === 'event' && item.recurring) ask(item);
  else deleteWithUndo(item);
}

const EMPTY: ItemOut[] = [];

/** The editor sheet while one is open, else the import review while one is under way. */
export function PhoneSheets() {
  const open = useEditorSheet();
  const zone = timeZone();
  const handed = useHandedIcs();
  const review = useImportReview();
  const deleting = useSyncExternalStore(subscribe, () => asking);
  const created = useSyncExternalStore(subscribe, () => made);
  const today = localDate(useNow(), zone);
  const {data: allCalendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const calendars = useMemo(() => allCalendars?.filter(calendar => calendar.listed), [allCalendars]);
  const google = useMemo(() => (calendars ?? []).filter(calendar => calendar.provider === 'google' && calendar.writable), [calendars]);

  // An invitation of one event, handed over as Calendar's file would be: the sheet opens on its draft.
  useEffect(() => {
    if (!handed) return;
    handIcs(null);
    openEditorSheet({kind: 'event', date: eventDay(handed, zone), ics: handed});
  }, [handed, zone]);

  if (deleting) {
    const from = itemDays(deleting, zone)[0] ?? today;
    return (
      <BottomSheet title="Delete recurring event" onClose={() => ask(null)}>
        {scopeChoices(from, from).map(choice => (
          <SheetChoice key={choice.scope} label={choice.label} detail={choice.line} onChoose={() => deleteWithUndo(deleting, choice.scope)} />
        ))}
      </BottomSheet>
    );
  }
  if (open) return <EditorSheet key={open.seq} open={open} calendars={calendars} />;
  if (created) {
    return (
      <CreatedItemDetail key={created.seq} id={created.id} onClose={closeMade} remove={removeItem}
        onEdit={(item, date) => {
          closeMade();
          openEditorSheet({kind: item.kind, date, item});
        }} />
    );
  }
  if (review) {
    return <ImportPane sheet review={review} calendars={google} fallback={google.find(one => one.visible)?.id ?? google[0]?.id ?? null} timeZone={zone} />;
  }
  return null;
}

function EditorSheet({open, calendars}: {open: Opened; calendars: CalendarOut[] | undefined}) {
  const zone = timeZone();
  const today = localDate(useNow(), zone);
  // The conflict preview's day: the new draft's as it changes, else the edited item's.
  const [day, setDay] = useState(() => (open.item ? itemDays(open.item, zone)[0] ?? open.date : open.date));
  const onPreview = useCallback((_: ItemOut[], previewed: string | null) => {
    if (previewed) setDay(current => (current === previewed ? current : previewed));
  }, []);
  const {data: dayList} = useResource<ItemsOut>(itemsPath(day, addDays(day, 1)));
  const byDay = useMemo(() => itemsByDay(dayList?.items ?? [], calendars, zone), [dayList, calendars, zone]);
  const dayItems = useCallback((date: string) => byDay.get(date) ?? EMPTY, [byDay]);
  return (
    <Editor sheet open={open} calendars={calendars} today={today} timeZone={zone} handed={false} dayItems={dayItems} onPreview={onPreview}
      onCreate={inputs => {
        closeEditorSheet();
        // From an email, the sheet turns into the new item's detail: the first one's, when drafts were
        // added beside it. A task with no date isn't on the calendar once Todoist has it: the toast says it was made.
        const first = inputs[0];
        const fromEmail = ((open.message ?? null) !== null || open.ics !== undefined) && first !== undefined && !(first.kind === 'task' && !first.due_date);
        if (fromEmail) showMade({seq: open.seq, id: null});
        const shown = fromEmail ? madeAs(open.seq) : undefined;
        // The .ics draft is imported with its iCalUID, as on the desktop. Drafts added beside it are created as usual.
        const imported = open.ics ? inputs[0]! : null;
        if (open.ics && imported) void importFromEditor(imported.calendar_id, calendars?.find(one => one.id === imported.calendar_id)?.name ?? 'the calendar', editedImport(open.ics, imported), shown);
        createFromSheet(imported ? inputs.slice(1) : inputs, open.onActed, imported ? undefined : shown && (ids => shown(ids[0] ?? null)));
      }}
      onSave={(item, changes, scope) => {
        closeEditorSheet();
        saveFromSheet(item, changes, scope, open.onActed);
      }}
      onDelete={item => {
        closeEditorSheet();
        removeItem(item);
      }}
      onClose={closeEditorSheet} />
  );
}
