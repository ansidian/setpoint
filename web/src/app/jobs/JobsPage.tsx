// The Jobs page (DESIGN.md › Jobs; boards 32, 32b, 33, 36a, 36b, 40): the header (Jobs, the status
// filter with its counts, Per week, Search jobs `/`), Needs you above the table (read-only until J6),
// the table and the application's detail where the reading pane sits. Search (`/` or a click) turns the
// header into Search: its results replace the table's rows as the user types, company or role first,
// then a match only in a JD's text with its line; Needs you folds away while a query is in.
//
// Keys: `J` / `K` move through Needs you's items and then the table's rows (with an application open,
// they open the next and previous one); Enter opens; `O` opens the posting; `/` searches; Esc folds an
// unfolded posting, then closes the detail (in a narrow window, Back), then clears the query, then
// leaves search. `4` is the shell's (App.tsx).
//
// Live: a `jobs` event refreshes what's on screen (logic/live.ts). An application that lands takes its
// place by the sort and settles from `sub2` over 900 ms; a row an email moves on crossfades its status
// and settles the same way. In a filtered view a row stays put until the next visit.
import type {ApplicationRowOut, JobsPageOut, JobsSearchOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {timeZone as userZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {localDate} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {motion, news as arrivals} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {echoKey, isTyping, plainKey} from '../../ui/keys.ts';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {useCompact} from '../Phone.tsx';
import {navigate} from '../router.ts';
import {Bar, LoadFailed, Sk, useLoadFailed} from '../states/Loading.tsx';
import {applicationPath, JOBS_PATH, searchPath} from './api.ts';
import {Detail} from './Detail.tsx';
import type {FullPostingHandle} from './FullPosting.tsx';
import {needKey, NeedsYou} from './NeedsYou.tsx';
import {PerWeek} from './PerWeek.tsx';
import {StatusFilter} from './StatusFilter.tsx';
import {HeaderRow, rowKey, Rows} from './Table.tsx';
import {DEFAULT_SORT, sortRows, tabTitle} from './words.ts';
import type {Filter, Sort} from './words.ts';
import './jobs.css';

type JobsRoute = Extract<Route, {page: 'jobs'}>;

const matches = (row: ApplicationRowOut, filter: Filter) => filter === 'all' || row.status === filter;

/** What changed between two answers: the applications that landed, and those an email moved on. */
function changes(before: JobsPageOut | undefined, after: JobsPageOut): {landed: number[]; moved: number[]} {
  if (!before) return {landed: [], moved: []};
  const was = new Map(before.rows.map(row => [row.id, row]));
  const landed: number[] = [];
  const moved: number[] = [];
  for (const row of after.rows) {
    const old = was.get(row.id);
    if (!old) landed.push(row.id);
    else if (old.status !== row.status || old.step !== row.step) moved.push(row.id);
  }
  return {landed, moved};
}

export function JobsPage({route}: {route: JobsRoute}) {
  const now = useNow();
  const zone = userZone();
  const today = localDate(now, zone);
  const compact = useCompact();
  const {byId: accounts} = useAccounts();
  const load = {path: JOBS_PATH, ...useResource<JobsPageOut>(JOBS_PATH)};
  const page = load.data;
  const failed = useLoadFailed([load]);

  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [cursor, setCursor] = useState<string | null>(null);

  // Search (36a, 36b): its own state, never mail's (D316).
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const q = searching ? query.trim() : '';
  const {data: answer} = useResource<JobsSearchOut>(q ? searchPath(q) : null);
  // The results as last answered for a query, so typing never blanks them between answers.
  const [found, setFound] = useState<JobsSearchOut | null>(null);
  if (answer && answer !== found && answer.query === q) setFound(answer);
  const results = q && found ? found : null;
  const field = useRef<HTMLInputElement>(null);
  // Where the table stood when search began, to come back to (36a: "at their scroll").
  const scroller = useRef<HTMLDivElement>(null);
  const tableScroll = useRef(0);
  const enterSearch = () => {
    if (!searching) tableScroll.current = scroller.current?.scrollTop ?? 0;
    setSearching(true);
    field.current?.focus();
    field.current?.select();
  };
  // Turned on from the glass alone (a narrow header), the field shows first, then takes focus.
  useEffect(() => {
    if (searching && document.activeElement !== field.current) field.current?.focus();
  }, [searching]);
  const leaveSearch = () => {
    setSearching(false);
    setQuery('');
    setFound(null);
    field.current?.blur();
    requestAnimationFrame(() => scroller.current?.scrollTo({top: tableScroll.current}));
  };

  // Arrivals and moves (#131, 38a), from one answer to the next.
  const [seen, setSeen] = useState<{page: JobsPageOut | undefined; landed: Set<number>; moved: Set<number>}>({page, landed: new Set(), moved: new Set()});
  if (page && page !== seen.page) {
    const {landed, moved} = changes(seen.page, page);
    setSeen({page, landed: landed.length ? new Set(landed) : seen.landed, moved: moved.length ? new Set(moved) : seen.moved});
  }
  useEffect(() => {
    if (!seen.landed.size && !seen.moved.size) return;
    const timer = window.setTimeout(() => setSeen(current => ({...current, landed: new Set(), moved: new Set()})), arrivals.landedMs);
    return () => window.clearTimeout(timer);
  }, [seen.landed, seen.moved]);

  // A filtered view holds its rows for the visit: one an email moves out of the filter stays put.
  const rows = useMemo(() => page?.rows ?? [], [page]);
  const [hold, setHold] = useState<{filter: Filter; ids: ReadonlySet<number>}>({filter: 'all', ids: new Set()});
  const held = hold.filter === filter ? hold.ids : new Set<number>();
  const filtered = rows.filter(row => matches(row, filter) || held.has(row.id));
  if (filter !== 'all' && (hold.filter !== filter || filtered.some(row => !held.has(row.id)))) setHold({filter, ids: new Set(filtered.map(row => row.id))});
  const table = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  // What J / K move through: Needs you's items, then the rows; in search, its results in order.
  const corRows = useMemo(() => (results ? sortRows(results.company_or_role, sort) : []), [results, sort]);
  const jdRows = useMemo(() => (results ? sortRows(results.in_jd.map(each => each.row), sort) : []), [results, sort]);
  const lines = useMemo(() => new Map(results?.in_jd.map(each => [each.row.id, each.line]) ?? []), [results]);
  const shownRows = results ? [...corRows, ...jdRows] : table;
  const needs = !q && page ? page.needs_you : [];
  const keys = [...needs.map(item => needKey(item.id)), ...shownRows.map(row => rowKey(row.id))];

  const open = route.open;
  const openRow = open === null ? undefined : shownRows.find(row => row.id === open) ?? rows.find(row => row.id === open);
  const {data: detail} = useResource<{id: number; title: string; company: string}>(open === null ? null : applicationPath(open));
  const titled = openRow ?? (detail?.id === open ? detail : undefined);
  useEffect(() => {
    document.title = tabTitle(open === null ? null : titled ?? null);
  }, [open, titled]);

  // Closing: the content fades over 120 ms (in a narrow window it slides off over 180), then the pane goes.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const go = (id: number | null) => {
    window.clearTimeout(leaveTimer.current);
    setLeaving(false);
    navigate({page: 'jobs', open: id});
  };
  const openAt = (id: number) => {
    setCursor(rowKey(id));
    go(id);
  };
  const close = () => {
    if (open === null || leaving) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => go(null), compact ? motion.medium : motion.fast);
  };
  const onRowClick = (id: number) => (id === open ? close() : openAt(id));
  const rowIds = shownRows.map(row => row.id);
  const neighbour = (delta: 1 | -1) => {
    if (open === null) return null;
    const at = rowIds.indexOf(open);
    return at === -1 ? (rowIds[0] ?? null) : rowIds[at + delta] ?? null;
  };
  const scrollTo = (key: string) => requestAnimationFrame(() => scroller.current?.querySelector(`[data-key="${key}"]`)?.scrollIntoView({block: 'nearest'}));
  const step = (delta: 1 | -1) => {
    const next = neighbour(delta);
    if (next === null) return;
    openAt(next);
    scrollTo(rowKey(next));
  };
  const posting = useRef<FullPostingHandle>(null);
  const postingLink = () => document.querySelector<HTMLAnchorElement>('.jb-pane .rd-tools a[data-hint="o"]')?.href ?? null;

  // Attached again with each render, before any key can come (as News's are).
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        enterSearch();
        return;
      }
      if (isTyping(event) || event.defaultPrevented) return;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const move = (delta: 1 | -1) => run(() => {
        if (open !== null) return step(delta);
        const at = cursor === null ? -1 : keys.indexOf(cursor);
        const next = keys[at === -1 ? (delta === 1 ? 0 : keys.length - 1) : Math.min(keys.length - 1, Math.max(0, at + delta))] ?? null;
        setCursor(next);
        if (next) scrollTo(next);
      });
      if (plainKey(event, 'j')) move(1);
      else if (plainKey(event, 'k')) move(-1);
      else if (plainKey(event, 'Enter') && cursor?.startsWith('r:') && keys.includes(cursor)) run(() => openAt(Number(cursor.slice(2))));
      else if (plainKey(event, '/')) run(enterSearch);
      else if (plainKey(event, 'o') && open !== null) {
        const link = postingLink();
        if (link) {
          echoKey('o');
          run(() => window.open(link, '_blank', 'noopener'));
        }
      } else if (plainKey(event, 'Escape')) {
        if (posting.current?.escape()) run(() => {});
        else if (open !== null) run(close);
        else if (searching && query) run(() => setQuery(''));
        else if (searching) run(leaveSearch);
        else if (cursor !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const onPoint = (key: string) => key !== cursor && setCursor(key);
  const rowState = (row: ApplicationRowOut) => ({
    cursor: cursor === rowKey(row.id), open: open === row.id, landed: seen.landed.has(row.id) || seen.moved.has(row.id), moved: seen.moved.has(row.id),
  });
  const rowProps = {rowState, besideDetail: open !== null, query: q || null, now, timeZone: zone, today, onPoint, onClick: onRowClick};
  const enabled = page?.enabled ?? true;

  return (
    <>
      <header className="hd jb-hd">
        <h1 className="hd-title" key={searching ? 'search' : 'jobs'}>{searching ? 'Search' : 'Jobs'}</h1>
        {!searching && page?.enabled && <StatusFilter counts={page.counts} value={filter} onChange={setFilter} />}
        <span className="grow" />
        {!searching && page?.enabled && <PerWeek weeks={page.weeks} today={today} />}
        {enabled && (
          <label className={searching ? 'search active' : 'search'} onClick={() => !searching && enterSearch()}>
            <span className="glass"><Icon name="search" size={16} /></span>
            <input ref={field} className="grow" placeholder="Search jobs" aria-label="Search jobs" value={query}
              onFocus={enterSearch} onChange={event => setQuery(event.target.value)}
              onBlur={() => {
                if (!query.trim()) leaveSearch();
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  if (query) setQuery('');
                  else leaveSearch();
                } else if (event.key === 'Enter' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  field.current?.blur();
                  const first = shownRows[0];
                  if (first) setCursor(rowKey(first.id));
                }
              }} />
            <span className="kbd">{searching ? 'Esc' : '/'}</span>
          </label>
        )}
      </header>
      <div className="content">
        <section className="jb-col" aria-label={q ? `Applications matching ${q}` : 'Applications'}>
          {!page ? (failed ? <LoadFailed what="Jobs" loads={[load]} /> : <TableSkeleton />) : !page.enabled ? <div className="jb-empty" /> : (
            <div className="jb-scroll jb-tbl" ref={scroller}>
              <NeedsYou items={page.needs_you} history={page.from_history} accounts={accounts} cursor={cursor} folded={Boolean(q)} now={now} timeZone={zone} onPoint={onPoint} />
              <HeaderRow sort={sort} first={!page.needs_you.length && !page.from_history.length || Boolean(q)} onSort={setSort} />
              {results ? (
                <>
                  {corRows.length > 0 ? (
                    <div className="gh sr"><Icon name="business" size={14} />Company or role <span className="n">{corRows.length}</span></div>
                  ) : (
                    <div className="jb-none"><Icon name="search_off" size={16} /><span>{jdRows.length ? `No company or role matches “${q}”` : `No application matches “${q}”`}</span></div>
                  )}
                  <Rows rows={corRows} {...rowProps} />
                  {jdRows.length > 0 && <div className={corRows.length ? 'gh' : 'gh sr'}><Icon name="description" size={14} />In a job description <span className="n">{jdRows.length}</span></div>}
                  <Rows rows={jdRows} lines={lines} {...rowProps} />
                </>
              ) : <Rows rows={table} {...rowProps} />}
            </div>
          )}
        </section>
        {open !== null && (
          <Detail id={open} row={openRow} accounts={accounts} now={now} timeZone={zone} today={today} leaving={leaving}
            canStep={{previous: neighbour(-1) !== null, next: neighbour(1) !== null}} onStep={step} onClose={close} onOpen={openAt}
            onEmail={messageId => navigate({page: 'inbox', account: null, open: messageId})} postingRef={posting} />
        )}
      </div>
    </>
  );
}

/** Until the page's first answer: the table's header and rows in their shapes (#225). */
function TableSkeleton() {
  const widths = [118, 96, 132, 104, 88, 124, 110, 92, 128, 100];
  return (
    <Sk kind="jobs" className="sk-list jb-tbl">
      {widths.map((w, index) => (
        <div key={index} className="jb-tr">
          <span /><Bar w={w} /><Bar w={`${40 + (index * 7) % 30}%`} /><Bar w={44} /><Bar w={36} /><Bar w={90} /><Bar w={18} />
        </div>
      ))}
    </Sk>
  );
}
