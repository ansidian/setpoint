// The table (DESIGN.md › The table; boards 32, 34a, 36a, 36b; D309, D314): a header row whose labels
// sort it (newest first by Applied, by default; a second click flips it), and a 36 px row per
// application, 54 when its status's note wraps (SV-141): company, role, Applied, the status with its
// mark and step, and how its JD was found as a glyph, named in its tip. They're the columns beside the
// detail, which is always there (SV-217). Closed and Ghosted rows step down a shade. Search's rows
// highlight what matched, and a match only in a JD's text adds the line it matched under its row. A row a correction takes away
// (Merge with…'s other, Not an application, Delete) folds out over 180 ms, and folds back on Undo; a
// right-click opens its actions at the pointer (#268).
import type {ApplicationRowOut} from '@setpoint/shared';
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from 'react';
import {useMemo, useRef, useState} from 'react';
import type {Entry, FoldRules} from '../../logic/fold.ts';
import {COLUMN, COLUMN_STEP, fitWidth, resizeTo} from '../../logic/jobColumns.ts';
import type {SizedColumn} from '../../logic/jobColumns.ts';
import {zoomOf} from '../calendar/geometry.ts';
import {setColumnWidth, useColumnWidths} from './columns.ts';
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

const COLUMNS: {key: SortKey; label: string; title?: string}[] = [
  {key: 'company', label: 'Company'},
  {key: 'role', label: 'Role'},
  {key: 'applied', label: 'Applied'},
  {key: 'status', label: 'Status'},
  {key: 'jd', label: 'JD', title: 'Job description'},
];

export function HeaderRow({sort, first, onSort, onMenu}: {sort: Sort; first: boolean; onSort: (sort: Sort) => void; onMenu?: (event: ReactMouseEvent<HTMLElement>) => void}) {
  return (
    <div className={first ? 'jb-th first' : 'jb-th'} onContextMenu={onMenu}>
      <span />
      {COLUMNS.map(column => {
        const on = sort.key === column.key;
        return (
          <button key={column.key} type="button" className={on ? 'h on' : 'h'} data-tip={column.title} data-column={column.key}
            data-sort={on ? (sort.down ? 'down' : 'up') : undefined} onClick={() => onSort(nextSort(sort, column.key))}>
            {column.label}{on && <Icon name={sort.down ? 'arrow_downward' : 'arrow_upward'} size={14} />}
          </button>
        );
      })}
      {EDGES.map(column => <ColumnEdge key={column} column={column} />)}
    </div>
  );
}

// The columns that size, with the cell each row draws them in. Company's edge is its right, against
// Role; Applied's and Status's are their left, since Role takes what's left and they sit to its right.
const EDGES: SizedColumn[] = ['company', 'applied', 'status'];
const CELL: Record<SizedColumn, string> = {company: '.co', applied: '.ap', status: '.st'};
const NAME: Record<SizedColumn, string> = {company: 'Company', applied: 'Applied', status: 'Status'};
const TRACK: Record<SizedColumn, number> = {company: 1, applied: 3, status: 4};
const ROLE_TRACK = 2;
// A heading's arrow (14 px after a 3 px gap) when it isn't the sorted one; and the 6 px of its button
// that sit out in the gap before its column.
const ARROW = 17;
const BLEED = 6;

/** The header row's columns as drawn, in the page's pixels: [gutter, Company, Role, Applied, Status, JD]. */
const tracks = (header: Element) => getComputedStyle(header).gridTemplateColumns.split(' ').map(parseFloat);

/**
 * The widest cell of `column` among the rows the table has, and its heading sorted; Status measured on
 * one line, as it would be with room (the note wraps only for want of it).
 */
function measure(header: HTMLElement, column: SizedColumn): {cells: number[]; heading: number} {
  const table = header.closest('.jb-tbl') ?? header.parentElement!;
  const button = header.querySelector<HTMLElement>(`.h[data-column="${column}"]`);
  const heading = button ? button.scrollWidth + (button.classList.contains('on') ? 0 : ARROW) - BLEED : 0;
  table.classList.add('measuring');
  const cells = [...table.querySelectorAll<HTMLElement>(`.jb-tr[data-application] > ${CELL[column]}`)].map(cell => cell.scrollWidth);
  table.classList.remove('measuring');
  return {cells, heading};
}

