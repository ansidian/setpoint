// The table (DESIGN.md › The table; boards 32, 34a, 36a, 36b; D309, D314): a header row whose labels
// sort it (newest first by Applied, by default; a second click flips it), and a 36 px row per
// application: company, role, platform, Applied, the status with its mark and step, and how its JD
// was found. Closed and Ghosted rows step down a shade. Search's rows highlight what matched, and a
// match only in a JD's text adds the line it matched under its row. A row a correction takes away
// (Merge with…'s other, Not an application, Delete) folds out over 180 ms, and folds back on Undo; a
// right-click opens its actions at the pointer (#268).
import type {ApplicationRowOut} from '@setpoint/shared';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {useMemo} from 'react';
import type {Entry, FoldRules} from '../../logic/fold.ts';
import {Icon} from '../../ui/Icon.tsx';
import {foldIn, foldOut, useFold} from '../fold.ts';
import {Marked} from '../search/Search.tsx';
import {appliedWord, jdCell, markLabel, markOf, marks, nextSort, recedes, setByYou, statusStep, titleOf} from './words.ts';
import type {Sort, SortKey} from './words.ts';

export const rowKey = (id: number) => `r:${id}`;

/**
 * The applications a correction is taking away just now, so their rows fold out rather than vanish;
 * set by the page as it sends one, and cleared if it's refused. Rows leaving for any other reason (a
 * filter, a search) simply go.
 */
export const takenAway = new Set<number>();

const ROW_FOLDS: FoldRules<ApplicationRowOut> = {folds: entry => entry.id !== null && takenAway.has(entry.id), arrives: () => true};

const COLUMNS: {key: SortKey; label: string; className?: string; title?: string}[] = [
  {key: 'company', label: 'Company'},
  {key: 'role', label: 'Role'},
  {key: 'platform', label: 'Platform', className: 'c-plat'},
  {key: 'applied', label: 'Applied'},
  {key: 'status', label: 'Status'},
  {key: 'jd', label: 'JD', title: 'Job description'},
];

export function HeaderRow({sort, first, onSort}: {sort: Sort; first: boolean; onSort: (sort: Sort) => void}) {
  return (
    <div className={first ? 'jb-th first' : 'jb-th'}>
      <span />
      {COLUMNS.map(column => {
        const on = sort.key === column.key;
        return (
          <button key={column.key} type="button" className={['h', on && 'on', column.className].filter(Boolean).join(' ')} title={column.title}
            data-sort={on ? (sort.down ? 'down' : 'up') : undefined} onClick={() => onSort(nextSort(sort, column.key))}>
            {column.label}{on && <Icon name={sort.down ? 'arrow_downward' : 'arrow_upward'} size={14} />}
          </button>
        );
      })}
    </div>
  );
}

export interface RowState {
  cursor: boolean;
  open: boolean;
  // Landed (an arrival) or moved on by an email: it settles from sub2 (#131, 38a).
  landed: boolean;
  moved: boolean;
}

export function Row({row, state, besideDetail, query, line, now, timeZone, today, fold = null, onPoint, onClick, onMenu}: {
  row: ApplicationRowOut;
  state: RowState;
  besideDetail: boolean;
  // Search's query, to highlight what it matched; and the JD line a match only there quotes.
  query: string | null;
  line?: string;
  now: number;
  timeZone: string;
  today: string;
  fold?: 'in' | 'out' | null;
  onPoint: (key: string) => void;
  onClick: (id: number) => void;
  onMenu?: (row: ApplicationRowOut, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const key = rowKey(row.id);
  const leaving = fold === 'out';
  const mark = markOf(row);
  const step = statusStep(row, besideDetail, today);
  const jd = jdCell(row.jd, now, timeZone);
  const text = (value: string) => (query ? <Marked parts={marks(value, query)} /> : value);
  const classes = ['jb-tr', line !== undefined && 'two', recedes(row) && 'recedes', state.cursor && 'cur', state.open && 'open', state.landed && 'landed', state.moved && 'moved']
    .filter(Boolean).join(' ');
  return (
    <div ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={leaving ? `${classes} leaving` : classes} data-key={leaving ? undefined : key}
      data-application={leaving ? undefined : row.id} aria-hidden={leaving || undefined}
      onMouseMove={() => !leaving && !state.cursor && onPoint(key)} onClick={() => !leaving && onClick(row.id)}
      onContextMenu={leaving || !onMenu ? undefined : event => onMenu(row, event)}>
      <span />
      <span className="co" title={row.company}>{text(row.company)}</span>
      <span className={row.title.trim() ? 'ro' : 'ro none'} title={titleOf(row)}>{row.title.trim() ? text(row.title) : titleOf(row)}</span>
      <span className="pl c-plat">{row.platform ?? ''}</span>
      <span className="ap">{appliedWord(row.applied_on, today)}</span>
      <span className={mark === 'proc' ? 'st proc' : 'st'}>
        <i className={`sd ${mark}`} />
        <span className={`sl ${mark}`}>{markLabel(row)}</span>
        {step && <span className="step" title={step}>· {step}</span>}
        {row.status_set_by === 'user' && <span className="by" title={setByYou(row, today)}><Icon name="edit" size={14} /></span>}
      </span>
      <span className="jd" title={jd?.title}>
        {jd && (jd.spin ? <span className="spin"><Icon name={jd.icon} size={16} /></span> : <Icon name={jd.icon} size={16} />)}
        {jd && <span className="t">{jd.text}</span>}
      </span>
      {line !== undefined && (
        <span className="snip" title={line}><span className="lab">Full posting · </span>“{query ? <Marked parts={marks(line, query)} /> : line}”</span>
      )}
    </div>
  );
}

/** Rows in order, each with its state; `lines` holds a JD match's quoted line. */
export function Rows({rows, lines, rowState, ...rest}: {
  rows: ApplicationRowOut[];
  lines?: Map<number, string>;
  rowState: (row: ApplicationRowOut) => RowState;
  besideDetail: boolean;
  query: string | null;
  now: number;
  timeZone: string;
  today: string;
  onPoint: (key: string) => void;
  onClick: (id: number) => void;
  onMenu?: (row: ApplicationRowOut, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const entries = useMemo(() => rows.map((row): Entry<ApplicationRowOut> => ({key: rowKey(row.id), id: row.id, item: row})), [rows]);
  const shown = useFold(entries, ROW_FOLDS);
  return <>{shown.map(({key, item: row, fold}) => <Row key={key} row={row} state={rowState(row)} line={lines?.get(row.id)} fold={fold} {...rest} />)}</>;
}
