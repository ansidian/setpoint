// The status filter (DESIGN.md › Jobs › Shell; D314): the segmented control holding the counts by
// status, "All 62", "Applied 31", …, so a count is also the filter. Ghosted counts under Applied and has
// no segment. A segment never wraps; the fill slides to the one turned on (#179).
import type {JobCountsOut} from '@setpoint/shared';
import {segThumb} from '../../ui/seg.ts';
import {FILTERS, STATUS_LABELS} from './words.ts';
import type {Filter} from './words.ts';

export function StatusFilter({counts, value, onChange}: {counts: JobCountsOut; value: Filter; onChange: (next: Filter) => void}) {
  return (
    <span className="seg jb-status" ref={segThumb} role="group" aria-label="Status">
      {FILTERS.map(filter => (
        <button key={filter} type="button" className={filter === value ? 'on' : undefined} aria-pressed={filter === value} onClick={() => onChange(filter)}>
          {filter === 'all' ? 'All' : STATUS_LABELS[filter]}
          <span className="n">{filter === 'all' ? counts.all : counts.by_status[filter] ?? 0}</span>
        </button>
      ))}
    </span>
  );
}
