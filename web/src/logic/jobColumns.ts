// The Jobs table's column widths (SV-246, D508): Company, Applied and Status are dragged by a
// heading's edge or fitted to their content; Role takes what's left, the gutter and JD stay put.
// Pure: the page measures, this decides.

export type SizedColumn = 'company' | 'applied' | 'status';
export type ColumnWidths = Record<SizedColumn, number>;

export const SIZED: readonly SizedColumn[] = ['company', 'applied', 'status'];

/**
 * Where each starts, and the narrowest it may go: its heading sorted, arrow and all, measured in the
 * browser (11.5 px caps at .08em, a 14 px arrow after a 3 px gap, 6 px of the button's padding).
 */
export const COLUMN = {
  company: {start: 156, min: 86},
  applied: {start: 80, min: 76},
  status: {start: 214, min: 70},
} as const satisfies Record<SizedColumn, {start: number; min: number}>;

/** Role's floor: a dragged or fitted column stops where Role would go narrower. */
export const ROLE_MIN = 120;
/** ← → on an edge. */
export const COLUMN_STEP = 16;
// How wide a fit may make one column, whatever its longest cell.
const MAX = 640;

export const START_WIDTHS: ColumnWidths = {company: COLUMN.company.start, applied: COLUMN.applied.start, status: COLUMN.status.start};

/** A width whole and inside its column's bounds; anything unreadable is its start. */
export function columnWidth(column: SizedColumn, width: unknown): number {
  const value = typeof width === 'number' ? width : typeof width === 'string' && width.trim() ? Number(width) : NaN;
  return Number.isFinite(value) ? Math.round(Math.min(MAX, Math.max(COLUMN[column].min, value))) : COLUMN[column].start;
}

/** The widths this browser kept (JSON), each read on its own; a missing or unreadable one starts. */
export function storedWidths(text: string | null): ColumnWidths {
  let kept: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) kept = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: every column starts.
  }
  return {company: columnWidth('company', kept.company), applied: columnWidth('applied', kept.applied), status: columnWidth('status', kept.status)};
}

/**
 * A column's next width, asked for while dragging, by a key or by a fit: inside its bounds, and no
 * wider than its width now plus what Role has over its floor (`roleWidth`, Role as drawn).
 */
export function resizeTo(column: SizedColumn, wanted: number, now: number, roleWidth: number): number {
  const most = Math.max(now, now + roleWidth - ROLE_MIN);
  return columnWidth(column, Math.min(wanted, most));
}

/**
 * The width that fits a column's longest content: its widest cell or its sorted heading, whichever is
 * wider, rounded up a pixel so a fraction doesn't cost an ellipsis.
 */
export function fitWidth(column: SizedColumn, cells: number[], heading: number): number {
  return columnWidth(column, Math.ceil(Math.max(heading, ...cells)) + 1);
}
