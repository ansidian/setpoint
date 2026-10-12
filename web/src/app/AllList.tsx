// All (DESIGN.md › All; board 05): every email, Noise included, newest first, under day headings,
// with clock times. Each day groups its rows by lane, the kind once in a left column where an FYI run
// starts, and folds its Noise to one line that opens in place (#48). Pinned email sits on Unread's
// Pinned shelf above the days, with ages and Unpin under the pointer, and leaves its day meanwhile (D105).
// Pages load as the list nears its end. What shows comes from logic/all.ts; actions are the page's.
// A trashed row folds out and Undo folds it back in, as in Unread (app/fold.ts).
import type {AccountOut, InboxGroup, MessageRowOut} from '@setpoint/shared';
import {useMemo} from 'react';
import type {MouseEvent, UIEvent} from 'react';
import {allRowLine, dayHeading, noiseKey} from '../logic/all.ts';
import type {AllLane, DayView} from '../logic/all.ts';
import type {Entry, Folded, FoldRules} from '../logic/fold.ts';
import {age, clockTime, fullTimestamp, localDate} from '../logic/format.ts';
import {GROUP_GLYPHS, GROUP_LABELS, groupKey, rowKey, showsPending} from '../logic/inbox.ts';
import {Icon} from '../ui/Icon.tsx';
import {dotStyle} from './accounts.ts';
import {beats, FOLD_HOLD_MS, foldDelays, foldRef, useFold} from './fold.ts';
import {Gutter} from './MailList.tsx';

// A row's `noise` is the day whose Noise it's under, folded or not.
type Part = {kind: 'shelf'; count: number} | {kind: 'day'; date: string} | {kind: 'lane'; lane: AllLane; label: string; count: number}
  | {kind: 'noise'; date: string; count: number; preview: string; open: boolean} | {kind: 'row'; row: MessageRowOut; group: InboxGroup | null; shelf: boolean; noise: string | null};
// Every row folds, and a day's Noise opens like a drawer, its rows folding in (inbox-14).
const RULES: FoldRules<Part> = {
  folds: () => true,
  arrives: () => true,
  opens: (entry, was) => {
    const noise = entry.item.kind === 'row' ? entry.item.noise : null;
    const line = noise === null ? undefined : was(noiseKey(noise))?.item;
    return line?.kind === 'noise' && !line.open;
  },
};
// A row's run, for staggering rows that fold together: its day's lane, or its day's Noise.
const runOf = (entry: Folded<Part>) => (entry.item.kind !== 'row' ? null : entry.item.shelf ? 'shelf' : entry.item.noise ? `noise:${entry.item.noise}` : `day:${entry.item.group ?? ''}`);

