// The phone Agenda's search results (D792), in the agenda list's place while the header's field
// holds words: the results line, then Upcoming and Past, each row its day, its calendar's chip or
// its ring, its title with the matches marked, and under it the desktop's line and why it matched.
// 50 at a time with Show more, and the no-results line. Plain words only: no chips or marks. The
// rules are logic/search.ts's, as the desktop's SearchPane.
import type {CalendarOut, CalendarSearchResultOut} from '@setpoint/shared';
import {Fragment} from 'react';
import type {CSSProperties} from 'react';
import {calendarResultGroups, calendarResultLine, resultDay, resultsLine, segments, shownCalendarReasons} from '../../logic/search.ts';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {Marked, NoResults} from '../search/Search.tsx';
import type {CalendarSearch} from '../search/state.ts';
import {useRingColour} from './Chip.tsx';

export function AgendaSearch({search, calendars, selectedKey, today, timeZone, onSelect}: {
  search: CalendarSearch;
  calendars: Map<number, CalendarOut>;
  selectedKey: string | null;
  today: string;
  timeZone: string;
  onSelect: (result: CalendarSearchResultOut) => void;
}) {
  const {out, results} = search;
  const ring = useRingColour();
  return (
    <section className="ph-agenda ph-agenda-search" aria-label="Search results">
      {search.error && <div className="bar muted failing"><Icon name="warning" size={16} />{search.error}</div>}
      {out && out.total > 0 && <div className="ph-res-count num">{resultsLine(out).join(' · ')}</div>}
      {calendarResultGroups(results).map((group, index) => (
        <Fragment key={group.heading}>
          <div className={index === 0 ? 'pday first' : 'pday'}>{group.heading}</div>
          {group.results.map(result => {
            const {item} = result;
            const calendar = calendars.get(item.calendar_id);
            const {day, year} = resultDay(result.date, today);
            const task = item.kind === 'task';
            const line = calendarResultLine(result, calendar?.name, timeZone);
            const reasons = shownCalendarReasons(result);
            return (
              <a key={item.key} className={['pitem', 'ph-res', task && item.done && 'done', item.key === selectedKey && 'sel'].filter(Boolean).join(' ')} href="#" data-key={item.key}
                style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties}
                onClick={event => {
                  event.preventDefault();
                  onSelect(result);
                }}>
                <span className="when num">{day}{year && <span className="year"> {year}</span>}</span>
                <span className="mk">{task ? item.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)} /> : <span className="cbar" />}</span>
                <span className="ph-res-body">
                  <span className="ell ph-res-title"><Marked parts={segments(item.title, result.highlights)} /></span>
                  <span className="ell ph-res-line num">{line}</span>
                  {reasons.length > 0 && (
                    <span className="ell ph-res-why">
                      {reasons.map((reason, at) => (
                        <Fragment key={`${reason.field}:${reason.value}`}>
                          {at > 0 && ' · '}
                          {reason.key} <b><Marked parts={segments(reason.value, reason.runs)} /></b>
                        </Fragment>
                      ))}
                    </span>
                  )}
                </span>
              </a>
            );
          })}
        </Fragment>
      ))}
      {out && out.next_offset !== null && <button className="ph-res-more" type="button" onClick={search.loadMore}>Show more</button>}
      {out && out.total === 0 && <NoResults lead="No events or tasks match" search={search} />}
    </section>
  );
}
