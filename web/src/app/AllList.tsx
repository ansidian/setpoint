// The Inbox, days first (board 05). Attention and the Pinned shelf come first. Then every email,
// Noise included, comes newest first under day headings, Today first. Unread mail stays in its day,
// drawn unread. The Inbox's views draw their part of it here too. Each day's rows go by lane. The
// kind shows once as a subheading where an FYI run starts. A day's Noise folds to one line that
// opens in place. Attention and the shelf are bands with ages. The pattern prompt sits under
// Attention, and Unpin shows under the pointer on the shelf. An email in either band leaves its day
// meanwhile. Today's rows show ages, and earlier days' rows show clock times. A live code has Copy
// and its countdown wherever it is. Pages load as the list nears its end. What shows comes from
// logic/all.ts, and the actions are the page's. A trashed row folds out and Undo folds it back in
// (app/fold.ts). A row Done takes in a day stays: it ticks in place, then settles quiet with a Done
// tag. Each row has mail's slot after its subject (slots.tsx), which another module may fill.
// Sent draws its days here too, each row naming who it went to (`from`), with no slot. Its rows
// name their account; the Inbox's don't, as the reader's band names it.
// On the phone its rows swipe (phone/swipe.tsx) as the page says, and Select's mode puts a circle
// before each one.
import type {AccountOut, InboxGroup, MessageRowOut} from '@setpoint/shared';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {MouseEvent, ReactNode, UIEvent} from 'react';
import {allRowLine, dayHeading, listKey, noiseKey} from '../logic/all.ts';
import type {AllLane, DayView} from '../logic/all.ts';
import type {Entry, Folded, FoldRules} from '../logic/fold.ts';
import {age, clockTime, codeGroups, dayOf, fullTimestamp, localDate, trashLeft} from '../logic/format.ts';
import {codeExpired, GROUP_GLYPHS, GROUP_LABELS, groupKey, promptText, rowKey, showsPending} from '../logic/inbox.ts';
import type {PatternPrompt} from '../logic/inbox.ts';
import {snoozeable, snoozedLine, snoozeWhen} from '../logic/snooze.ts';
import {Icon} from '../ui/Icon.tsx';
import {keepTextUnselected} from '../ui/keys.ts';
import type {IconName} from '../ui/glyphs.ts';
import {dotStyle} from './accounts.ts';
import {CodeCopy, useCountdown} from './Code.tsx';
import {beats, FOLD_HOLD_MS, foldDelays, foldRef, useFold} from './fold.ts';
import {useRowSlot} from './slots.tsx';
import {SnoozeMenu} from './SnoozeMenu.tsx';
import type {Beat} from './fold.ts';
import {Count} from './Count.tsx';
import {useSwipes} from './phone/swipe.tsx';
import type {SwipeAct, SwipeActs} from './phone/swipe.tsx';
import {TriageNote, useHealthBars} from './states/States.tsx';
import {AllSkeleton} from './states/Skeletons.tsx';
import {ScrollThumb} from './ScrollThumb.tsx';

/** A band over one of the list's parts above the days: Attention or the Pinned shelf. */
type Band = 'attention' | 'pinned';
const BANDS: Record<Band, {label: string; glyph: IconName}> = {
  attention: {label: 'Attention', glyph: GROUP_GLYPHS.attention}, pinned: {label: 'Pinned', glyph: GROUP_GLYPHS.pinned},
};

// A row's `noise` is the day whose Noise it's under, folded or not. An `aged` row shows its age
// rather than its clock time (Attention, the shelf, Today).
type Part = {kind: 'band'; band: Band; count: number} | {kind: 'day'; date: string}
  | {kind: 'lane'; date: string; lane: AllLane; label: string; count: number; note: boolean}
  | {kind: 'kh'; group: InboxGroup} | {kind: 'noise'; date: string; count: number; preview: string; open: boolean}
  | {kind: 'row'; row: MessageRowOut; group: InboxGroup | null; shelf: boolean; aged: boolean; noise: string | null}
  | {kind: 'prompt'; prompt: PatternPrompt};
