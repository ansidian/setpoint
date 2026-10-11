// All (DESIGN.md › All; board 05): every email, Noise included, newest first, under day headings,
// with clock times. Each day groups its rows by lane, the kind once in a left column where an FYI run
// starts, and folds its Noise to one line that opens in place (#48). Pinned email sits on Unread's
// Pinned shelf above the days, with ages and Unpin under the pointer, and leaves its day meanwhile (D105).
// Pages load as the list nears its end. What shows comes from logic/all.ts; actions are the page's.
// A trashed row folds out and Undo folds it back in, as in Unread (app/fold.ts).
import type {AccountOut, MessageRowOut} from '@setpoint/shared';
import {useMemo} from 'react';
import type {MouseEvent, UIEvent} from 'react';
import {allRowLine, dayHeading, noiseKey} from '../logic/all.ts';
import type {AllLane, DayView} from '../logic/all.ts';
import type {Entry, FoldRules} from '../logic/fold.ts';
import {age, clockTime, fullTimestamp, localDate} from '../logic/format.ts';
import {groupKey, rowKey, showsPending} from '../logic/inbox.ts';
import {Icon} from '../ui/Icon.tsx';
import {dotStyle} from './accounts.ts';
import {foldIn, foldOut, useFold} from './fold.ts';

type Part = {kind: 'shelf'; count: number} | {kind: 'day'; date: string} | {kind: 'lane'; lane: AllLane; label: string; count: number}
  | {kind: 'noise'; date: string; count: number; preview: string; open: boolean} | {kind: 'row'; row: MessageRowOut; label: string | null; shelf: boolean};
const RULES: FoldRules<Part> = {folds: () => true, arrives: () => true};

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
  const rowEntry = (row: MessageRowOut, label: string | null): Entry<Part> => ({key: `all:${row.id}`, id: row.id, item: {kind: 'row', row, label, shelf: false}});
  const entries = useMemo(() => [
    ...(shelf.length ? [
      {key: groupKey('pinned'), id: null, item: {kind: 'shelf', count: shelf.length}} satisfies Entry<Part>,
      ...shelf.map((row): Entry<Part> => ({key: rowKey('pinned', row.id), id: row.id, item: {kind: 'row', row, label: null, shelf: true}})),
    ] : []),
    ...days.flatMap((day): Entry<Part>[] => [
    {key: `day:${day.date}`, id: null, item: {kind: 'day', date: day.date}},
    ...day.lanes.flatMap(lane => [
      {key: `lane:${day.date}:${lane.lane}`, id: null, item: {kind: 'lane', lane: lane.lane, label: lane.label, count: lane.rows.length}} satisfies Entry<Part>,
      ...lane.rows.map(({row, kind}) => rowEntry(row, kind)),
    ]),
    ...(day.noise ? [
      {key: noiseKey(day.date), id: null, item: {kind: 'noise', date: day.date, count: day.noise.count, preview: day.noise.preview, open: day.noise.open}} satisfies Entry<Part>,
      ...day.noise.rows.map(row => rowEntry(row, null)),
    ] : []),
    ]),
  ], [days, shelf]);
  const shown = useFold(entries, RULES);
  return (
    <section className="list all" aria-label="All mail" onScroll={onScroll}>
      {shown.map(({key, item, fold}, index) => {
        const ref = fold === 'out' ? foldOut : fold === 'in' ? foldIn : undefined;
        const leaving = fold === 'out';
        if (item.kind === 'shelf') {
          return (
            <div key={key} ref={ref} className={['gh', index === 0 && 'first', leaving && 'leaving'].filter(Boolean).join(' ')} aria-hidden={leaving || undefined}>
              <span className="keep"><Icon name="keep" size={16} /></span>Pinned <span className="n">{item.count}</span>
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
              <span className="chev"><Icon name={item.open ? 'expand_more' : 'chevron_right'} /></span>
            </div>
          );
        }
        const {row} = item;
        const line = allRowLine(row);
        const account = accounts.get(row.account_id);
        const classes = ['row', item.shelf && 'shelf', row.unread && 'unread', !leaving && cursor === key && 'cur', !leaving && openId === row.id && 'open', showsPending(row) && 'pending', leaving && 'leaving']
          .filter(Boolean).join(' ');
        const unpin = (event: MouseEvent) => {
          event.stopPropagation();
          onUnpin(row.id);
        };
        return (
          <div key={key} ref={ref} className={classes} title={line.title ?? undefined} data-key={leaving ? undefined : key} data-id={row.id} aria-hidden={leaving || undefined}
            onMouseMove={leaving ? undefined : () => key !== cursor && onPoint(key)} onClick={leaving ? undefined : () => onOpen(row.id, key)}>
            <span className="kd">{item.label}</span>
            <span className="ud" />
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