/**
 * A sizing column's edge in the header row, the reading pane's (PaneEdge): dragged, or ← → by 16 px
 * when focused, and its grip under the pointer. A double-click fits the column to its longest content
 * among the rows the table has, its heading and sort arrow included (D508). Widths go from what's
 * drawn, not what's kept, so a column the window has squeezed moves from where it is.
 */
function ColumnEdge({column}: {column: SizedColumn}) {
  const widths = useColumnWidths();
  const drag = useRef<{x: number; width: number; role: number; zoom: number} | null>(null);
  const [dragging, setDragging] = useState(false);
  // Away from Role widens it: right for Company, left for the two after Role.
  const sign = column === 'company' ? 1 : -1;
  const drawn = (edge: HTMLElement) => {
    const each = tracks(edge.parentElement!);
    return {width: each[TRACK[column]] ?? widths[column], role: each[ROLE_TRACK] ?? 0};
  };
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const {width, role} = drawn(event.currentTarget);
    const step = (event.key === 'ArrowRight' ? COLUMN_STEP : -COLUMN_STEP) * sign;
    setColumnWidth(column, resizeTo(column, width + step, width, role));
  };
  return (
    <div className={dragging ? `jb-edge ${column} dragging` : `jb-edge ${column}`} role="separator" aria-orientation="vertical"
      aria-label={`Resize the ${NAME[column]} column`} tabIndex={0} aria-valuenow={widths[column]} aria-valuemin={COLUMN[column].min}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const {width, role} = drawn(event.currentTarget);
        drag.current = {x: event.clientX, width, role, zoom: zoomOf(event.currentTarget)};
        setDragging(true);
      }}
      onPointerMove={event => {
        const at = drag.current;
        if (at) setColumnWidth(column, resizeTo(column, at.width + sign * Math.round((event.clientX - at.x) / at.zoom), at.width, at.role));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={event => {
        const header = event.currentTarget.parentElement!;
        const {cells, heading} = measure(header, column);
        const {width, role} = drawn(event.currentTarget);
        setColumnWidth(column, resizeTo(column, fitWidth(column, cells, heading), width, role));
      }}
      onKeyDown={onKey}>
      <span className="grip"><i /><i /><i /></span>
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

export function Row({row, state, query, line, now, timeZone, today, fold = null, onPoint, onClick, onMenu}: {
  row: ApplicationRowOut;
  state: RowState;
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
  const step = statusStep(row, today);
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
      <span className="co" data-tip={row.company}>{text(row.company)}</span>
      <span className={row.title.trim() ? 'ro' : 'ro none'} data-tip={titleOf(row)}>{row.title.trim() ? text(row.title) : titleOf(row)}</span>
      <span className="ap">{appliedWord(row.applied_on, today)}</span>
      <span className={mark === 'proc' ? 'st proc' : 'st'}>
        <i className={`sd ${mark}`} />
        <span className="st-t">
          <span className={`sl ${mark}`}>{markLabel(row)}</span>
          {step && <span className="step" data-tip={step}>· {step}</span>}
          {row.status_set_by === 'user' && <span className="by" role="img" aria-label={setByYou(row, today)} data-tip={setByYou(row, today)}><Icon name="edit" size={14} /></span>}
        </span>
      </span>
      <span className="jd" data-tip={jd?.title ?? jd?.text}>
        {jd && (jd.spin ? <span className="spin"><Icon name={jd.icon} size={16} /></span> : <Icon name={jd.icon} size={16} />)}
      </span>
      {line !== undefined && (
        <span className="snip" data-tip={line}><span className="lab">Full posting · </span>“{query ? <Marked parts={marks(line, query)} /> : line}”</span>
      )}
    </div>
  );
}

/** Rows in order, each with its state; `lines` holds a JD match's quoted line. */
export function Rows({rows, lines, rowState, ...rest}: {
  rows: ApplicationRowOut[];
  lines?: Map<number, string>;
  rowState: (row: ApplicationRowOut) => RowState;
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
