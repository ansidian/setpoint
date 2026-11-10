// The Jobs table's column widths (SV-246, D508): kept by this browser (localStorage, as the reading
// pane's are), since how wide they should be depends on the screen. One place any row of the table
// reads them from, through the variables `.jb-col` carries.
import type {CSSProperties} from 'react';
import {useSyncExternalStore} from 'react';
import {columnWidth, START_WIDTHS, storedWidths} from '../../logic/jobColumns.ts';
import type {ColumnWidths, SizedColumn} from '../../logic/jobColumns.ts';

const KEY = 'setpoint.jobsColumns';

function stored(): ColumnWidths {
  try {
    return storedWidths(localStorage.getItem(KEY));
  } catch {
    return START_WIDTHS;
  }
}

let widths = stored();
const listeners = new Set<() => void>();

function keep(next: ColumnWidths) {
  widths = next;
  try {
    if (next === START_WIDTHS) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private windows may refuse; the widths still hold for this page.
  }
  listeners.forEach(listener => listener());
}

export function setColumnWidth(column: SizedColumn, width: number) {
  const next = columnWidth(column, width);
  if (next !== widths[column]) keep({...widths, [column]: next});
}

export const resetColumnWidths = () => keep(START_WIDTHS);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useColumnWidths = () => useSyncExternalStore(subscribe, () => widths);

/** The widths as the variables the wide layout's columns read (jobs.css); the narrow one ignores them. */
export const columnVars = (each: ColumnWidths) =>
  ({'--w-co': `${each.company}px`, '--w-ap': `${each.applied}px`, '--w-st': `${each.status}px`}) as CSSProperties;
