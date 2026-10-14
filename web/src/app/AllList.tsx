// The Inbox, one list (SV-70, D264, D266; DESIGN.md › All; board 05): New, Attention, the Pinned
// shelf, then every email, Noise included, newest first, under day headings with clock times. New is
// drawn as a day is, under its own band and with ages: its rows by lane, the kind once in a left
// column where an FYI run starts (a subheading over the run where the column has no room, #237), its
// Noise folded to one line that opens in place (#48), the pattern prompt under its Attention, and
// Mark all as read under it all. Attention and the shelf are bands with ages, and Unpin under the
// pointer on the shelf. An email in any of them leaves its day meanwhile (D105). A code row above
// the days has Copy and its countdown. Pages load as the list nears its end. What shows comes from
// logic/all.ts; actions are the page's. A trashed row folds out and Undo folds it back in
// (app/fold.ts). A row Done takes in a day stays: it ticks in place, then settles quiet with a Done
// tag (SV-69).
import type {AccountOut, InboxGroup, MessageRowOut} from '@setpoint/shared';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {MouseEvent, ReactNode, RefObject, UIEvent} from 'react';
import {allRowLine, dayHeading, listKey, NEW, noiseKey} from '../logic/all.ts';
import type {AllLane, DayView} from '../logic/all.ts';
import type {Entry, Folded, FoldRules} from '../logic/fold.ts';
import {age, clockTime, codeGroups, fullTimestamp, localDate} from '../logic/format.ts';
import {GROUP_GLYPHS, GROUP_LABELS, groupKey, promptText, rowKey, showsPending} from '../logic/inbox.ts';
import type {PatternPrompt} from '../logic/inbox.ts';
import {Icon} from '../ui/Icon.tsx';
import type {IconName} from '../ui/glyphs.ts';
import {dotStyle} from './accounts.ts';
import {CodeCopy, useCountdown} from './Code.tsx';
import {beats, FOLD_HOLD_MS, foldDelays, foldRef, useFold} from './fold.ts';
import type {Beat} from './fold.ts';
import {Count} from './Count.tsx';
import {TriageNote, useHealthBars} from './states/States.tsx';
import {AllSkeleton} from './states/Skeletons.tsx';

/** A band over one of the list's parts: New, Attention or the Pinned shelf. */
type Band = 'new' | 'attention' | 'pinned';
const BANDS: Record<Band, {label: string; glyph: IconName}> = {
  new: {label: 'New', glyph: 'mark_email_unread'}, attention: {label: 'Attention', glyph: GROUP_GLYPHS.attention}, pinned: {label: 'Pinned', glyph: GROUP_GLYPHS.pinned},
};

// A row's `noise` is the day whose Noise it's under ("new" for New's), folded or not; an `aged` row
// shows its age rather than its clock time, and a code's Copy (New, Attention, the shelf).
type Part = {kind: 'band'; band: Band; count: number} | {kind: 'day'; date: string} | {kind: 'lane'; date: string; lane: AllLane; label: string; count: number}
  | {kind: 'kh'; group: InboxGroup} | {kind: 'noise'; date: string; count: number; preview: string; open: boolean}
  | {kind: 'row'; row: MessageRowOut; group: InboxGroup | null; shelf: boolean; aged: boolean; noise: string | null}
  | {kind: 'prompt'; prompt: PatternPrompt} | {kind: 'foot'};
// Every row folds, and a Noise line opens like a drawer, its rows folding in (inbox-14).
const RULES: FoldRules<Part> = {
  folds: () => true,
  arrives: () => true,
  opens: (entry, was) => {
    const noise = entry.item.kind === 'row' ? entry.item.noise : null;
    const line = noise === null ? undefined : was(noiseKey(noise))?.item;
    return line?.kind === 'noise' && !line.open;
  },
};
// A row's run, for staggering rows that fold together: its lane, its Noise, or its band.
const runOf = (entry: Folded<Part>) => (entry.item.kind !== 'row' ? null : entry.item.shelf ? 'shelf' : entry.item.noise ? `noise:${entry.item.noise}` : `day:${entry.item.group ?? ''}`);

