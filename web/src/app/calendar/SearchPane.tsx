// SV-23: calendar search's results in the right pane, in place of the day's agenda (DESIGN.md ›
// Decided while building #24): the one-line hint before typing; then the results line, Upcoming and
// Past, each row as the agenda draws it plus why it matched (`ink3`, matches highlighted); 50 at a
// time with Show more; and the no-results line with each chip removable. The rules are
// logic/search.ts's and the state is search/state.ts's; CalendarPage selects what's clicked.
import type {CalendarOut, CalendarSearchResultOut} from '@setpoint/shared';
import {Fragment} from 'react';
import type {CSSProperties} from 'react';
import {CALENDAR_SEARCH_HINT, calendarResultGroups, calendarResultLine, resultDay, resultsLine, segments, shownCalendarReasons} from '../../logic/search.ts';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {useRingColour} from './Chip.tsx';
import {Marked, NoResults} from '../search/Search.tsx';
import type {CalendarSearch} from '../search/state.ts';
import '../search/search.css';

interface SearchPaneProps {
  search: CalendarSearch;
  calendars: Map<number, CalendarOut>;
  selected: Set<string>;
  today: string;
  timeZone: string;
  onSelect: (result: CalendarSearchResultOut) => void;
}

export function SearchPane({search, calendars, selected, today, timeZone, onSelect}: SearchPaneProps) {
  const {out, results} = search;
  return (
    <section className="rpane cal-search" aria-label="Search results">
      <div className="rp-scroll">
        {!search.active && <div className="cs-hint">{CALENDAR_SEARCH_HINT}</div>}
        {search.error && <div className="bar muted failing">{search.error}</div>}
        {search.active && out && out.total > 0 && <div className="bar muted"><span className="num">{resultsLine(out).join(' · ')}</span></div>}
        {search.active && calendarResultGroups(results).map(group => (
          <Fragment key={group.heading}>
            <div className="ag-day">{group.heading}</div>
            {group.results.map(result => (
              <ResultRow key={result.item.key} result={result} calendar={calendars.get(result.item.calendar_id)} selected={selected.has(result.item.key)}
                today={today} timeZone={timeZone} onSelect={onSelect} />
            ))}
          </Fragment>
        ))}
        {search.active && out && out.next_offset !== null && <button className="cs-more" type="button" onClick={search.loadMore}>Show more</button>}
        {search.active && out && out.total === 0 && <NoResults lead="No events or tasks match" search={search} />}
      </div>
    </section>
  );
}

interface ResultRowProps {
  result: CalendarSearchResultOut;
  calendar: CalendarOut | undefined;
  selected: boolean;
  today: string;
  timeZone: string;
  onSelect: (result: CalendarSearchResultOut) => void;
}

function ResultRow({result, calendar, selected, today, timeZone, onSelect}: ResultRowProps) {
  const {item} = result;
  const ring = useRingColour();
  const {day, year} = resultDay(result.date, today);
  const task = item.kind === 'task';
  // One line, cut with an ellipsis and whole in its title, so the calendar never sits alone on a second.
  const line = calendarResultLine(result, calendar?.name, timeZone);
  const reasons = shownCalendarReasons(result);
  return (
    <a className={`ag-item cs-result${task ? ' ag-task' : ''}${task && item.done ? ' done' : ''}${selected ? ' sel' : ''}`} href="#" data-key={item.key}
      style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties}
      onClick={click => {
        click.preventDefault();
        onSelect(result);
      }}>
      <span className="when num">{day}{year && <span className="year">{year}</span>}</span>
      {task ? <span className="check">{item.done ? <TaskGlyph done size={15} /> : <span className="ring" style={ring(item.project)} />}</span> : <span className="cbar" />}
      <span className="grow">
        <span className="title"><Marked parts={segments(item.title, result.highlights)} /></span>
        <span className="ink3 num line ell" title={line}>{line}</span>
        {/* Only what the row doesn't already show (search-11). */}
        {reasons.length > 0 && (
          <span className="why">
            {reasons.map((reason, index) => (
              <Fragment key={`${reason.field}:${reason.value}`}>
                {index > 0 && <span>·</span>}
                <span>{reason.key} <b><Marked parts={segments(reason.value, reason.runs)} /></b></span>
              </Fragment>
            ))}
          </span>
        )}
      </span>
      {item.recurring && <span className="repeat"><Icon name="repeat" size={16} /></span>}
    </a>
  );
}