// Every row folds, and a Noise line opens like a drawer, its rows folding in.
const RULES: FoldRules<Part> = {
  folds: () => true,
  arrives: () => true,
  opens: (entry, was) => {
    const noise = entry.item.kind === 'row' ? entry.item.noise : null;
    const line = noise === null ? undefined : was(noiseKey(noise))?.item;
    return line?.kind === 'noise' && !line.open;
  },
};
const NONE: ReadonlySet<number> = new Set();
const NO_ROWS: MessageRowOut[] = [];

// A row's run, for staggering rows that fold together: its lane, its Noise, or its band.
const runOf = (entry: Folded<Part>) => (entry.item.kind !== 'row' ? null : entry.item.shelf ? 'shelf' : entry.item.noise ? `noise:${entry.item.noise}` : `day:${entry.item.group ?? ''}`);

export function AllList({attention, days, shelf, lanes = true, fill = false, empty = null, cursor, openId, selected = NONE, accounts, now, timeZone, loading, arrived, more, dimmed = false, prompt = null,
  label = 'Inbox', from, slot = true, account = true, swipe = null, selecting = false, focusable = false, onPoint, onOpen, onToggleNoise, onNearEnd, onUnpin, onSnooze, selectionSnooze, onAnswer, onCodeCopied}: {
  // Attention's rows, every Attention email not yet Done.
  attention: MessageRowOut[];
  days: DayView[];
  // Whether the days name their lanes: not in a view that is one lane (FYI, Noise).
  lanes?: boolean;
  // Whether a list too short to scroll asks for the next page itself, as a filtered view can be.
  fill?: boolean;
  // A view with nothing in it says so.
  empty?: ReactNode;
  // The Pinned shelf's rows, newest pin first.
  shelf: MessageRowOut[];
  cursor: string | null;
  openId: number | null;
  // The emails selected, drawn as the open one is.
  selected?: ReadonlySet<number>;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // Until the first page: its skeleton, or why it didn't load. `arrived`: the rows came after it,
  // and fade in. `more`: the next page is on its way.
  loading: ReactNode;
  arrived: boolean;
  more: boolean;
  // A search's first answer on its way: the list stays, dimmed, until it comes.
  dimmed?: boolean;
  // The pattern prompt under Attention.
  prompt?: PatternPrompt | null;
  // The list's name, for a screen reader.
  label?: string;
  // What a row shows in the sender's place (Sent's "To Sam Ortiz"), and whether mail's slot shows.
  from?: (row: MessageRowOut) => ReactNode;
  slot?: boolean;
  // Whether each row names its account. The Inbox's don't: the reader's band names it there.
  account?: boolean;
  // On the phone, what each row's swipes offer and what picking one does (phone/swipe.tsx). None while selecting.
  swipe?: {acts: (row: MessageRowOut, key: string) => SwipeActs; run: (row: MessageRowOut, act: SwipeAct) => void} | null;
  // A list whose rows hold nothing to focus (Sent's on the phone) takes the focus itself, so a keyboard can scroll it.
  focusable?: boolean;
  // On the phone, Select's mode: each row has its circle, ticked while it's selected, and a tap selects.
  selecting?: boolean;
  onPoint: (key: string) => void;
  // A click on a row, with its modifiers: ⌘ or Ctrl and ⇧ select, a plain one opens.
  onOpen: (id: number, key: string, event: MouseEvent) => void;
  onToggleNoise: (date: string) => void;
  onNearEnd: () => void;
  onUnpin: (id: number) => void;
  // A row's Snooze, under the pointer (and S on the cursor row): until that moment (ms). None where mail can't be snoozed.
  onSnooze?: (id: number, until: number) => void;
  // Where the selection's pane isn't on screen, the row (its key) whose Snooze is the selection's, and what it picks.
  selectionSnooze?: {key: string; pick: (until: number) => void} | null;
  onAnswer?: (prompt: PatternPrompt, yes: boolean) => void;
  // A code row's Copy, once the clipboard has it: it reads the email.
  onCodeCopied?: (id: number) => void;
}) {
  const today = localDate(now, timeZone);
  const nearEnd = (list: HTMLElement) => list.scrollHeight - list.scrollTop - list.clientHeight < 600;
  const onScroll = (event: UIEvent<HTMLElement>) => {
    swipes.close();
    if (nearEnd(event.currentTarget)) onNearEnd();
  };
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (fill && section.current && nearEnd(section.current)) onNearEnd();
  });
  const entries = useMemo(() => {
    const rowEntry = (row: MessageRowOut, group: InboxGroup | null, part: 'attention' | 'all', aged: boolean, noise: string | null = null): Entry<Part> =>
      ({key: listKey(part, row.id), id: row.id, item: {kind: 'row', row, group, shelf: false, aged, noise}});
    // Triage's note while it's down sits on the newest Unsorted lane, where the mail it couldn't sort is.
    const noted = days.find(day => day.lanes.some(lane => lane.lane === 'unsorted'))?.date ?? null;
    const dayParts = (day: DayView): Entry<Part>[] => {
      // Today's rows show ages, as Attention's and the shelf's do. An earlier day's rows show clock times.
      const aged = day.date === today;
      return [
        ...day.lanes.flatMap(lane => [
          // Attention counts what still needs the user, as Attention's segment does.
          ...(lanes ? [{key: `lane:${day.date}:${lane.lane}`, id: null, item: {kind: 'lane', date: day.date, lane: lane.lane, label: lane.label,
            count: lane.lane === 'attention' ? lane.rows.filter(({row}) => !row.done).length : lane.rows.length, note: lane.lane === 'unsorted' && day.date === noted}} satisfies Entry<Part>] : []),
          ...lane.rows.flatMap(({row, kind}) => [
            ...(kind ? [{key: `kind:${day.date}:${kind}`, id: null, item: {kind: 'kh', group: kind}} satisfies Entry<Part>] : []),
            rowEntry(row, kind, 'all', aged),
          ]),
        ]),
        ...(day.noise ? [
          {key: noiseKey(day.date), id: null, item: {kind: 'noise', date: day.date, count: day.noise.count, preview: day.noise.preview, open: day.noise.open}} satisfies Entry<Part>,
          ...day.noise.rows.map(row => rowEntry(row, null, 'all', aged, day.date)),
        ] : []),
      ];
    };
    const band = (name: Band, count: number): Entry<Part> => ({key: `band:${name}`, id: null, item: {kind: 'band', band: name, count}});
    return [
      ...(attention.length ? [
        band('attention', attention.length), ...attention.map(row => rowEntry(row, null, 'attention', true)),
        // The pattern prompt ends Attention (board 09).
        ...(prompt ? [{key: `prompt:${prompt.id}`, id: null, item: {kind: 'prompt', prompt}} satisfies Entry<Part>] : []),
      ] : []),
      ...(shelf.length ? [
        {...band('pinned', shelf.length), key: groupKey('pinned')},
        ...shelf.map((row): Entry<Part> => ({key: rowKey('pinned', row.id), id: row.id, item: {kind: 'row', row, group: null, shelf: true, aged: true, noise: null}})),
      ] : []),
      ...days.flatMap((day): Entry<Part>[] => [{key: `day:${day.date}`, id: null, item: {kind: 'day', date: day.date}}, ...dayParts(day)]),
    ];
  }, [attention, days, shelf, lanes, prompt, today]);
  const shown = useFold(entries, RULES, FOLD_HOLD_MS);
  // Each row by its key, for its swipes.
  const rowsByKey = useMemo(() => new Map(entries.flatMap(entry => (entry.item.kind === 'row' ? [[entry.key, entry.item.row] as const] : []))), [entries]);
  const swipes = useSwipes({
    enabled: swipe !== null && !selecting,
    acts: key => {
      const row = rowsByKey.get(key);
      return row && swipe ? swipe.acts(row, key) : null;
    },
    run: (key, act) => {
      const row = rowsByKey.get(key);
      if (row && swipe) swipe.run(row, act);
    },
  });
  // Every row the list holds, for the slot after the subject, asked about all at once.
  const slotRows = useMemo(() => entries.flatMap(entry => (entry.item.kind === 'row' ? [entry.item.row] : [])), [entries]);
  const afterSubject = useRowSlot(slot ? slotRows : NO_ROWS);
  const ticked = useTicked(days);
  // A row Trash took beats first. Rows folding together start one after another.
  const delays = foldDelays(shown, runOf);
  // Under a health bar the first band keeps its top line (boards 17, 19a).
  const bars = useHealthBars();
  // The row whose Snooze menu is open: it keeps its pointer look until the menu closes.
  const [snoozing, setSnoozing] = useState<string | null>(null);
  return (
    <section ref={section} className={['list', 'all', arrived && 'sk-arrive', dimmed && 'search-wait', selecting && 'selecting'].filter(Boolean).join(' ')} aria-label={label} tabIndex={focusable ? 0 : undefined} onScroll={onScroll} {...(swipe ? swipes.handlers : {})}>
      <ScrollThumb />
      {bars}
      {shown.map(({key, id, item, fold}, index) => {
        const ref = foldRef(fold, delays.get(key), item.kind === 'row' && item.shelf);
        const leaving = fold === 'out';
        const first = index === 0 && !bars;
        const beat = leaving && id !== null ? beats.get(id) ?? null : null;
        if (item.kind === 'band') {
          const {label, glyph} = BANDS[item.band];
          return (
            <div key={key} ref={ref} className={['gh', item.band, item.band === 'attention' && 'att', first && 'first', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              <span className="gi"><Icon name={glyph} size={14} /></span>{label}{item.count > 0 && <> <span className="n"><Count value={item.count} /></span></>}
            </div>
          );
        }
        if (item.kind === 'day') {
          const heading = dayHeading(item.date, today);
          return (
            <div key={key} ref={ref} className={['gh', 'day', item.date === today && 'today', first && 'first', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              {heading.label} <span className="date">{heading.date}</span>
            </div>
          );
        }
        if (item.kind === 'lane') {
          // An Attention lane whose mail is all Done drops its count rather than reading 0.
          return (
            <div key={key} ref={ref} data-lane={item.lane} className={['lh', item.lane === 'attention' && 'att', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              {item.label}{item.count > 0 && <> <span className="n"><Count value={item.count} /></span></>}
              {item.note && <TriageNote />}
            </div>
          );
        }
        if (item.kind === 'kh') {
          return (
            <div key={key} ref={ref} data-kind={item.group} className={['kh', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              <Icon name={GROUP_GLYPHS[item.group]} size={13} />{GROUP_LABELS[item.group]}
            </div>
          );
        }
        if (item.kind === 'noise') {
          const folded = !item.open && !leaving;
          return (
            <div key={key} ref={ref} className={['nfold', folded && 'collapsed', folded && cursor === key && 'cur', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}
              data-key={folded ? key : undefined} onMouseMove={folded ? () => key !== cursor && onPoint(key) : undefined} onClick={leaving ? undefined : () => onToggleNoise(item.date)}>
              <span className="gi"><Icon name={GROUP_GLYPHS.noise} size={14} /></span>Noise <span className="n">{item.count}</span>
              <span className="preview">{item.preview}</span>
              {/* One chevron, turned to point right while it's folded. */}
              <span className="chev"><Icon name="expand_more" /></span>
            </div>
          );
        }
        if (item.kind === 'prompt') return <Prompt key={key} prompt={item.prompt} onAnswer={onAnswer} leaving={leaving} fold={ref} />;
        const {row} = item;
        const line = allRowLine(row);
        const rowAccount = accounts.get(row.account_id);
        const tick = ticked.has(row.id);
        // Attention's dot and ring are `caution`, and Noise recedes, wherever they are.
        const classes = ['row', item.shelf && 'shelf', row.lane === 'attention' && 'att', row.lane === 'noise' && 'noise', row.unread && 'unread', row.done && 'done', tick && 'ticked', !leaving && cursor === key && 'cur', !leaving && openId === row.id && 'open', !leaving && selected.has(row.id) && 'sel', showsPending(row) && 'pending', leaving && 'leaving', beat && `beat-${beat}`, snoozing === key && 'menu-open']
          .filter(Boolean).join(' ');
        const unpin = (event: MouseEvent) => {
          event.stopPropagation();
          onUnpin(row.id);
        };
        return (
          <div key={key} ref={ref} className={classes} data-key={leaving ? undefined : key} data-id={row.id} aria-hidden={leaving || undefined}
            onMouseMove={leaving ? undefined : () => key !== cursor && onPoint(key)} onMouseDown={keepTextUnselected} onClick={leaving ? undefined : event => onOpen(row.id, key, event)}>
            {/* Its tray, while it's swiped, and as it slides off on its way out. */}
            {swipe && swipes.tray(key)}
            {selecting && !leaving && (
              <span className="pick" role="checkbox" aria-checked={selected.has(row.id)} aria-label={`${line.from}, ${line.subject}`}>
                <Icon name={selected.has(row.id) ? 'check_circle-fill' : 'radio_button_unchecked'} size={22} />
              </span>
            )}
            <Gutter beat={beat ?? (tick ? 'done' : null)} />
            {from ? from(row) : <span className="from">{line.from}</span>}
            {/* A live code has Copy and its countdown wherever it is. Once it's expired, the code is inside the subject. */}
            {row.code && !codeExpired(row, now) ? <CodeLine code={row.code} onCopied={() => onCodeCopied?.(row.id)} /> : (
              <span className="subj">
                {/* The subject a summary stands in for, under the words it replaces rather than the whole row's middle. */}
                <b className={line.alert ? 'alertsubj' : undefined} data-tip={line.title ?? undefined}>
                  {line.code ? <>{line.code.before}<span className="code">{line.code.value}</span>{line.code.after}</> : line.subject}
                </b>
                {line.summary && <>{' '}<span className="sum">· {line.summary}</span></>}
              </span>
            )}
            {/* A rule's waiting trash, auto_delete and "4 h" before the account and time. A live code keeps its own countdown. */}
            {row.trash_due_at && !row.pinned && !(row.code && !codeExpired(row, now)) && (
              <span className="trash-in num" data-tip={`Trash in ${trashLeft(row.trash_due_at, now)}`} aria-label={`Trash in ${trashLeft(row.trash_due_at, now)}`}>
                <Icon name="auto_delete" size={14} />{trashLeft(row.trash_due_at, now)}
              </span>
            )}
            {/* The marks: the reply mark on an email the user answered, a snooze's, and a draft's tag.
                One box, so the phone's row gives them one place on the sender's line. */}
            {(row.replied_at || row.snoozed_until || row.returned_at || row.draft) && (
              <span className="marks">
                {row.replied_at && <RepliedMark at={row.replied_at} now={now} timeZone={timeZone} />}
                {row.snoozed_until && <SnoozedMark until={row.snoozed_until} now={now} timeZone={timeZone} />}
                {row.returned_at && !row.snoozed_until && <ReturnedMark row={row} timeZone={timeZone} />}
                {row.draft && <span className="drafted">Draft</span>}
              </span>
            )}
            {slot && afterSubject(row)}
            {row.done && <span className="tag"><Icon name="check" size={14} />Done</span>}
            {account && <span className="ac"><span className="dot sm" style={dotStyle(rowAccount?.colour)} /><span className="label">{rowAccount?.label}</span></span>}
            <span className="age" data-tip={fullTimestamp(row.received_at, timeZone)}>{rowWhen(row, item.aged, now, timeZone)}</span>
            {/* Under the pointer Snooze takes the age's place, and on the Pinned shelf Unpin with it (board 10). */}
            {!leaving && ((onSnooze && snoozeable(row)) || item.shelf) && (
              <span className="hact">
                {onSnooze && snoozeable(row) && (
                  <SnoozeMenu keyed={selectionSnooze?.key === key ? 'selection' : cursor === key ? 'row' : undefined} onOpen={open => setSnoozing(open ? key : null)}
                    onPick={until => (selectionSnooze?.key === key ? selectionSnooze.pick(until) : onSnooze(row.id, until))}
                    button={(open, toggle) => <button className="ibtn sm row-snooze" type="button" aria-label="Snooze" aria-haspopup="menu" aria-expanded={open} data-tip={open ? undefined : 'Snooze'} onClick={toggle}><Icon name="snooze" size={16} /></button>} />
                )}
                {item.shelf && <button className="unpin" type="button" onClick={unpin}><Icon name="keep_off" size={15} />Unpin</button>}
              </span>
            )}
          </div>
        );
      })}
      {loading ?? (!shown.length && empty)}
      {more && <AllSkeleton more account={account} />}
    </section>
  );
}

/** A row's reply mark: the `reply` glyph, with when the user replied in its tip. */
export function RepliedMark({at, now, timeZone}: {at: string; now: number; timeZone: string}) {
  const words = `You replied ${dayOf(at, now, timeZone)}`;
  return <span className="replied" role="img" aria-label={words} data-tip={words}><Icon name="reply" size={16} /></span>;
}

/**
 * When a row's email came: its age or clock time, or for one back from a snooze on a later day, the
 * day it first came ("Nov 21"), since its place in the list is when it returned.
 */
function rowWhen(row: MessageRowOut, aged: boolean, now: number, timeZone: string): string {
  if (row.returned_at && localDate(row.returned_at, timeZone) !== localDate(row.received_at, timeZone)) return dayOf(row.received_at, now, timeZone);
  return aged ? age(row.received_at, now, timeZone) : clockTime(row.received_at, timeZone);
}

/** A snoozed row's mark, in All's search results: `snooze` and when it returns ("Mon 9:00 AM"). */
export function SnoozedMark({until, now, timeZone}: {until: string; now: number; timeZone: string}) {
  const words = snoozedLine(until, now, timeZone);
  return <span className="snoozed num" role="img" aria-label={words} data-tip={words}><Icon name="snooze" size={14} />{snoozeWhen(until, now, timeZone)}</span>;
}

/** A row back from a snooze: a small `snooze`, with when it returned in its tip. */
export function ReturnedMark({row, timeZone}: {row: MessageRowOut; timeZone: string}) {
  const words = `Back from snooze at ${fullTimestamp(row.returned_at!, timeZone)}`;
  return <span className="returned" role="img" aria-label={words} data-tip={words}><Icon name="snooze" size={14} /></span>;
}

/** The unread gutter: its dot, or while a row beats, Done's check or Trash's bin in its place. */
export function Gutter({beat}: {beat: Beat | null}) {
  return <span className="ud">{beat && <Icon name={beat === 'done' ? 'check' : beat === 'snooze' ? 'snooze' : 'delete'} size={14} />}</span>;
}

/** A code row: the code in two groups of three, Copy (the code without its space), and its countdown. */
function CodeLine({code, onCopied}: {code: {value: string; expires_at: string}; onCopied: () => void}) {
  const countdown = useCountdown(code.expires_at);
  return (
    <span className="subj code-line">
      <span className="code">{codeGroups(code.value)}</span>
      <CodeCopy value={code.value} onCopied={onCopied} />
      <span className={countdown.soon ? 'sum soon' : 'sum'}>{countdown.text}</span>
    </span>
  );
}

/** The pattern prompt: one card line at the end of Attention (board 09), never for protected mail. */
function Prompt({prompt, onAnswer, leaving, fold}: {prompt: PatternPrompt; onAnswer?: (prompt: PatternPrompt, yes: boolean) => void; leaving: boolean; fold: ReturnType<typeof foldRef>}) {
  return (
    <div className={leaving ? 'prompt leaving' : 'prompt'} ref={fold} data-prompt={leaving ? undefined : prompt.id} aria-hidden={leaving || undefined}>
      <span className="prompt-icon"><Icon name="low_priority" size={20} /></span>
      <span className="grow">{promptText(prompt)}</span>
      <button className="btn sm" type="button" onClick={() => onAnswer?.(prompt, true)}>Yes</button>
      <button className="btn ghost sm" type="button" onClick={() => onAnswer?.(prompt, false)}>No</button>
    </div>
  );
}

/**
 * The rows that turned Done while the list showed them, so each ticks once, in place. A row already
 * Done when it first showed doesn't tick, and Undo takes the tick away with the Done.
 */
function useTicked(days: DayView[]): ReadonlySet<number> {
  const [state, setState] = useState(() => ({days, seen: doneOf(days), ticked: new Set<number>()}));
  if (state.days === days) return state.ticked;
  const seen = doneOf(days);
  const ticked = new Set([...state.ticked].filter(id => seen.get(id)));
  for (const [id, done] of seen) if (done && state.seen.get(id) === false) ticked.add(id);
  setState({days, seen: new Map([...state.seen, ...seen]), ticked});
  return ticked;
}

/** Whether each row the days show is Done. */
const doneOf = (days: DayView[]) => new Map(days.flatMap(day => day.lanes.flatMap(lane => lane.rows.map(({row}): [number, boolean] => [row.id, row.done]))));
