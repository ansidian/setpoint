// The editor in the right pane (boards 13 and 14). A new event or task starts from one line that
// parses as it's typed ("Dinner with Sam fri 7-9pm @Blue Door": date, time and end, place, calendar,
// each parsed part marked). The fields under it are there to check or change: the title, the date
// and times, the place with Places suggestions, the calendar, reminders (Settings › Notifications'
// default, presets and Custom…, Reminders.tsx), the repeat, then the conflict preview, a small
// timeline of the day. Batch drafts add more events ("Create 2 events ⌘Enter"). A Todoist task uses
// the same editor with its due date, project, labels and repeat (Todoist's words, sent with the date).
// Opened from an email (the proposal card's More options), the fields hold what the card held. Those
// the email gave keep the card's "from the email" mark until they're changed. Opened from News's
// Upcoming (its Add to calendar), it holds the keynote's proposal, as an email's is, its calendar
// picked the same way, but with no "from the email" marks. Editing an item shows its fields directly
// (board 14) and says what it was ("Was 7:00 – 8:00 AM"). A recurring event asks This event, This and
// following or All events in place of the footer before it saves. Alfred's change to an item opens
// it so, his changes filled in and marked as his, the scope he picked chosen. Nothing is created or
// changed until ⌘Enter.
import type {CalendarOut, Colour, IcsEventOut, ItemChanges, ItemCreateInput, ItemKind, ItemOut, ItemsOut, PlaceSuggestionOut, ProposalChangeOut, ProposalOut, RecurringScope, Settings, TodoistLabelOut, TodoistProjectOut} from '@setpoint/shared';
import {allSavedPlaces, isFree, proposalConflict, savedPlaceFor, TODOIST_COLOURS} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';
import {useResource} from '../../api/client.ts';
import {itemsPath, placeSuggestions, proposalFrom, SETTINGS_PATH, TODOIST_LABELS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {newsProposal} from '../../api/news.ts';
import {findPlace} from '../../api/settings.ts';
import {calendarLabel, dayTitle, timeRange} from '../../logic/calendar.ts';
import {bareToken, clockLabel, completeToken, describeRule, describeTaskRepeat, draftStarted, endChoices, extraDays, NO_END, parseClock, parseDay, parseDays, parseTitle, PLACE_URL, readEnd, repeatChoices, spanTo, taskRepeatChoices, timeChoices, typedSpan} from '../../logic/compose.ts';
import type {Mark} from '../../logic/compose.ts';
import {markInside, retyped, titleRun} from '../../logic/plain.ts';
import type {Span} from '../../logic/plain.ts';
import {LINE_FIELDS, dropPhrases} from '../../logic/linePhrase.ts';
import type {LineField} from '../../logic/linePhrase.ts';
import {conflictLine, minutesFrom, overlapsWith, timelineLabels, timelineWindow} from '../../logic/conflict.ts';
import {isEmpty, sameDescription} from '../../logic/description.ts';
import {endDatePicked, endOf, endTimePicked, inputTime, lastDayPicked, readInputTime} from '../../logic/nativeWhen.ts';
import {anchorOf, changesOf, createInput, DEFAULT_LENGTH, DEFAULT_START, draftPreview, emptyDraft, fromChange, fromIcs, fromItem, fromProposal, readLine, remindersOf, retype, retypeEdit, withDefaults} from '../../logic/editorDraft.ts';
import type {Draft, Manual} from '../../logic/editorDraft.ts';
import {addDays, clockTime, instantAt} from '../../logic/format.ts';
import {calendarMoveChoices, DEFAULT_SCOPE, scopeChoices} from '../../logic/scope.ts';
import {lineOffsets, rowReminders, taskTimeMinutes} from '../../logic/reminders.ts';
import {placeChoices, projectChoice, projectMenu, rankMatches} from '../../logic/search.ts';
import type {PlaceChoice} from '../../logic/search.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {PlaceList} from '../../ui/PlaceList.tsx';
import {useMirror} from '../../ui/useMirror.ts';
import {Segmented} from '../../ui/Segmented.tsx';
import {placeMenu, useMenuRef, useOutsideClick} from '../../ui/popover.ts';
import {colourVar, useAccounts} from '../accounts.ts';
import {LineReference} from './LineReference.tsx';
import {CalendarName, DateField, NativeField, ProjectField, stepCursor, TimeField} from './Pickers.tsx';
import {DescriptionField} from './DescriptionField.tsx';
import {RemindersRow} from './Reminders.tsx';
import {ScopePrompt} from './ScopePrompt.tsx';
import {BottomSheet, SheetChoice} from '../phone/BottomSheet.tsx';
import {Sheet} from '../phone/Sheet.tsx';
import {uuid} from '../uuid.ts';
import './editor.css';

/** What the editor opens on: New C or D on a day, Edit (E) on an item, or an email's proposal. */
export interface EditorOpen {
  kind: ItemKind;
  date: string;
  item?: ItemOut;
  message?: number | null;
  // News's Upcoming keynote, its Add to calendar.
  upcoming?: number | null;
  // Drafts the page kept when the user left Calendar with this editor started, to carry on from.
  kept?: KeptDrafts;
  // A range dragged on the week view: its times (null for all day) and days.
  slot?: Slot;
  // A one-event .ics file, as a filled-in draft that Create imports with its iCalUID.
  ics?: IcsEventOut;
  // Alfred's change to `item`: the draft opens with it applied.
  change?: ProposalChangeOut;
  // Alfred's proposal opened on the phone: called once its Create or Save goes through.
  onActed?: () => void;
}

/** Where a new event was put on the week view: its time when the line names none. */
export interface Slot {
  start: number | null;
  end: number | null;
  days: number;
}

/** An editor's drafts as they stand, for the page to keep when it's left and bring back. */
export interface KeptDrafts {
  drafts: Draft[];
  active: number;
  kind: ItemKind;
}

/** The button that opens each of the editor's menus, by its label. */
const MENU_OPENERS = {calendar: 'Calendar', repeat: 'Repeat', reminder: 'Add reminder', labels: 'Add label', more: 'More'} as const;

// The "from the email" fields (editorDraft.ts), a type beside the Marked component below.
type Marked = import('../../logic/editorDraft.ts').Marked;

/** Tab alone, which picks a suggestion as Enter does. */
const accepts = (event: ReactKeyboardEvent) => event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;

// ---------- The marked line ----------

const markClass: Record<Mark['kind'], string> = {when: 'tok-d', place: 'tok-p', calendar: 'tok-c', project: 'tok-j', reminder: 'tok-r'};

/**
 * The line's text with its marks: a #calendar in its calendar's colour, a #project in its project's
 * (`ink2` while it names no project yet, or a new one). The mark still being typed, its menu
 * open, is `live`, only a dashed underline. The one just picked lands, its tint brightening once.
 */
function Marked({text, marks, calendarColour, projectColour, live = null, landed = null, over = null}: {
  text: string;
  marks: Mark[];
  calendarColour?: Colour | null;
  projectColour?: string | null;
  // Where the live mark and the one just picked start.
  live?: number | null;
  landed?: number | null;
  // Where the mark under the pointer starts, which a click makes title words.
  over?: number | null;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start > at) parts.push(text.slice(at, mark.start));
    const colour = mark.kind === 'calendar' ? colourVar(calendarColour ?? undefined) : mark.kind === 'project' && projectColour ? projectColour : null;
    const state = `${mark.start === live ? ' live' : mark.start === landed ? ' landed' : ''}${mark.start === over ? ' over' : ''}`;
    parts.push(<span key={mark.start} data-start={mark.start} className={`${markClass[mark.kind]}${state}`} style={colour ? {'--c': colour} as CSSProperties : undefined}>{text.slice(mark.start, mark.end)}</span>);
    at = mark.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Whether a field just changed as a side effect, for its 600 ms flash:
 * `value` changed while `cause`, the field's own input, didn't (the address has none: a pick fills it).
 */
function useFlash(value: string, cause: string): boolean {
  const [last, setLast] = useState({value, cause, at: 0});
  if (last.value !== value || last.cause !== cause) setLast({value, cause, at: last.cause === cause && last.value !== value ? last.at + 1 : last.at});
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!last.at) return;
    const timer = window.setTimeout(() => setShown(last.at), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [last.at]);
  return last.at > shown;
}

const FLASH_MS = 600;

// ---------- The editor ----------

interface EditorProps {
  open: EditorOpen;
  calendars: CalendarOut[] | undefined;
  today: string;
  timeZone: string;
  // The items on a day, for the conflict preview.
  dayItems: (date: string) => ItemOut[];
  handed: boolean;
  // The drafts as the grid shows them, and the active one's day (the selected day while it's open).
  onPreview: (previews: ItemOut[], day: string | null) => void;
  onCreate: (inputs: ItemCreateInput[]) => void;
  onSave: (item: ItemOut, changes: ItemChanges, scope: RecurringScope) => void;
  onDelete: (item: ItemOut) => void;
  onClose: () => void;
  // Esc inside the editor: the page closes what's on top (the editor before a floating detail beside it), else the editor.
  onEscape?: () => void;
  // Whether the draft holds anything (choice 14: E or New doesn't replace it then).
  onDirty?: (dirty: boolean) => void;
  // The drafts as they stand, after every change, for the page to keep if it's left.
  onKeep?: (kept: KeptDrafts) => void;
  // A day clicked on the grid for the active new draft. On the week view's hours, its time too.
  place?: {day: string; at?: number};
  // The editor as an email's proposal card.
  card?: EditorCard;
  // The editor in the phone's full-screen sheet (phone/EditorSheet.tsx): its title, Cancel and
  // Save or Create in the sheet's top bar, in place of the head's title and close and the footer.
  sheet?: boolean;
}

/**
 * The editor as an email's proposal card (board 08), in the reader or an
 * answer: the card's head, the conflict line in the date row in place of the timeline, no batch
 * drafts, and Create waiting in the card until the provider confirms.
 */
export interface EditorCard {
  proposal: ProposalOut;
  pending: boolean;
  failed: string | null;
  // One in an answer doesn't take focus as it opens.
  quiet: boolean;
  // The card's form, which the host folds away as it closes (app/fold.ts).
  form: RefObject<HTMLFormElement | null>;
  // The reader's prefill on its way: the fields wait locked under skeletons, and a new `proposal`
  // fills them. Then, if it didn't come, why, in red in the head.
  filling?: boolean;
  missed?: {line: string; tip: string | null} | null;
}

export function Editor({open, calendars, today, timeZone, dayItems, handed, onPreview, onCreate, onSave, onDelete, onClose, onEscape, onDirty, onKeep, place, card, sheet = false}: EditorProps) {
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: projects} = useResource<TodoistProjectOut[]>(open.kind === 'task' ? TODOIST_PROJECTS_PATH : null);
  // Where a task with no project goes, as the server picks it: Settings' default project, else Todoist's Inbox.
  const defaultProject = projects?.find(one => one.name === settings?.todoist.default_project)?.name ?? projects?.find(one => one.inbox)?.name ?? null;
  const {data: todoistLabels} = useResource<TodoistLabelOut[]>(open.kind === 'task' ? TODOIST_LABELS_PATH : null);
  // The Google calendars an event can go in: not one the user can only read.
  const google = useMemo(() => (calendars ?? []).filter(calendar => calendar.provider === 'google' && calendar.writable), [calendars]);
  const projectNames = useMemo(() => (projects ?? []).map(project => project.name), [projects]);
  const todoist = (calendars ?? []).find(calendar => calendar.provider === 'todoist')?.id ?? null;
  const fallbackCalendar = google.find(calendar => calendar.visible)?.id ?? google[0]?.id ?? null;
  const eventDefault = settings?.reminders.event_minutes_before ?? null;
  // Time to Leave's chip says how it leaves, or that Settings has it off.
  const leaveTitle = settings && !settings.time_to_leave.enabled ? 'Time to Leave is off in Settings › Calendar'
    : `Leave by live routes from Home, with a ${settings?.time_to_leave.buffer_minutes ?? 5} min buffer`;
  const defaultReminders = useMemo(() => (open.kind === 'event' && eventDefault !== null ? [eventDefault] : []), [open.kind, eventDefault]);
  // What a dated task without a time counts its reminders from.
  const taskTime = taskTimeMinutes(settings?.reminders.task_time ?? null);
  const editing = open.item ?? null;
  // An event moves only between the calendars of its own Google account (Google's events.move).
  const accountOf = editing ? (calendars ?? []).find(one => one.id === editing.calendar_id)?.account_id : undefined;
  const calendarChoices = useMemo(() => (editing ? google.filter(one => one.account_id === accountOf) : google), [editing, google, accountOf]);
  const {list: accounts} = useAccounts();
  // A name the menu lists twice carries its account.
  const calendarName = (one: CalendarOut) => <CalendarName label={calendarLabel(one, calendarChoices, accounts)} />;

  const [original] = useState(() => (editing ? fromItem(editing, timeZone) : null));
  const [drafts, setDrafts] = useState<Draft[]>(() => open.kept?.drafts ?? [open.change ? fromChange(open.change, timeZone) : original ? {...original} : open.ics ? fromIcs(open.ics, timeZone)
    : card ? fromProposal(emptyDraft(open.kind, open.date), {proposal: card.proposal, reminders: null, newProject: false}, timeZone) : emptyDraft(open.kind, open.date, open.slot ?? null)]);
  const [active, setActive] = useState(open.kept?.active ?? drafts[0]!.id);
  const [kind, setKind] = useState<ItemKind>(open.kept?.kind ?? open.kind);
  useEffect(() => onKeep?.({drafts, active, kind}), [drafts, active, kind, onKeep]);
  const [asking, setAsking] = useState(false);
  // The phone sheet's Cancel on a draft with changes, asking whether to discard them.
  const [discarding, setDiscarding] = useState(false);
  const [scope, setScope] = useState<RecurringScope>(open.change?.scope ?? DEFAULT_SCOPE);
  const [menu, setMenu] = useState<'calendar' | 'repeat' | 'reminder' | 'labels' | 'more' | null>(null);
  const menuRef = useMenuRef(menu, () => setMenu(null));
  // Google's suggestions for the place typed, for the query they answer.
  const [found, setFound] = useState<{query: string; list: PlaceSuggestionOut[]} | null>(null);
  // The Place field was focused, so it offers the saved places. And the place menu's cursor, or
  // whether Esc or a click outside closed it, for the list it was on.
  const [placeAsked, setPlaceAsked] = useState(false);
  const [placeCursor, setPlaceCursor] = useState<{key: string; cur: number; closed: boolean} | null>(null);
  // The line's #project menu: its cursor, and whether Esc closed it, for the project typed.
  const [lineMenu, setLineMenu] = useState<{query: string; cur: number; closed: boolean} | null>(null);
  const [sessionToken, setSessionToken] = useState(() => uuid());
  const line = useRef<HTMLInputElement>(null);
  const lineMarks = useRef<HTMLSpanElement>(null);
  const ownForm = useRef<HTMLFormElement>(null);
  const form = card?.form ?? ownForm;
  const filled = useMemo(() => drafts.map(one => withDefaults(one, fallbackCalendar, defaultReminders, taskTime, timeZone)), [drafts, fallbackCalendar, defaultReminders, taskTime, timeZone]);
  const draft = filled.find(one => one.id === active) ?? filled[0]!;
  // The draft as typed and picked, its reminders not yet filled in.
  const raw = drafts.find(one => one.id === draft.id)!;

  // From an email (/calendar/new?message=): the email's proposal fills the first draft. From News's
  // Upcoming: the keynote's proposal, its name, day and time and the calendar an email's would
  // take. The news gave its fields, but "from the email" would be wrong of a keynote and DESIGN draws
  // no mark of the news's own, so they come with none, as if typed.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    // A kept draft already holds what the email gave, and what the user changed since.
    if ((!open.message && !open.upcoming) || open.kept || card) return;
    let live = true;
    const proposed: Promise<ProposalOut> = open.upcoming
      ? newsProposal(open.upcoming).then(({kind, item, conflict, source}) => ({kind, message_id: 0, item, from_email: [], conflict, source}))
      : proposalFrom(open.message!, open.kind);
    void proposed.then(proposal => {
      if (!live) return;
      setDrafts(list => list.map((one, index) => (index ? one : fromProposal(one, {proposal, reminders: null, newProject: false}, timeZone))));
      // The Description field holds its own text once mounted, so it starts again with the From: line.
      setSeeded(true);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [open.message, open.upcoming, open.kind, open.kept, timeZone, card]);

  // The card's prefill landed: its proposal fills the draft. The fields were locked until now, so
  // nothing typed is lost. What it replaces fades in (`arrived`).
  const cardProposal = card?.proposal;
  const [shownProposal, setShownProposal] = useState(cardProposal);
  const [arrived, setArrived] = useState(false);
  if (cardProposal && cardProposal !== shownProposal) {
    setShownProposal(cardProposal);
    setDrafts(list => list.map((one, index) => (index ? one : fromProposal(one, {proposal: cardProposal, reminders: null, newProject: false}, timeZone))));
  }
  const filling = card?.filling ?? false;
  const [wasFilling, setWasFilling] = useState(filling);
  if (wasFilling !== filling) {
    setWasFilling(filling);
    if (!filling) setArrived(true);
  }

  // The grid shows new drafts as ghosts, and the active one's day as selected.
  useEffect(() => {
    if (editing) {
      onPreview([], null);
      return;
    }
    onPreview(filled.map(one => draftPreview(one, timeZone, todoist, defaultProject)).filter((one): one is ItemOut => one !== null), draft.date);
  }, [filled, draft.date, editing, timeZone, todoist, defaultProject, onPreview]);
  useEffect(() => () => onPreview([], null), [onPreview]);

  // Home and the other saved places: a place that names one takes its address, as if picked.
  const saved = useMemo(() => allSavedPlaces(settings?.calendar.home ?? null, settings?.places.saved ?? []), [settings]);
  // An edited event's own place, unchanged, stays as it is, though it reads like a saved place's name.
  const savedMatch = draft.kind === 'event' && draft.address === null && draft.place.trim() !== (original?.place ?? '') ? savedPlaceFor(draft.place, saved) : null;
  // Places for the place as it's typed (in the line or the field), until one is picked or it names a
  // saved place. A link has none. The place a proposal came with isn't searched until it's changed.
  const placeQuery = draft.kind === 'event' && draft.address === null && !savedMatch && !PLACE_URL.test(draft.place.trim()) && draft.place.trim() !== draft.base.place.trim() ? draft.place.trim() : '';
  useEffect(() => {
    if (placeQuery.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      void placeSuggestions(placeQuery, sessionToken).then(list => {
        if (live) setFound({query: placeQuery, list});
      }).catch(() => live && setFound(null));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [placeQuery, sessionToken]);

  // An edited item's line names only the calendars it can move to.
  const parsed = useMemo(() => readLine(raw, raw.text, today, calendarChoices, projectNames, original, taskTime, saved),
    [raw, today, calendarChoices, projectNames, original, taskTime, saved]);
  // A #project (a task) or #calendar (an event) typed in the line shows its field's menu until
  // one is picked, the line has none, or Esc.
  const hashMark = parsed.marks.find(mark => draft.text[mark.start] === '#');
  // On an edited item, a lone "#" or "@" is one only where the edit typed it.
  const typed = original ? typedSpan(original.title, draft.text) : null;
  const bare = (trigger: '#' | '@') => {
    const found = bareToken(draft.text, trigger);
    return found && (!typed || (found.start >= typed.start && found.start < typed.end)) ? found : null;
  };
  // A lone "#" ending the line opens the whole menu before anything is typed.
  const bareHash = hashMark ? null : bare('#');
  const lineMark: Mark | undefined = hashMark ?? (bareHash ? {start: bareHash.start, end: draft.text.length, kind: draft.kind === 'task' ? 'project' : 'calendar'} : undefined);
  const lineQuery = !lineMark ? null
    : draft.kind === 'task' ? (draft.pickedProject === null ? (hashMark ? parsed.project : '') : null)
      : draft.pickedCalendar === null ? draft.text.slice(lineMark.start + 1, lineMark.end).replace(/\s*,$/, '') : null;
  // Editing a task offers only Todoist's projects.
  const projectLine = draft.kind === 'task' && lineQuery !== null ? projectMenu(lineQuery, projects ?? [], draft.newProject || !!editing) : [];
  // Both menus put the names starting with what's typed first, as the line reads them.
  const calendarLine = draft.kind === 'event' && lineQuery !== null ? rankMatches(lineQuery, calendarChoices, one => one.name) : [];
  const lineCount = projectLine.length + calendarLine.length;
  const lineCur = Math.min(lineMenu?.query === lineQuery ? lineMenu.cur : 0, lineCount - 1);
  const lineOpen = lineCount > 0 && !(lineMenu?.query === lineQuery && lineMenu.closed);
  // The place's one menu. Before Places can search (two letters), the saved places: under a lone
  // "@" (or "@" and a letter) ending the line, or once the Place field is focused with less than
  // that in it; none saved, none shown. From two letters, the saved ones that match, then Places'.
  // It stays until a pick, Esc, Tab, or a click or tap outside it, not on blur (a click elsewhere in
  // the editor would land on a moved target).
  const atToken = draft.kind === 'event' && !parsed.marks.some(mark => mark.kind === 'place') ? bare('@') : null;
  const shortQuery = atToken ? atToken.query : placeAsked && draft.kind === 'event' && draft.address === null && !savedMatch && draft.place.trim().length < 2 ? draft.place.trim() : null;
  const placeList = draft.kind === 'event' ? placeChoices(shortQuery, placeQuery, saved, found) : null;
  const placeCur = placeList ? Math.max(0, Math.min(placeCursor?.key === placeList.key ? placeCursor.cur : 0, placeList.list.length - 1)) : 0;
  const placeMenuShown = placeList && placeList.list.length > 0 && !(placeCursor?.key === placeList.key && placeCursor.closed) ? {...placeList, cur: placeCur} : null;
  const closePlaceMenu = () => placeMenuShown && setPlaceCursor({key: placeMenuShown.key, cur: placeMenuShown.cur, closed: true});
  const placeMenuBox = useRef<HTMLDivElement>(null);
  useOutsideClick(placeMenuBox, !!placeMenuShown, () => setPlaceCursor(now => (placeMenuShown ? {key: placeMenuShown.key, cur: now?.cur ?? 0, closed: true} : now)));
  // An unknown project not picked as new isn't sent: Create waits, and the line under Project says why.
  const projectChosen = draft.kind === 'task' && projects && draft.project !== original?.project ? projectChoice(draft.project ?? '', projects, draft.newProject) : null;
  // The line's #project in its project's colour, as the Project field's dot.
  const projectTodoist = draft.kind === 'task' && !draft.newProject && draft.project ? projects?.find(one => one.name.toLowerCase() === draft.project!.toLowerCase())?.colour : null;
  useMirror(line, lineMarks, draft.text);
  const projectProblem = projectChosen && 'problem' in projectChosen ? projectChosen.problem : null;

  useEffect(() => {
    // While the prefill comes, the card holds focus, for Esc.
    if (!editing && !card?.quiet) (filling ? form.current : line.current)?.focus();
  }, [editing, active, card?.quiet, filling, form]);
  // E on an item focuses its line with its title words selected, so typing renames it rather than
  // reaching the calendar's keys, and the phrases typed stay. The phone's Edit leaves the keyboard
  // down: the user came as often for a time as for the title.
  const opening = useRef(titleRun(draft.text, parsed.marks));
  useEffect(() => {
    if (!editing || card?.quiet || sheet) return;
    line.current?.focus();
    line.current?.setSelectionRange(opening.current.start, opening.current.end);
  }, [editing, card?.quiet, sheet]);

  // A pick removes the menu item that had focus: focus goes back to the field that opened the menu
  // (or the editor itself), so ⌘Enter and Esc keep working.
  const lastMenu = useRef(menu);
  useEffect(() => {
    const closed = lastMenu.current;
    lastMenu.current = menu;
    const host = form.current;
    if (!closed || menu || !host || host.contains(document.activeElement)) return;
    (host.querySelector<HTMLElement>(`[aria-label="${MENU_OPENERS[closed]}"]`) ?? host).focus();
  }, [menu, form]);

  // Where the line's caret goes once a pick or a row's change has rewritten it.
  const caret = useRef<number | null>(null);
  useEffect(() => {
    if (caret.current === null) return;
    line.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [draft.text]);
  const change = (next: Partial<Draft>, manual: Manual[] = []) => {
    // A field changed by hand loses its "from the email" mark.
    const edited: Marked[] = [];
    if (next.title !== undefined) edited.push('title');
    // The day and times share one row and one mark: a change to either takes it.
    if (next.date !== undefined || next.start !== undefined || next.end !== undefined) edited.push('date', 'time');
    if (next.place !== undefined) edited.push('place');
    if (next.description !== undefined) edited.push('description');
    if (next.reminders !== undefined || next.leaveReminder !== undefined || next.lineReminders !== undefined) edited.push('reminders');
    if (next.calendarId !== undefined) edited.push('calendar');
    if (next.colour !== undefined) edited.push('colour');
    if (next.recurrence !== undefined || next.repeat !== undefined) edited.push('repeat');
    // A row's change deletes its field's phrase from the line. The other fields that phrase set
    // ("fri 7-9pm" with a day picked) keep their values, as if set in their rows too.
    const fields = manual.filter((field): field is LineField => (LINE_FIELDS as readonly string[]).includes(field));
    const read = (text: string) => readLine({...raw, plain: retyped(raw.plain, raw.text, text)}, text, today, calendarChoices, projectNames, original, taskTime, saved);
    const typing = document.activeElement === line.current ? line.current?.selectionStart ?? null : null;
    const dropped = fields.length ? dropPhrases(raw.text, read, fields, typing) : null;
    const cut = dropped && dropped.text !== raw.text ? dropped : null;
    if (cut && cut.caret !== null) caret.current = cut.caret;
    const unpicked: Partial<Draft> = {...(fields.includes('place') ? {picked: null} : {}), ...(fields.includes('calendar') ? {pickedCalendar: null} : {})};
    setDrafts(list => list.map(one => {
      if (one.id !== draft.id) return one;
      const set = {...one, ...next, manual: [...new Set([...one.manual, ...manual, ...(cut?.held ?? [])])], fromEmail: one.fromEmail.filter(field => !edited.includes(field)), fromAlfred: one.fromAlfred.filter(field => !edited.includes(field))};
      if (!cut || one.text !== raw.text) return set;
      return reread({...set, ...unpicked, text: cut.text, plain: retyped(one.plain, one.text, cut.text)}, cut.text);
    }));
  };
  // Alfred marks what he changed or set with his glyph, as the email marks what it gave.
  const alfredLabel = open.change ? 'Alfred\'s change' : 'From Alfred';
  const mark = (...fields: Marked[]) => {
    const alfred = fields.some(field => draft.fromAlfred.includes(field));
    if (!alfred && !fields.some(field => draft.fromEmail.includes(field))) return null;
    const label = alfred ? alfredLabel : 'From the email';
    return <span className="srcm" role="img" aria-label={label} data-tip={label}><Icon name={alfred ? 'auto_awesome' : 'mail'} size={14} /></span>;
  };
  // The email's title is the line's, so its mark sits at the line's trailing edge.
  const titleMark = mark('title');
  // An edited item's Title is its line, and so is a new item's: its title words
  // changed lose the email's mark.
  const reread = (one: Draft, text: string) => {
    const next = original ? retypeEdit(one, text, original, today, calendarChoices, projectNames, taskTime, saved) : retype(one, text, today, google, projectNames, taskTime, saved);
    // What the line changed loses the email's mark, as a field changed by hand does.
    const edited: Marked[] = [];
    if (next.title !== one.title) edited.push('title');
    if (next.date !== one.date || next.undated !== one.undated || next.start !== one.start || next.end !== one.end) edited.push('date', 'time');
    if (next.place !== one.place) edited.push('place');
    if (next.calendarId !== one.calendarId) edited.push('calendar');
    if (next.recurrence !== one.recurrence || next.repeat !== one.repeat) edited.push('repeat');
    return edited.length ? {...next, fromEmail: next.fromEmail.filter(field => !edited.includes(field)), fromAlfred: next.fromAlfred.filter(field => !edited.includes(field))} : next;
  };
  // Each draft's phrases made words since it was last typed into, as its line and words were before
  // each. ⌘Z in the line takes them back, newest first, and then it's the line's own undo again.
  const madePlain = useRef(new Map<number, {text: string; plain: Span[]}[]>());
  const typeLine = (text: string) => {
    madePlain.current.delete(draft.id);
    setDrafts(list => list.map(one => (one.id === draft.id ? reread(one, text) : one)));
  };
  // A lit phrase clicked, or ⌥⌫ with the caret inside it, is title words again, and what it set goes.
  const makePlain = (mark: Mark) => {
    madePlain.current.set(draft.id, [...madePlain.current.get(draft.id) ?? [], {text: draft.text, plain: draft.plain}]);
    setDrafts(list => list.map(one => (one.id === draft.id ? reread({...one, plain: [...one.plain, {start: mark.start, end: mark.end}]}, one.text) : one)));
  };
  /** The last phrase made words taken back, if the line is still as it was then, or false if none. */
  const unmakePlain = () => {
    const steps = madePlain.current.get(draft.id) ?? [];
    const last = steps.at(-1);
    if (!last || last.text !== draft.text) {
      madePlain.current.delete(draft.id);
      return false;
    }
    madePlain.current.set(draft.id, steps.slice(0, -1));
    setDrafts(list => list.map(one => (one.id === draft.id ? reread({...one, plain: last.plain}, one.text) : one)));
    return true;
  };
  // The marks are drawn behind the line's input, so the pointer finds one by where its letters are.
  const markAt = (x: number, y: number): Mark | null => {
    for (const shown of lineMarks.current?.querySelectorAll<HTMLElement>('[data-start]') ?? []) {
      if (![...shown.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) continue;
      return parsed.marks.find(one => one.start === Number(shown.dataset.start)) ?? null;
    }
    return null;
  };
  const [over, setOver] = useState<number | null>(null);
  // Whether the line had focus as the pointer went down: the click that focuses it only focuses it.
  const focusedAtPress = useRef(false);
  const [lineFocused, setLineFocused] = useState(false);
  const overMark = lineFocused && parsed.marks.some(one => one.start === over) ? over : null;
  // The mark just picked, brightening once as it lands.
  const [landed, setLanded] = useState<{start: number; seq: number} | null>(null);
  useEffect(() => {
    if (!landed) return;
    const timer = window.setTimeout(() => setLanded(current => (current === landed ? null : current)), motion.slow);
    return () => window.clearTimeout(timer);
  }, [landed]);
  /** A pick for the line's "@place" or "#name" (its mark): the line reads the name in full, then a space. */
  const completeLine = (mark: Mark, name: string, picked: Partial<Draft>) => {
    const next = completeToken(draft.text, mark.start, mark.end, name);
    caret.current = next.caret;
    setLanded({start: mark.start, seq: (landed?.seq ?? 0) + 1});
    setDrafts(list => list.map(one => (one.id === draft.id ? reread({...one, ...picked}, next.text) : one)));
  };
  const pickLine = (index: number) => {
    if (draft.kind === 'task') {
      const {name, isNew} = projectLine[index]!;
      completeLine(lineMark!, name, {project: name, newProject: isNew, pickedProject: name});
    } else {
      const {id, name} = calendarLine[index]!;
      completeLine(lineMark!, name, {calendarId: id, pickedCalendar: name});
    }
  };
  const pick = (place: PlaceChoice) => {
    const placeMark = parsed.marks.find(mark => mark.kind === 'place') ?? (atToken ? {start: atToken.start, end: draft.text.length, kind: 'place' as const} : undefined);
    setPlaceAsked(false);
    setPlaceCursor(null);
    // A saved place is its name, and takes its address as one typed does (only the address goes on the event).
    if (place.saved) {
      if (placeMark) completeLine(placeMark, place.name, {place: place.name, address: null, picked: place.name});
      else change({place: place.name, address: null, picked: null});
      return;
    }
    const chosen = {place: place.name, address: place.address || ''};
    if (placeMark) completeLine(placeMark, place.name, {...chosen, picked: place.name});
    else change({...chosen, picked: null});
    // Place Details for the pick ends Google's session (so the next place typed starts a new one),
    // and has the address in full where the suggestion's didn't.
    const id = draft.id;
    setSessionToken(uuid());
    void findPlace(place.place_id, sessionToken).then(details => {
      if (!details.address) return;
      setDrafts(list => list.map(one => (one.id === id && one.place === chosen.place && one.address === chosen.address ? {...one, address: details.address} : one)));
    }).catch(() => {});
  };

  const switchKind = (next: ItemKind) => {
    if (next === kind || editing) return;
    setKind(next);
    setDrafts(list => list.map(one => retype({...emptyDraft(next, one.day), id: one.id, plain: one.plain}, one.text, today, google, projectNames, taskTime, saved)));
  };

  const addAnother = () => {
    const fresh = emptyDraft(kind, draft.date);
    setDrafts(list => [...list, fresh]);
    setActive(fresh.id);
  };
  // A folded draft of the batch goes with its ×.
  const removeDraft = (id: number) => setDrafts(list => list.filter(one => one.id !== id));

  // A grid day clicked moves the active new draft there, unless its line names a day or Date was set
  // by hand.
  const [placed, setPlaced] = useState(place);
  if (place !== placed) {
    setPlaced(place);
    const named = draft.manual.includes('date') || parsed.date !== null;
    // On the week view's hours it takes the time clicked too, keeping its length, unless the line names a time or Time was set by hand.
    const timed = place?.at !== undefined && draft.kind === 'event' && draft.start !== null && draft.end !== null && !draft.manual.includes('time') && parsed.start === null;
    if (place && !editing) {
      setDrafts(list => list.map(one => {
        if (one.id !== draft.id) return one;
        const moved = {...one, day: place.day, date: named ? one.date : place.day};
        if (!timed || one.start === null || one.end === null) return moved;
        const slot = {start: place.at!, end: place.at! + (one.end - one.start), days: 1};
        return {...moved, slot, start: slot.start, end: slot.end};
      }));
    }
  }

  const dirty = editing && original ? Object.keys(changesOf(draft, original, timeZone, saved)).length > 0 : draftStarted(drafts) || drafts.some(one => !isEmpty(one.description));
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const inputs = filled.map(one => {
    const input = createInput({...one, reminders: remindersOf(drafts.find(own => own.id === one.id)!, taskTime, timeZone)}, timeZone, todoist, saved);
    if (input?.kind !== 'task') return input;
    // A task's project by Todoist's own name, made only when New project was picked.
    const chosen = projectChoice(one.project ?? '', projects ?? [], one.newProject);
    return 'problem' in chosen ? null : {...input, ...chosen};
  });
  const ready = inputs.filter((input): input is ItemCreateInput => input !== null);
  // The card's Create stays pressable and says what it waits for: a day typed and Create
  // pressed without leaving the field still makes it.
  const [cardProblem, setCardProblem] = useState<string | null>(null);
  const submit = () => {
    if (card && !editing) {
      if (card.pending || card.filling) return;
      const problem = draft.kind === 'event' && draft.undated ? 'Pick a day first' : projectProblem ?? (draft.title.trim() ? null : 'Give it a title first');
      setCardProblem(problem);
      if (!problem && ready.length === 1) onCreate(ready);
      return;
    }
    if (editing && original) {
      if (projectProblem || card?.pending) return;
      const changes = changesOf(draft, original, timeZone, saved);
      if (!Object.keys(changes).length) return onClose();
      if (editing.kind === 'event' && editing.recurring && !asking) {
        // Alfred's change keeps the scope he picked.
        setScope(open.change && choices.some(choice => choice.scope === open.change!.scope) ? open.change.scope : choices[0]!.scope);
        setAsking(true);
        return;
      }
      onSave(editing, changes, asking ? scope : 'this');
      return;
    }
    if (ready.length && ready.length === drafts.length) onCreate(ready);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Backspace' && event.altKey && !event.metaKey && !event.ctrlKey && event.target === line.current && line.current.selectionStart === line.current.selectionEnd) {
      // ⌥⌫ inside a lit phrase makes it words. At its edge it deletes a word, as ever.
      const inside = markInside(parsed.marks, line.current.selectionStart ?? 0);
      if (inside) {
        event.preventDefault();
        makePlain(inside);
      }
    } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && event.target === line.current) {
      if (unmakePlain()) event.preventDefault();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (menu) setMenu(null);
      else if (placeMenuShown) closePlaceMenu();
      else if (lineOpen) setLineMenu({query: lineQuery!, cur: lineCur, closed: true});
      else (onEscape ?? onClose)();
    } else if (placeMenuShown && atToken === null && shortQuery === '' && accepts(event)) {
      // Tab through an empty Place field goes on without picking a place it was never asked for.
      setPlaceAsked(false);
    } else if (placeMenuShown && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setPlaceCursor({key: placeMenuShown.key, cur: stepCursor(event.key, placeMenuShown.cur, placeMenuShown.list.length)!, closed: false});
    } else if (placeMenuShown && (event.key === 'Enter' || accepts(event))) {
      // Tab picks as Enter does. From the Place field it goes on to the next field.
      if (event.key === 'Enter' || event.target === line.current) event.preventDefault();
      pick(placeMenuShown.list[placeMenuShown.cur]!);
    } else if (lineOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setLineMenu({query: lineQuery!, cur: stepCursor(event.key, lineCur, lineCount)!, closed: false});
    } else if (lineOpen && ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || accepts(event))) {
      event.preventDefault();
      pickLine(lineCur);
    }
  };

  const calendar = (calendars ?? []).find(one => one.id === draft.calendarId);
  // An event's last day: its date for a one-day event and every task.
  const lastDay = kind === 'event' ? addDays(draft.date, extraDays(draft.start, draft.end, draft.days)) : draft.date;
  // Each row whose value the line gave takes its mark's colour on its glyph. Set by hand, it's `ink3`
  // again.
  const fromLine = (kind: Mark['kind'], ...fields: Manual[]) => parsed.marks.some(one => one.kind === kind) && !fields.some(field => draft.manual.includes(field));
  const echo = {
    when: fromLine('when', 'date', 'time') ? 'from-when' : undefined,
    place: fromLine('place', 'place') ? 'from-place' : undefined,
    calendar: fromLine('calendar', 'calendar') ? 'from-cal' : undefined,
    project: fromLine('project', 'project') ? 'from-proj' : undefined,
    reminder: fromLine('reminder', 'reminders') ? 'from-remind' : undefined,
  };
  const liveMark = placeMenuShown && shortQuery === null ? parsed.marks.find(one => one.kind === 'place')?.start ?? null : lineOpen ? lineMark?.start ?? null : null;
  // A field changed by another's change flashes: the Date when the End runs into the next day, the address a picked place fills in.
  const flashDate = useFlash(lastDay, draft.date);
  // A saved place's address shows as a picked one's does.
  const shownAddress = draft.address ?? savedMatch?.address ?? null;
  const flashAddress = useFlash(shownAddress ?? '', '');
  const laterDays = draft.end !== null ? extraDays(draft.start, draft.end, 1) : 0;
  const unpicked = (todoistLabels ?? []).filter(label => !draft.labels.includes(label.name));
  // A recurring event moving to another calendar goes as a series (Google can't move one occurrence).
  const choices = original && draft.calendarId !== original.calendarId && calendar ? calendarMoveChoices(original.date, calendar.name) : original ? scopeChoices(original.date, draft.date) : [];
  const noun = kind === 'event' ? 'event' : 'task';
  // An .ics event the picked calendar already holds is updated there by Create.
  const updating = open.ics && draft.id === drafts[0]!.id && draft.calendarId !== null && open.ics.existing.includes(draft.calendarId)
    ? google.find(one => one.id === draft.calendarId)?.name ?? null : null;
  const changed = (field: 'date' | 'start' | 'end') => !!original && draft[field] !== original[field];
  const was = original && original.kind === 'event' && original.start !== null && (draft.date !== original.date || draft.start !== original.start || draft.end !== original.end) && editing
    ? `Was ${draft.date !== original.date ? `${dayTitle(original.date)} · ` : ''}${timeRange(editing, timeZone)}`
    : null;

  // What the reminders count from: the start or due time, an all-day event's midnight, or a
  // dated task's Settings' task time (9:00 AM at None). A task with no date has none.
  const untimedTask = kind === 'task' && !draft.undated && draft.start === null;
  const reminderFrom = anchorOf(draft, taskTime, timeZone);
  const countsFrom = untimedTask && reminderFrom !== null ? `Counts from ${clockTime(reminderFrom, timeZone)}` : null;

  // The card's conflict line (board 08), worked out again by the server's rule as the day and time
  // change. It shows the email's own until the day's items load.
  const conflictDay = card && kind === 'event' && !draft.undated ? draft.date : null;
  const {data: dayList} = useResource<ItemsOut>(conflictDay ? itemsPath(conflictDay, addDays(conflictDay, 1)) : null);
  const proposal = card?.proposal;
  const emailed = useMemo(() => (proposal ? fromProposal(emptyDraft(proposal.kind, open.date), {proposal, reminders: null, newProject: false}, timeZone) : null), [proposal, open.date, timeZone]);
  const asEmailed = !!emailed && !emailed.undated && !draft.undated && emailed.date === draft.date && emailed.start === draft.start && emailed.end === draft.end && emailed.days === draft.days;
  const conflict = !conflictDay ? null
    : dayList && dayList.from === conflictDay ? proposalConflict({
      all_day: draft.start === null,
      starts_at: draft.start === null ? null : instantAt(draft.date, draft.start, timeZone),
      ends_at: draft.start === null ? null : instantAt(draft.date, draft.end ?? draft.start + DEFAULT_LENGTH, timeZone),
      startHour: draft.start === null ? null : Math.floor(draft.start / 60),
    }, editing ? dayList.items.filter(one => one.id !== editing.id) : dayList.items)
      : asEmailed ? proposal!.conflict : null;

  // The fields the prefill fills: a skeleton while it's on its way, then what it gave.
  // The model's answer sweeps in (`sks`). Missed, the rules' values only fade in (`ska`).
  const sk = filling ? ' skf' : arrived ? (card?.missed ? ' ska' : ' sks') : '';
  const title = editing ? `Edit ${noun}` : `New ${noun}`;
  const legends = (
    <>
      {draft.fromEmail.length > 0 && <span className="legend"><Icon name="mail" size={14} /><span>From the email</span></span>}
      {draft.fromAlfred.length > 0 && <span className="legend"><Icon name="auto_awesome" size={14} /><span>{alfredLabel}</span></span>}
      {updating && <span className="legend"><Icon name="event" size={14} /><span>Already on {updating} (will update)</span></span>}
    </>
  );
  // A new task can go to Todoist with no date, its time going with it. A day picked brings one back.
  // An edited subtask's too, which stays in its task's checklist. A task's date stays on.
  const clearDate = kind === 'task' && (!editing || editing.parent_id !== null) ? () => {
    change({undated: true, start: null, ...(editing ? {reminders: [], repeat: null} : {})}, ['date', 'time']);
    form.current?.focus();
  } : undefined;
  const removeTime = () => {
    // An event keeps its days.
    change({start: null, end: null, days: extraDays(draft.start, draft.end, 1) + 1}, ['time']);
    // The fields it was beside go: the editor keeps focus, for ⌘Enter and Esc.
    form.current?.focus();
  };
  const addTime = () => change({start: DEFAULT_START, end: kind === 'event' ? (draft.days - 1) * 1440 + DEFAULT_START + DEFAULT_LENGTH : null, days: 1}, ['time']);
  const dateClass = `date${changed('date') || (!!original && draft.days !== original.days) ? ' changed' : ''}${flashDate ? ' flash' : ''}`;
  // On the phone the day and times are iOS's own pickers, in rows as its Calendar has them: an
  // event's Starts and Ends, each a day and a time (an all-day one's days alone). A task's one row,
  // its due day and time, takes no word, leaving its day room for its ×. An event the email gave no
  // day has only Starts, its "Pick a day", as the desktop has.
  const ends = draft.start !== null && draft.end !== null ? endOf(draft.date, draft.end) : null;
  const phoneWhen = (
    <div className={`ph-when ${kind}${sk}`}>
      {kind === 'event' && <span className="ph-when-label">Starts</span>}
      <NativeField type="date" className={dateClass} label={kind === 'task' ? 'Due date' : 'Date'} value={draft.undated ? '' : draft.date}
        shown={draft.undated ? '' : dayTitle(draft.date)} placeholder={kind === 'event' ? 'Pick a day' : 'No date'}
        onValue={date => change({date, undated: false}, ['date'])} onClear={clearDate} />
      {draft.undated ? null : draft.start !== null ? (
        <>
          <NativeField type="time" className={`time num${changed('start') ? ' changed' : ''}`} label={kind === 'task' ? 'Time' : 'Start'} value={inputTime(draft.start)} shown={clockLabel(draft.start)}
            onValue={value => {
              const start = readInputTime(value);
              if (start !== null) change({start, end: draft.end === null ? null : start + (draft.end - draft.start!)}, ['time']);
            }} />
          {kind === 'task' && <button type="button" className="ibtn sm" aria-label="Remove time" onClick={removeTime}><Icon name="close" size={16} /></button>}
        </>
      ) : <button type="button" className="btn quiet sm ph-add-time" onClick={addTime}>Add a time</button>}
      {kind === 'task' && mark('date', 'time')}
      {kind === 'event' && !draft.undated && (
        <>
          <span className="ph-when-label">Ends</span>
          <NativeField type="date" className={`date${changed('date') ? ' changed' : ''}`} label="End date" value={ends?.date ?? lastDay} min={draft.date}
            shown={dayTitle(ends?.date ?? lastDay)}
            onValue={to => change(draft.start === null || draft.end === null ? {days: lastDayPicked(draft.date, to)} : {end: endDatePicked(draft.date, draft.start, draft.end, to)}, ['date'])} />
          {draft.start !== null && draft.end !== null && (
            <>
              <NativeField type="time" className={`time num${changed('end') ? ' changed' : ''}`} label="End" value={inputTime(draft.end)}
                shown={draft.end === draft.start ? '' : clockLabel(draft.end)} placeholder={NO_END}
                onValue={value => {
                  const minutes = readInputTime(value);
                  if (minutes !== null) change({end: endTimePicked(draft.start!, draft.end!, minutes)}, ['time']);
                }} />
              <button type="button" className="ibtn sm" aria-label="All day" onClick={removeTime}><Icon name="close" size={16} /></button>
            </>
          )}
        </>
      )}
      {/* An event's mark sits under the clock, beside Ends, where it takes no room from the days. */}
      {kind === 'event' && mark('date', 'time')}
    </div>
  );
  // An empty new draft has nothing to conflict yet: the preview waits for a title or a time.
  const preview = !card && kind === 'event' && draft.start !== null && lastDay === draft.date && (editing || draft.text.trim() !== '' || draft.manual.includes('time')) && (
    <ConflictPreview draft={draft} items={dayItems(draft.date)} except={editing?.key ?? null} free={editing ? isFree(editing) : false} title={draft.title || draft.text} colour={calendar?.colour ?? null}
      calendarColour={id => (calendars ?? []).find(one => one.id === id)?.colour ?? null} isNew={!editing} timeZone={timeZone} />
  );
  const editor = (
    <form ref={form} tabIndex={-1} className={card ? `editor card prop${card.pending ? ' pending' : ''}${card.quiet ? ' in-answer' : ''}` : sheet ? 'editor ph-editor' : `rpane editor${handed ? ' handed' : ''}`}
      aria-label={card ? (editing ? `Proposal: change ${noun}` : kind === 'event' ? 'Proposal: add to calendar' : 'Proposal: add as task') : title} onKeyDown={onKeyDown}
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}>
      {card ? (
        <div className="card-h">
          <span style={{color: colourVar(calendar?.colour ?? undefined)}}><Icon name={kind === 'event' ? 'event' : 'task_alt'} size={16} /></span>
          <span className="card-title">Proposal</span>
          {card.proposal.from_email.length > 0 && !filling && <span className="card-sub">· from this email</span>}
          {editing && <span className="card-sub">· a change to {editing.title}</span>}
          {card.missed && <span className="card-miss" role="status" data-tip={card.missed.tip ?? undefined}><Icon name="error" size={16} />{card.missed.line}</span>}
        </div>
      ) : sheet && editing ? null : <div className="ed-head">
        {/* The phone's Edit has no head: its More held only Delete, which the detail has. */}
        {sheet ? <span className="grow" /> : <span className="grow ed-title">{title}</span>}
        {editing ? (
          <span className="menu-host">
            <button type="button" className="ibtn" aria-label="More" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}><Icon name="more_horiz" /></button>
            {menu === 'more' && (
              <div ref={menuRef} className="pop menu right" role="menu">
                <button type="button" role="menuitem" className="menu-i danger" onClick={() => onDelete(editing)}><Icon name="delete" size={16} />Delete<span className="kbd">Del</span></button>
              </div>
            )}
          </span>
        ) : (
          <Segmented role="tab" label="Item type" value={kind} onChange={switchKind}
            segments={[{value: 'event', label: 'Event'}, {value: 'task', label: 'Task'}]} />
        )}
        {!sheet && <button type="button" className="ibtn" aria-label="Close editor" data-tip="Close · Esc" onClick={onClose}><Icon name="close" /></button>}
      </div>}

      <div className="ed-scroll" inert={filling}>
        <div className="ed-line">
          {/* An edited item's Title is a line too, reading only what's typed into it. A new item's
              title is its line's title words, with no Title field under it. */}
          <label className={`field big nl${titleMark ? ' src' : ''}${overMark !== null ? ' over' : ''}${sk}`}>
            <span ref={lineMarks} className="nl-marks" aria-hidden="true">
              <span className="nl-text"><Marked text={draft.text} marks={parsed.marks} calendarColour={calendar?.colour} projectColour={projectTodoist ? TODOIST_COLOURS[projectTodoist] : null}
                live={liveMark} landed={landed?.start ?? null} over={overMark} key={landed?.seq ?? 0} /></span>
            </span>
            <input ref={line} className="nl-input" aria-label={editing ? 'Title' : `Describe the ${noun}`} value={draft.text} spellCheck={false} autoComplete="off"
              placeholder={editing ? undefined : kind === 'event' ? 'Dinner with Sam fri 7-9pm @Blue Door' : 'Pay rent fri'}
              data-tip={overMark !== null ? 'Click to keep as words' : undefined}
              onChange={event => typeLine(event.target.value)} onFocus={() => setLineFocused(true)} onBlur={() => setLineFocused(false)}
              onMouseMove={event => setOver(markAt(event.clientX, event.clientY)?.start ?? null)} onMouseLeave={() => setOver(null)}
              onMouseDown={event => {
                focusedAtPress.current = event.currentTarget === document.activeElement;
              }}
              onClick={event => {
                // A plain click in the line already focused: not the click that focuses it, a drag's
                // selection or a double-click's word.
                const input = event.currentTarget;
                if (!focusedAtPress.current || event.detail !== 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || input.selectionStart !== input.selectionEnd) return;
                const hit = markAt(event.clientX, event.clientY);
                if (!hit) return;
                makePlain(hit);
                setOver(null);
              }} />
            {titleMark}
          </label>
          <LineReference />
        </div>

        <div className="eg">
          <Icon name="schedule" size={17} className={`g-when ${echo.when ?? ''}`} />
          {sheet ? phoneWhen : <div className={`prow${lastDay !== draft.date ? ' days' : ''}${sk}`}>
            <DateField className={dateClass} label={kind === 'task' ? 'Due date' : 'Date'}
              value={draft.undated ? null : draft.date} placeholder={kind === 'event' ? 'Pick a day' : 'No date'}
              shown={draft.undated ? '' : lastDay === draft.date ? dayTitle(draft.date) : `${dayTitle(draft.date)} – ${dayTitle(lastDay)}`}
              today={today} read={text => parseDay(text, today)} onValue={date => change({date, undated: false}, ['date'])}
              range={kind === 'event' ? {to: lastDay, read: text => parseDays(text, today), onRange: (from, to) => change({...spanTo(from, to, draft.start, draft.end), undated: false}, ['date'])} : undefined}
              onClear={clearDate} />
            {draft.undated ? null : draft.start !== null ? (
              <>
                <TimeField className={`time num${changed('start') ? ' changed' : ''}`} label="Start" value={draft.start} choices={timeChoices()}
                  read={text => parseClock(text, draft.start)} onValue={start => change({start, end: draft.end === null ? null : start + (draft.end - draft.start!)}, ['time'])} />
                {draft.end !== null && (
                  <>
                    <span className="ink3">–</span>
                    <TimeField className={`time num${changed('end') ? ' changed' : ''}`} label="End" value={draft.end} blank={draft.end === draft.start ? NO_END : undefined}
                      choices={endChoices(draft.start, draft.end)}
                      read={text => readEnd(text, draft.start!, draft.end!)} onValue={end => change({end}, ['time'])} />
                    {laterDays > 0 && <span className="later num" data-tip={`Ends ${dayTitle(lastDay)}`}>+{laterDays}</span>}
                  </>
                )}
                <button type="button" className="ibtn sm" aria-label={kind === 'event' ? 'All day' : 'Remove time'} data-tip={kind === 'event' ? 'All day' : 'Remove time'}
                  onClick={removeTime}><Icon name="close" size={16} /></button>
              </>
            ) : (
              <button type="button" className="btn quiet sm" onClick={addTime}>
                {kind === 'event' ? 'All day · Add a time' : 'Add a time'}
              </button>
            )}
            {mark('date', 'time')}
          </div>}
          {was && (
            <>
              <span />
              <div className="ink3 num was">{was}</div>
            </>
          )}
          {/* The card's conflict line, under the day and times so it's never cut short. */}
          {conflict && (
            <>
              <span />
              <div className={conflict.free ? 'conflict free' : 'conflict'}>
                <Icon name={conflict.free ? 'check_circle' : 'layers'} size={16} />{conflict.label}
              </div>
            </>
          )}
          {/* On the phone the preview sits under the day and times it's about, above the keyboard
              while the line is typed. With the keyboard up it folds to its one line (editorSheet.css). */}
          {sheet && preview && (
            <>
              <span />
              {preview}
            </>
          )}

          {kind === 'event' && editing && <RepeatRow draft={draft} mark={mark('repeat')} open={menu === 'repeat'} menuRef={menuRef} onToggle={() => setMenu(menu === 'repeat' ? null : 'repeat')} onPick={recurrence => {
            change({recurrence}, ['recurrence']);
            setMenu(null);
          }} />}
          {kind === 'task' && !draft.undated && (
            <>
              <Icon name="repeat" size={17} />
              <span className="menu-host">
                <button type="button" className="field" aria-label="Repeat" aria-expanded={menu === 'repeat'} onClick={() => setMenu(menu === 'repeat' ? null : 'repeat')}>
                  <span className="grow left">{describeTaskRepeat(draft.repeat)}</span>
                  {mark('repeat')}
                  <span className="ink3"><Icon name="expand_more" size={16} /></span>
                </button>
                {menu === 'repeat' && (
                  <div ref={menuRef} className="pop menu" role="menu">
                    {taskRepeatChoices(draft.date, draft.repeat).map(choice => (
                      <button key={choice.repeat ?? 'none'} type="button" role="menuitemradio" aria-checked={choice.repeat === draft.repeat} className="menu-i" onClick={() => {
                        change({repeat: choice.repeat}, ['recurrence']);
                        setMenu(null);
                      }}>{choice.label}{choice.repeat === draft.repeat && <Icon name="check" size={16} />}</button>
                    ))}
                  </div>
                )}
              </span>
            </>
          )}

          {kind === 'event' && (
            <>
              <Icon name="location_on" size={17} className={`g-place ${echo.place ?? ''}`} />
              <label className={`field${placeMenuShown ? ' focus' : ''}${sk}`}>
                <input className="grow" aria-label="Place" placeholder="Add place" value={draft.place} onFocus={() => {
                  // A list closed under the line's "@" opens afresh here.
                  setPlaceCursor(null);
                  setPlaceAsked(true);
                }}
                  onChange={event => change({place: event.target.value, address: null, picked: null}, ['place'])} />
                {mark('place')}
                {draft.place && (
                  <button type="button" className="ibtn sm clear" aria-label="Clear place" onMouseDown={event => event.preventDefault()} onClick={() => change({place: '', address: null, picked: null}, ['place'])}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </label>
              {shownAddress && (
                <>
                  <span />
                  <span className={`ell ink3 place-address${flashAddress ? ' flash' : ''}`}>{shownAddress}</span>
                </>
              )}
              {placeMenuShown && (
                <>
                  <span />
                  <PlaceList ref={placeMenuBox} places={placeMenuShown.list} cur={placeMenuShown.cur} query={placeMenuShown.query} keyOf={place => place.place_id || `saved:${place.name}`} onPick={pick} />
                </>
              )}
            </>
          )}

          {kind === 'event' ? (
            <>
              <Icon name="calendar_today" size={17} className={`g-cal ${echo.calendar ?? ''}`} style={{'--c': colourVar(calendar?.colour ?? undefined)} as CSSProperties} />
              <span className="menu-host">
                <button type="button" className={`field${sk}`} aria-label="Calendar" aria-expanded={menu === 'calendar'}
                  onClick={() => setMenu(menu === 'calendar' ? null : 'calendar')}>
                  <span className="dot sm" style={{'--c': colourVar(calendar?.colour ?? undefined)} as CSSProperties} />
                  <span className="grow left">{calendar ? calendarName(calendar) : 'Calendar'}</span>
                  {mark('calendar')}
                  <span className="ink3"><Icon name="expand_more" size={16} /></span>
                </button>
                {lineOpen && menu !== 'calendar' && (
                  <div ref={placeMenu} className="pop menu" role="listbox" aria-label="Calendars">
                    {calendarLine.map((one, index) => (
                      <div key={one.id} role="option" aria-selected={index === lineCur} className={`menu-i${index === lineCur ? ' cur' : ''}`}
                        onMouseDown={event => event.preventDefault()} onClick={() => pickLine(index)}>
                        <span className="dot sm" style={{'--c': colourVar(one.colour ?? undefined)} as CSSProperties} />{calendarName(one)}
                        {index === lineCur && <span className="kbd">↵</span>}
                      </div>
                    ))}
                  </div>
                )}
                {menu === 'calendar' && (
                  <div ref={menuRef} className="pop menu" role="menu">
                    {calendarChoices.map(one => (
                      <button key={one.id} type="button" role="menuitemradio" aria-checked={one.id === draft.calendarId} className="menu-i" onClick={() => {
                        change({calendarId: one.id}, ['calendar']);
                        setMenu(null);
                      }}>
                        <span className="dot sm" style={{'--c': colourVar(one.colour ?? undefined)} as CSSProperties} />{calendarName(one)}
                        {one.id === draft.calendarId && <Icon name="check" size={16} />}
                      </button>
                    ))}
                  </div>
                )}
              </span>
              {/* An event's own colour, Alfred's or kept from the item: shown with its ×, picked on the floating detail. */}
              {draft.colour && (
                <>
                  <span className="g-colour"><span className="dot" style={{'--c': colourVar(draft.colour)} as CSSProperties} /></span>
                  <span className="prow" aria-label="Colour">
                    <span className="qchip">Its own colour
                      <button type="button" className="x" aria-label="Use the calendar's colour" onClick={() => change({colour: null})}><Icon name="close" size={14} /></button>
                    </span>
                    {mark('colour')}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <Icon name="work" size={17} className={`g-proj ${echo.project ?? ''}`} style={projectTodoist ? {'--c': TODOIST_COLOURS[projectTodoist]} as CSSProperties : undefined} />
              {/* A subtask is in its task's project. Moved to another, Todoist would take it out from under its task. */}
              {editing?.parent_id != null ? <span className="ink2 sub-project" data-tip="A subtask is in its task's project">{draft.project}</span> : (
              <ProjectField className={sk.trim()} value={draft.project ?? ''} isNew={draft.newProject} projects={projects ?? []} noNew={!!editing}
                placeholder={settings?.todoist.default_project ?? projects?.find(one => one.inbox)?.name ?? 'Inbox'}
                line={lineOpen ? {cur: lineCur} : null}
                onText={text => change({project: text || null, newProject: false, pickedProject: null}, ['project'])}
                onPick={(name, isNew) => (lineOpen
                  ? completeLine(lineMark!, name, {project: name, newProject: isNew, pickedProject: name})
                  : change({project: name, newProject: isNew, pickedProject: null}, ['project']))} />)}
              {projectProblem && !lineOpen && (
                <>
                  <span />
                  <span className="ink3 field-note">{projectProblem}</span>
                </>
              )}
              <Icon name="alternate_email" size={17} />
              <div className="prow" aria-label="Labels">
                {draft.labels.map(label => (
                  <span key={label} className="qchip">
                    {label}
                    <button type="button" className="x" aria-label={`Remove label ${label}`} onClick={() => change({labels: draft.labels.filter(one => one !== label)}, ['labels'])}><Icon name="close" size={14} /></button>
                  </span>
                ))}
                {!draft.labels.length && <span className="ink3 none">No labels</span>}
                {unpicked.length > 0 && <span className="menu-host">
                  <button type="button" className="ibtn sm" aria-label="Add label" aria-expanded={menu === 'labels'} onClick={() => setMenu(menu === 'labels' ? null : 'labels')}><Icon name="add" size={16} /></button>
                  {menu === 'labels' && (
                    <div ref={menuRef} className="pop menu" role="menu">
                      {unpicked.map(label => (
                        <button key={label.id} type="button" role="menuitem" className="menu-i" onClick={() => {
                          change({labels: [...draft.labels, label.name]}, ['labels']);
                          setMenu(null);
                        }}>{label.name}</button>
                      ))}
                    </div>
                  )}
                </span>}
              </div>
            </>
          )}

          <RemindersRow native={sheet} reminders={draft.reminders} anchor={reminderFrom} countsFrom={countsFrom} timeZone={timeZone} today={today} glyph={`g-remind ${echo.reminder ?? ''}`}
            menuOpen={menu === 'reminder'} menuRef={menuRef} onMenu={open => setMenu(open ? 'reminder' : null)}
            onChange={list => {
              // Ticked beside the line's they're picked. One the line set, taken out, sets them by hand.
              const {reminders, byHand} = rowReminders(list, raw.reminders, lineOffsets(raw.lineReminders, reminderFrom, timeZone));
              change(byHand ? {reminders, lineReminders: []} : {reminders}, byHand ? ['reminders'] : []);
            }}
            chips={<>
              {kind === 'event' && draft.leaveReminder && (
                <span className="qchip ttl" data-tip={leaveTitle}>
                  <Icon name="directions_car" size={14} />Time to Leave
                  <button type="button" className="x" aria-label="Remove Time to Leave" onClick={() => change({leaveReminder: false})}><Icon name="close" size={14} /></button>
                </span>
              )}
              {mark('reminders')}
            </>}
            // An event with a time and a place can have Time to Leave, with Settings' buffer, while Settings has it on.
            menuItems={kind === 'event' && !draft.leaveReminder && draft.start !== null && draft.place.trim() && settings?.time_to_leave.enabled && (
              <button type="button" role="menuitem" className="menu-i" onClick={() => {
                change({leaveReminder: true});
                setMenu(null);
              }}><Icon name="directions_car" size={16} />Time to Leave{' '}<span className="ink3 num">{settings.time_to_leave.buffer_minutes} min buffer</span></button>
            )} />

          {kind === 'event' && !editing && <RepeatRow draft={draft} mark={mark('repeat')} open={menu === 'repeat'} menuRef={menuRef} onToggle={() => setMenu(menu === 'repeat' ? null : 'repeat')} onPick={recurrence => {
            change({recurrence}, ['recurrence']);
            setMenu(null);
          }} />}

          {/* On the proposal card too, starting with the email's or story's From: line. */}
          <Icon name="notes" size={17} className="desc-glyph" />
          <DescriptionField key={`${draft.id}${seeded ? ':seeded' : ''}`} blocks={raw.description} kind={kind} mark={mark('description')} onChange={description => change({description})}
            note={editing && original && draft.descriptionLossy && !sameDescription(draft.description, original.description) ? 'Saving drops formatting Setpoint can\'t show' : null} />
        </div>

        {!sheet && preview}

        {/* Batch drafts are the desktop's: on the phone, one item at a time. */}
        {!editing && !card && !sheet && (
          <div className="batch">
            {drafts.filter(one => one.id !== draft.id).map(one => (
              <div key={one.id} className="drafted-row">
                <button type="button" className="field drafted" aria-label={`Expand draft: ${one.text}`} onClick={() => setActive(one.id)}>
                  <span className="dot sm" style={{'--c': colourVar((calendars ?? []).find(cal => cal.id === one.calendarId)?.colour ?? undefined)} as CSSProperties} />
                  <span className="grow ell left"><Marked text={one.text} marks={parseTitle(one.text, today, google.map(cal => cal.name)).marks.filter(mark => mark.kind === 'when')} /></span>
                  <span className="ink3 num when">{dayTitle(one.date)}{one.start !== null ? ` · ${clockLabel(one.start)}` : ''}</span>
                  <span className="ink3"><Icon name="expand_more" size={16} /></span>
                </button>
                <button type="button" className="ibtn sm" aria-label={`Remove draft: ${one.text}`} data-tip="Remove draft" onClick={() => removeDraft(one.id)}><Icon name="close" size={16} /></button>
              </div>
            ))}
            <button type="button" className="btn quiet sm another" onClick={() => addAnother()}><Icon name="add" size={17} />Add another</button>
          </div>
        )}
      </div>

      {card && (card.failed ?? cardProblem) && <div className="failed-line"><Icon name="error" size={16} />{card.failed ?? cardProblem}</div>}

      {asking && editing ? (
        <div className="pop scope-pop">
          <ScopePrompt title={`Change recurring ${noun}`} choices={choices} value={scope} action="Save" onChange={setScope}
            onConfirm={submit} onCancel={() => setAsking(false)} />
        </div>
      ) : sheet ? (
        (draft.fromEmail.length > 0 || draft.fromAlfred.length > 0 || updating) && <div className="ed-foot">{legends}</div>
      ) : (
        <div className="ed-foot">
          <button type="submit" className="btn" disabled={card ? card.pending || filling : editing ? !!projectProblem : ready.length !== drafts.length}>
            {card?.pending && <span className="spin"><Icon name="progress_activity" size={16} /></span>}
            {editing ? 'Save' : drafts.length > 1 ? `Create ${drafts.length} ${noun}s` : `Create ${noun}`}<span className="kbd">⌘Enter</span>
          </button>
          <button type="button" className="btn quiet" onClick={onClose}>Cancel<span className="kbd">Esc</span></button>
          {legends}
        </div>
      )}
    </form>
  );
  if (!sheet) return editor;
  // The scope prompt, while it asks, has the say: the top bar's action waits. Cancel on a draft with
  // changes asks first, as iOS's Calendar does: Keep editing, or Discard. Esc closes the question
  // while it's up.
  return (
    <>
      <Sheet title={title} onClose={() => (discarding ? setDiscarding(false) : onClose())} onCancel={dirty ? () => setDiscarding(true) : undefined}
        action={asking && editing ? undefined : {label: editing ? 'Save' : 'Create', disabled: editing ? !!projectProblem : ready.length !== drafts.length, onClick: submit}}>
        {editor}
      </Sheet>
      {discarding && (
        <BottomSheet title={editing ? 'Discard your changes?' : `Discard this ${noun}?`} onClose={() => setDiscarding(false)}>
          <SheetChoice icon="edit" label="Keep editing" onChoose={() => {}} />
          <SheetChoice icon="delete" tone="alert" label={editing ? 'Discard changes' : `Discard ${noun}`} onChoose={onClose} />
        </BottomSheet>
      )}
    </>
  );
}

function RepeatRow({draft, mark, open, menuRef, onToggle, onPick}: {draft: Draft; mark: ReactNode; open: boolean; menuRef: (menu: HTMLElement | null) => void; onToggle: () => void; onPick: (rule: string | null) => void}) {
  return (
    <>
      <Icon name="repeat" size={17} />
      <span className="menu-host">
        <button type="button" className="field" aria-label="Repeat" aria-expanded={open} onClick={onToggle}>
          <span className="grow left">{describeRule(draft.recurrence, draft.date)}</span>
          {mark}
          <span className="ink3"><Icon name="expand_more" size={16} /></span>
        </button>
        {open && (
          <div ref={menuRef} className="pop menu" role="menu">
            {repeatChoices(draft.date, draft.recurrence).map(choice => (
              <button key={choice.rule ?? 'none'} type="button" role="menuitemradio" aria-checked={choice.rule === draft.recurrence} className="menu-i" onClick={() => onPick(choice.rule)}>
                {choice.label}{choice.rule === draft.recurrence && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        )}
      </span>
    </>
  );
}

// ---------- The conflict preview ----------

/** "6:30 – 8:30", "7 – 9": a block's times on the timeline. */
const short = (minutes: number) => clockLabel(minutes).replace(/ (AM|PM)$/, '').replace(/:00$/, '');

interface ConflictPreviewProps {
  draft: Draft;
  items: ItemOut[];
  except: string | null;
  // A free event: it clashes with nothing.
  free: boolean;
  title: string;
  colour: Colour | null;
  calendarColour: (calendarId: number) => Colour | null;
  isNew: boolean;
  timeZone: string;
}

/**
 * A small timeline of the day (boards 13 and 14): what the event overlaps in one lane, the event
 * (dashed while new) in the next, the shared time hatched in `caution`, and the line under it. Free
 * events are left out, and a free event overlaps nothing.
 */
function ConflictPreview({draft, items, except, free, title, colour, calendarColour, isNew, timeZone}: ConflictPreviewProps) {
  const start = draft.start!;
  const end = draft.end ?? start + DEFAULT_LENGTH;
  const span = {start: Date.parse(instantAt(draft.date, start, timeZone)), end: Date.parse(instantAt(draft.date, end, timeZone))};
  const overlaps = overlapsWith(span, items.filter(item => item.id > 0), except, free);
  const inMinutes = (at: number) => minutesFrom(draft.date, at, timeZone);
  const others = overlaps.map(overlap => ({
    item: overlap.item, start: inMinutes(Date.parse(overlap.item.starts_at!)), end: inMinutes(Date.parse(overlap.item.ends_at!)),
    shared: {start: inMinutes(overlap.start), end: inMinutes(overlap.end)},
  }));
  const window = timelineWindow([{start, end}, ...others]);
  const x = (minutes: number) => `${((Math.max(window.from, Math.min(window.to, minutes)) - window.from) / (window.to - window.from)) * 100}%`;
  const width = (from: number, to: number) => `${((Math.min(window.to, to) - Math.max(window.from, from)) / (window.to - window.from)) * 100}%`;
  const label = (name: string, from: number, to: number) => (to - from >= 90 ? `${name} · ${short(from)} – ${short(to)}` : name);
  const verdict = conflictLine(overlaps);
  const lines = timelineLabels(window);
  return (
    <div className="conflict">
      <div className="flabel">{dayTitle(draft.date)}</div>
      <div className={`tl${others.length ? ' two' : ''}`} aria-label={`Conflict preview, ${lines[0]!.label} to ${lines.at(-1)!.label}`}>
        {lines.slice(1, -1).map(hour => <span key={hour.at} className="hr" style={{left: `${hour.at * 100}%`}} />)}
        {others.map(other => <span key={`hatch-${other.item.key}`} className="hatch" style={{left: x(other.shared.start), width: width(other.shared.start, other.shared.end)}} />)}
        {others.map(other => (
          <span key={other.item.key} className="bk other" style={{left: x(other.start), width: width(other.start, other.end), '--c': colourVar(other.item.colour ?? calendarColour(other.item.calendar_id) ?? undefined)} as CSSProperties}>{label(other.item.title, other.start, other.end)}</span>
        ))}
        <span className={`bk self${isNew ? ' new' : ''}`} style={{left: x(start), width: width(start, end), '--c': colourVar(colour ?? undefined)} as CSSProperties}>
          {label(title, start, end)}
        </span>
      </div>
      <div className="tlx num" aria-hidden="true">
        {lines.map((hour, index) => (
          <span key={hour.at} style={index === 0 ? {left: 0, transform: 'none'} : index === lines.length - 1 ? {right: 0, transform: 'none'} : {left: `${hour.at * 100}%`}}>{hour.label}</span>
        ))}
      </div>
      <div className={`verdict${verdict.free ? ' free' : ''}`}><Icon name={verdict.free ? 'check_circle' : 'warning'} size={16} />{verdict.text}</div>
    </div>
  );
}