export function AllList({days, shelf, cursor, openId, accounts, now, timeZone, onPoint, onOpen, onToggleNoise, onNearEnd, onUnpin}: {
  days: DayView[];
  // The Pinned shelf's rows, newest pin first.
  shelf: MessageRowOut[];
  cursor: string | null;
  openId: number | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  onPoint: (key: string) => void;
  onOpen: (id: number, key: string) => void;
  onToggleNoise: (date: string) => void;
  onNearEnd: () => void;
  onUnpin: (id: number) => void;
}) {
  const today = localDate(now, timeZone);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const list = event.currentTarget;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 600) onNearEnd();
  };
  const rowEntry = (row: MessageRowOut, group: InboxGroup | null, noise: string | null = null): Entry<Part> => ({key: `all:${row.id}`, id: row.id, item: {kind: 'row', row, group, shelf: false, noise}});
  const entries = useMemo(() => [
    ...(shelf.length ? [
      {key: groupKey('pinned'), id: null, item: {kind: 'shelf', count: shelf.length}} satisfies Entry<Part>,
      ...shelf.map((row): Entry<Part> => ({key: rowKey('pinned', row.id), id: row.id, item: {kind: 'row', row, group: null, shelf: true, noise: null}})),
    ] : []),
    ...days.flatMap((day): Entry<Part>[] => [
    {key: `day:${day.date}`, id: null, item: {kind: 'day', date: day.date}},
    ...day.lanes.flatMap(lane => [
      {key: `lane:${day.date}:${lane.lane}`, id: null, item: {kind: 'lane', lane: lane.lane, label: lane.label, count: lane.rows.length}} satisfies Entry<Part>,
      ...lane.rows.map(({row, kind}) => rowEntry(row, kind)),
    ]),
    ...(day.noise ? [
      {key: noiseKey(day.date), id: null, item: {kind: 'noise', date: day.date, count: day.noise.count, preview: day.noise.preview, open: day.noise.open}} satisfies Entry<Part>,
      ...day.noise.rows.map(row => rowEntry(row, null, day.date)),
    ] : []),
    ]),
  ], [days, shelf]);
  const shown = useFold(entries, RULES, FOLD_HOLD_MS);
  // A row Trash took beats first; rows folding together start one after another.
  const delays = foldDelays(shown, runOf);
  return (
    <section className="list all" aria-label="All mail" onScroll={onScroll}>
      {shown.map(({key, id, item, fold}, index) => {
        const ref = foldRef(fold, delays.get(key));
        const leaving = fold === 'out';
        const beat = leaving && id !== null ? beats.get(id) ?? null : null;
        if (item.kind === 'shelf') {
          return (
            <div key={key} ref={ref} className={['gh', index === 0 && 'first', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              <span className="gi"><Icon name={GROUP_GLYPHS.pinned} size={14} /></span>{GROUP_LABELS.pinned} <span className="n">{item.count}</span>
            </div>
          );
        }
        if (item.kind === 'day') {
          const heading = dayHeading(item.date, today);
          return <div key={key} ref={ref} className={['gh', index === 0 && 'first', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>{heading.label} <span className="date">{heading.date}</span></div>;
        }
        if (item.kind === 'lane') {
          return <div key={key} ref={ref} className={['lh', item.lane === 'attention' && 'att', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>{item.label} <span className="n">{item.count}</span></div>;
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
        const {row} = item;
        const line = allRowLine(row);
        const account = accounts.get(row.account_id);
        const classes = ['row', item.shelf && 'shelf', row.unread && 'unread', !leaving && cursor === key && 'cur', !leaving && openId === row.id && 'open', showsPending(row) && 'pending', leaving && 'leaving', beat && `beat-${beat}`]
          .filter(Boolean).join(' ');
        const unpin = (event: MouseEvent) => {
          event.stopPropagation();
          onUnpin(row.id);
        };
        return (
          <div key={key} ref={ref} className={classes} title={line.title ?? undefined} data-key={leaving ? undefined : key} data-id={row.id} aria-hidden={leaving || undefined}
            onMouseMove={leaving ? undefined : () => key !== cursor && onPoint(key)} onClick={leaving ? undefined : () => onOpen(row.id, key)}>
            <span className="kd">{item.group && <><Icon name={GROUP_GLYPHS[item.group]} size={13} /><span className="ell">{GROUP_LABELS[item.group]}</span></>}</span>
            <Gutter beat={beat} />
            <span className="from">{line.from}</span>
            <span className="subj">
              <b className={line.alert ? 'alertsubj' : undefined}>
                {line.code ? <>{line.code.before}<span className="code">{line.code.value}</span>{line.code.after}</> : line.subject}
              </b>
              {line.summary && <>{' '}<span className="sum">· {line.summary}</span></>}
            </span>
            <span className="ac"><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></span>
            <span className="age" title={fullTimestamp(row.received_at, timeZone)}>{item.shelf ? age(row.received_at, now, timeZone) : clockTime(row.received_at, timeZone)}</span>
            {/* On the Pinned shelf, Unpin takes the age's place under the pointer, as in Unread (board 10). */}
            {item.shelf && <span className="hact"><button className="unpin" type="button" onClick={unpin}><Icon name="keep_off" size={15} />Unpin</button></span>}
          </div>
        );
      })}
    </section>
  );
}