export function AllList({fresh, freshUnread = 0, attention, days, shelf, cursor, openId, accounts, now, timeZone, loading, arrived, more, dimmed = false, prompt = null, markable = false,
  onPoint, onOpen, onToggleNoise, onNearEnd, onUnpin, onAnswer, onMarkAllRead}: {
  // New's lanes and Noise, drawn as a day's (null when nothing's New), how many of it are unread (its
  // band's count), and Attention's rows.
  fresh: DayView | null;
  freshUnread?: number;
  attention: MessageRowOut[];
  days: DayView[];
  // The Pinned shelf's rows, newest pin first.
  shelf: MessageRowOut[];
  cursor: string | null;
  openId: number | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // Until the first page: its skeleton, or why it didn't load. `arrived`: the rows came after it,
  // and fade in. `more`: the next page is on its way.
  loading: ReactNode;
  arrived: boolean;
  more: boolean;
  // A search's first answer on its way: the list stays, dimmed, until it comes (#235).
  dimmed?: boolean;
  // The pattern prompt under New's Attention, and whether Mark all as read has anything to read (UX #16).
  prompt?: PatternPrompt | null;
  markable?: boolean;
  onPoint: (key: string) => void;
  onOpen: (id: number, key: string) => void;
  onToggleNoise: (date: string) => void;
  onNearEnd: () => void;
  onUnpin: (id: number) => void;
  onAnswer?: (prompt: PatternPrompt, yes: boolean) => void;
  onMarkAllRead?: () => void;
}) {
  const today = localDate(now, timeZone);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const list = event.currentTarget;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 600) onNearEnd();
  };
  const entries = useMemo(() => {
    const rowEntry = (row: MessageRowOut, group: InboxGroup | null, part: 'new' | 'attention' | 'all', noise: string | null = null): Entry<Part> =>
      ({key: listKey(part, row.id), id: row.id, item: {kind: 'row', row, group, shelf: false, aged: part !== 'all', noise}});
    const lanes = (day: DayView, part: 'new' | 'all'): Entry<Part>[] => [
      ...day.lanes.flatMap(lane => [
        // Attention counts what still needs the user, as the sidebar's pill does (SV-69).
        {key: `lane:${day.date}:${lane.lane}`, id: null, item: {kind: 'lane', date: day.date, lane: lane.lane, label: lane.label,
          count: lane.lane === 'attention' ? lane.rows.filter(({row}) => !row.done).length : lane.rows.length}} satisfies Entry<Part>,
        ...lane.rows.flatMap(({row, kind}) => [
          ...(kind ? [{key: `kind:${day.date}:${kind}`, id: null, item: {kind: 'kh', group: kind}} satisfies Entry<Part>] : []),
          rowEntry(row, kind, part),
        ]),
        // The pattern prompt ends New's Attention (board 09).
        ...(part === 'new' && lane.lane === 'attention' && prompt ? [{key: `prompt:${prompt.id}`, id: null, item: {kind: 'prompt', prompt}} satisfies Entry<Part>] : []),
      ]),
      ...(day.noise ? [
        {key: noiseKey(day.date), id: null, item: {kind: 'noise', date: day.date, count: day.noise.count, preview: day.noise.preview, open: day.noise.open}} satisfies Entry<Part>,
        ...day.noise.rows.map(row => rowEntry(row, null, part, day.date)),
      ] : []),
    ];
    const band = (name: Band, count: number): Entry<Part> => ({key: `band:${name}`, id: null, item: {kind: 'band', band: name, count}});
    return [
      ...(fresh ? [band('new', freshUnread), ...lanes(fresh, 'new')] : []),
      ...(fresh && markable ? [{key: 'foot', id: null, item: {kind: 'foot'}} satisfies Entry<Part>] : []),
      ...(attention.length ? [band('attention', attention.length), ...attention.map(row => rowEntry(row, null, 'attention'))] : []),
      ...(shelf.length ? [
        {...band('pinned', shelf.length), key: groupKey('pinned')},
        ...shelf.map((row): Entry<Part> => ({key: rowKey('pinned', row.id), id: row.id, item: {kind: 'row', row, group: null, shelf: true, aged: true, noise: null}})),
      ] : []),
      ...days.flatMap((day): Entry<Part>[] => [{key: `day:${day.date}`, id: null, item: {kind: 'day', date: day.date}}, ...lanes(day, 'all')]),
    ];
  }, [fresh, freshUnread, attention, days, shelf, prompt, markable]);
  const shown = useFold(entries, RULES, FOLD_HOLD_MS);
  const [list, keep] = useKeptRow(openId);
  const ticked = useTicked(days);
  // A row Trash took beats first; rows folding together start one after another.
  const delays = foldDelays(shown, runOf);
  // Under a health bar the first band keeps its top line (boards 17, 19a).
  const bars = useHealthBars();
  return (
    <section className={['list', 'all', arrived && 'sk-arrive', dimmed && 'search-wait'].filter(Boolean).join(' ')} aria-label="Inbox" ref={list} onScroll={event => {
      keep();
      onScroll(event);
    }}>
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
          return <div key={key} ref={ref} className={['gh', 'day', first && 'first', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>{heading.label} <span className="date">{heading.date}</span></div>;
        }
        if (item.kind === 'lane') {
          // An Attention lane whose mail is all Done drops its count rather than reading 0.
          return (
            <div key={key} ref={ref} className={['lh', item.lane === 'attention' && 'att', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              {item.label}{item.count > 0 && <> <span className="n"><Count value={item.count} /></span></>}
              {item.date === NEW && item.lane === 'unsorted' && <TriageNote />}
            </div>
          );
        }
        if (item.kind === 'kh') {
          return (
            <div key={key} ref={ref} className={['kh', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              <Icon name={GROUP_GLYPHS[item.group]} size={13} />{GROUP_LABELS[item.group]}
            </div>
          );
        }
        if (item.kind === 'noise') {
          const folded = !item.open && !leaving;
          return (
            <div key={key} ref={ref} className={['nfold', folded && 'collapsed', folded && cursor === key && 'cur', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}
              data-key={folded ? key : undefined} onMouseMove={folded ? () => key !== cursor && onPoint(key) : undefined} onClick={leaving ? undefined : () => onToggleNoise(item.date)}>
              Noise <span className="n">{item.count}</span>
              <span className="preview">{item.preview}</span>
              {/* One chevron, turned to point right while it's folded (inbox-14). */}
              <span className="chev"><Icon name="expand_more" /></span>
            </div>
          );
        }
        if (item.kind === 'prompt') return <Prompt key={key} prompt={item.prompt} onAnswer={onAnswer} leaving={leaving} fold={ref} />;
        if (item.kind === 'foot') {
          return (
            <div key={key} ref={ref} className={['listfoot', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              <button className="lnk" type="button" data-hint="shift+i" onClick={onMarkAllRead}><Icon name="mark_email_read" size={16} />Mark all as read <span className="kbd">⇧I</span></button>
            </div>
          );
        }
        const {row} = item;
        const line = allRowLine(row);
        const account = accounts.get(row.account_id);
        const tick = ticked.has(row.id);
        // Attention's dot and ring are `caution` (#167), and Noise recedes (#168), wherever they are.
        const classes = ['row', item.shelf && 'shelf', row.lane === 'attention' && 'att', row.lane === 'noise' && 'noise', row.unread && 'unread', row.done && 'done', tick && 'ticked', !leaving && cursor === key && 'cur', !leaving && openId === row.id && 'open', showsPending(row) && 'pending', leaving && 'leaving', beat && `beat-${beat}`]
          .filter(Boolean).join(' ');
        const unpin = (event: MouseEvent) => {
          event.stopPropagation();
          onUnpin(row.id);
        };
        return (
          <div key={key} ref={ref} className={classes} title={line.title ?? undefined} data-key={leaving ? undefined : key} data-id={row.id} aria-hidden={leaving || undefined}
            onMouseMove={leaving ? undefined : () => key !== cursor && onPoint(key)} onClick={leaving ? undefined : () => onOpen(row.id, key)}>
            <span className="kd">{item.group && <><Icon name={GROUP_GLYPHS[item.group]} size={13} /><span className="ell">{GROUP_LABELS[item.group]}</span></>}</span>
            <Gutter beat={beat ?? (tick ? 'done' : null)} />
            <span className="from">{line.from}</span>
            {/* A live code above the days has Copy and its countdown, as the Inbox's always had. */}
            {item.aged && row.code ? <CodeLine code={row.code} /> : (
              <span className="subj">
                <b className={line.alert ? 'alertsubj' : undefined}>
                  {line.code ? <>{line.code.before}<span className="code">{line.code.value}</span>{line.code.after}</> : line.subject}
                </b>
                {line.summary && <>{' '}<span className="sum">· {line.summary}</span></>}
              </span>
            )}
            {row.done && <span className="tag"><Icon name="check" size={14} />Done</span>}
            <span className="ac"><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></span>
            <span className="age" title={fullTimestamp(row.received_at, timeZone)}>{item.aged ? age(row.received_at, now, timeZone) : clockTime(row.received_at, timeZone)}</span>
            {/* On the Pinned shelf, Unpin takes the age's place under the pointer (board 10). */}
            {item.shelf && <span className="hact"><button className="unpin" type="button" onClick={unpin}><Icon name="keep_off" size={15} />Unpin</button></span>}
          </div>
        );
      })}
      {loading}
      {more && <AllSkeleton more />}
    </section>
  );
}

/** The unread gutter: its dot, or while a row beats, Done's check or Trash's bin in its place. */
export function Gutter({beat}: {beat: Beat | null}) {
  return <span className="ud">{beat && <Icon name={beat === 'done' ? 'check' : 'delete'} size={14} />}</span>;
}

/** A code row: the code in two groups of three, Copy (the code without its space), and its countdown. */
function CodeLine({code}: {code: {value: string; expires_at: string}}) {
  const countdown = useCountdown(code.expires_at);
  return (
    <span className="subj code-line">
      <span className="code">{codeGroups(code.value)}</span>
      <CodeCopy value={code.value} />
      <span className={countdown.soon ? 'sum soon' : 'sum'}>{countdown.text}</span>
    </span>
  );
}

/** The pattern prompt: one card line at the end of New's Attention (board 09), never for protected mail. */
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
 * The rows that turned Done while the list showed them, so each ticks once, in place; a row already
 * Done when it first showed doesn't, and Undo takes the tick away with the Done.
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

/**
 * The reading pane opening or closing shows or hides the kinds' subheadings (#237), which would move
 * every row under them; the list scrolls by as much, so the email opened, or the one just closed,
 * stays where it was. On the phone they always show, and nothing moves. The open row's place is
 * noted after every render and scroll: the list takes the ref, and calls the note on scroll.
 */
function useKeptRow(openId: number | null): [RefObject<HTMLElement | null>, () => void] {
  const list = useRef<HTMLElement>(null);
  const kept = useRef<{id: number | null; top: number; headed: boolean}>({id: null, top: 0, headed: false});
  const rowOf = (id: number | null) => (id === null ? null : list.current?.querySelector<HTMLElement>(`.row[data-id="${id}"]`) ?? null);
  const topOf = (row: HTMLElement) => row.getBoundingClientRect().top - list.current!.getBoundingClientRect().top;
  const headed = () => (list.current?.querySelector('.kh')?.getClientRects().length ?? 0) > 0;
  const note = () => {
    const row = rowOf(openId);
    kept.current = {id: openId, top: row ? topOf(row) : 0, headed: headed()};
  };
  useLayoutEffect(() => {
    const scroller = list.current;
    const was = kept.current;
    if (scroller && headed() !== was.headed) {
      const row = rowOf(openId ?? was.id);
      // Opened: the subheadings above its row came in. Closed: they went, so it's back by its noted place.
      if (row && openId !== null) {
        const above = [...scroller.querySelectorAll<HTMLElement>('.kh')].filter(kh => kh.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
        scroller.scrollTop += above.reduce((sum, kh) => sum + kh.offsetHeight, 0);
      } else if (row) {
        scroller.scrollTop += topOf(row) - was.top;
      }
    }
    note();
  });
  return [list, note];
}
