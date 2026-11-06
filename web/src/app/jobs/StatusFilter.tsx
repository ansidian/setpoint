// The status filter (DESIGN.md › Jobs › Shell; D314): the segmented control holding the counts by
// status, "All 62", "Applied 31", …, so a count is also the filter. Ghosted counts under Applied and has
// no segment. A segment never wraps; the thumb slides to the one turned on, and Tab and Shift-Tab step
// them (#317).
import type {JobCountsOut} from '@setpoint/shared';
import {Segmented} from '../../ui/Segmented.tsx';
import {FILTERS, STATUS_LABELS} from './words.ts';
import type {Filter} from './words.ts';

export function StatusFilter({counts, value, onChange}: {counts: JobCountsOut; value: Filter; onChange: (next: Filter) => void}) {
  return (
    <Segmented className="jb-status" label="Status" value={value} onChange={onChange} onTab={onChange}
      segments={FILTERS.map(filter => ({value: filter, label: <>
        {filter === 'all' ? 'All' : STATUS_LABELS[filter]}
        <span className="n">{filter === 'all' ? counts.all : counts.by_status[filter] ?? 0}</span>
      </>}))} />
  );
}
