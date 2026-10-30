// The Jobs page (DESIGN.md › Jobs; boards 32, 32b, 33, 36a, 36b, 40): the header (Jobs, the status
// filter with its counts, Per week, Search jobs `/`), Needs you above the table (read-only until J6),
// the table and the application's detail where the reading pane sits. Search (`/` or a click) turns the
// header into Search: its results replace the table's rows as the user types, company or role first,
// then a match only in a JD's text with its line; Needs you folds away while a query is in.
//
// J6: Needs you's answers and the corrections, each with its toast and Undo (act.ts); a row's
// right-click opens its actions at the pointer (#268), and More's Edit company and Edit title (or the
// right-click's) open the application with that field in edit.
//
// Keys: `J` / `K` move through Needs you's items and then the table's rows (with an application open,
// they open the next and previous one); Enter opens; `O` opens the posting; `/` searches; Esc folds an
// unfolded posting, then closes the detail (in a narrow window, Back), then clears the query, then
// leaves search. `4` is the shell's (App.tsx).
//
// J8's states (States.tsx; 38a–38c): the AI down and the history pass's lines at the top of the column,
// three skeleton rows holding the table's top while the pass runs, and Jobs off's one line, its header
// "Jobs" alone. Settings › Jobs's Show arrives at /jobs/from-history, From history unfolded.
//
// From mail (J7): an application open as the page mounts (Open in Jobs, Full posting, a reload)
// arrives with its pane simply there, no slide; /jobs/12/posting arrives scrolled to its full posting
// and unfolded (#271); /jobs?q=… arrives searched, the query in the field (Applied before). The
// address then drops what it carried, so a reload or Back doesn't do it again.
//
// Live: a `jobs` event refreshes what's on screen (logic/live.ts). An application that lands takes its
// place by the sort and settles from `sub2` over 900 ms; a row an email moves on crossfades its status
// and settles the same way. In a filtered view a row stays put until the next visit.
import type {ApplicationOut, ApplicationRowOut, JdCandidateOut, JobEventOut, JobsPageOut, JobsSearchOut} from '@setpoint/shared';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {timeZone as userZone} from '../../api/auth.ts';
import {updateCached, useResource} from '../../api/client.ts';
import {localDate} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {motion, news as arrivals} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {echoKey, isTyping, plainKey} from '../../ui/keys.ts';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {useCompact} from '../Phone.tsx';
import {navigate} from '../router.ts';
import {copyText, takesContextMenu} from '../ContextMenu.tsx';
import {Bar, LoadFailed, Sk, useLoadFailed} from '../states/Loading.tsx';
import {showToast, toastFailure} from '../toast.ts';
import {act} from './act.ts';
import {
  applicationPath, deleteApplication, editApplication, JOBS_PATH, lookUp, mergeWith, moveEvent, noneOfThese, notAboutThis, notAnApplication, notThisPosting,
  pickCandidate, searchPath, setStatus,
} from './api.ts';
import {JobsMenu} from './Menu.tsx';
import type {MenuAnchor, MenuSpec} from './Menu.tsx';
import {rowMenu} from './menus.ts';
import type {CorrectionActions} from './menus.ts';
import {Detail} from './Detail.tsx';
import type {FullPostingHandle} from './FullPosting.tsx';
import {needKey, NeedsYou} from './NeedsYou.tsx';
import {PerWeek} from './PerWeek.tsx';
import {StatusFilter} from './StatusFilter.tsx';
import {HistorySkeleton, JobsLines, JobsOff} from './States.tsx';
import {HeaderRow, rowKey, Rows, takenAway} from './Table.tsx';
import {DEFAULT_SORT, historyRuns, sortRows, STATUS_LABELS, tabTitle, titleOf} from './words.ts';
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
  // Off (38c), the page is its one line: no header numbers, no search, nothing for the keys.
  const enabled = page?.enabled ?? true;

  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [cursor, setCursor] = useState<string | null>(null);

  // Search (36a, 36b): its own state, never mail's (D316).
  const [searching, setSearching] = useState(Boolean(route.q));
  const [query, setQuery] = useState(route.q ?? '');
  // Searched from mail: the field shows the query, without taking focus, so J / K and Esc are the page's.
  const arrivedSearching = useRef(Boolean(route.q));
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
    if (arrivedSearching.current) {
      arrivedSearching.current = false;
      return;
    }
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
  const held = useMemo(() => (hold.filter === filter ? hold.ids : new Set<number>()), [hold, filter]);
  // Memoized, so the table's rows (and their folds) change only when the page's answer or the filter does.
  const filtered = useMemo(() => rows.filter(row => matches(row, filter) || held.has(row.id)), [rows, filter, held]);
  if (filter !== 'all' && (hold.filter !== filter || filtered.some(row => !held.has(row.id)))) setHold({filter, ids: new Set(filtered.map(row => row.id))});
  const table = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  // What J / K move through: Needs you's items, then the rows; in search, its results in order.
  const corRows = useMemo(() => (results ? sortRows(results.company_or_role, sort) : []), [results, sort]);
  const jdRows = useMemo(() => (results ? sortRows(results.in_jd.map(each => each.row), sort) : []), [results, sort]);
  const lines = useMemo(() => new Map(results?.in_jd.map(each => [each.row.id, each.line]) ?? []), [results]);
  const shownRows = !enabled ? [] : results ? [...corRows, ...jdRows] : table;
  const needs = !q && page?.enabled ? page.needs_you : [];
  const keys = [...needs.map(item => needKey(item.id)), ...shownRows.map(row => rowKey(row.id))];

  const open = route.open;
  // An application open as the page mounts arrives: its pane is simply there until it closes (37b).
  const [arriving, setArriving] = useState(open !== null);
  if (arriving && open === null) setArriving(false);
  // Full posting from mail: that application's posting arrives unfolded, once.
  const [unfold, setUnfold] = useState(route.posting ? open : null);
  if (unfold !== null && open !== unfold) setUnfold(null);
  // Settings › Jobs's Show: From history unfolds, each time it's asked, even with the page already here.
  const [historyAsks, setHistoryAsks] = useState({route, count: route.history ? 1 : 0});
  if (historyAsks.route !== route) setHistoryAsks({route, count: historyAsks.count + (route.history ? 1 : 0)});
  // What the address carried from mail or Settings is spent once it's here.
  useEffect(() => {
    if (route.posting || route.q || route.history) navigate({page: 'jobs', open: route.open}, {replace: true});
  }, [route.posting, route.q, route.history, route.open]);
  const openRow = open === null ? undefined : shownRows.find(row => row.id === open) ?? rows.find(row => row.id === open);
  const {data: detail} = useResource<ApplicationOut>(open === null ? null : applicationPath(open));
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
      else if (plainKey(event, '/') && enabled) run(enterSearch);
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

  // ---- J6: the corrections, each said in the toast with its Undo ----
  const [editing, setEditing] = useState<{id: number; field: 'company' | 'title'} | null>(null);
  // Another application opened: no field in edit.
  if (editing && editing.id !== open) setEditing(null);
  const [rowMenuOpen, setRowMenuOpen] = useState<{spec: MenuSpec; anchor: MenuAnchor} | null>(null);
  /** A row a correction takes away folds out; refused, it stays, and once gone it's forgotten. */
  const takeAway = (id: number, send: () => ReturnType<typeof act>) => {
    takenAway.add(id);
    void send().then(change => {
      if (!change) takenAway.delete(id);
      else window.setTimeout(() => takenAway.delete(id), motion.medium * 4);
    });
  };
  const edit = (row: ApplicationRowOut, field: 'company' | 'title') => {
    if (open !== row.id) openAt(row.id);
    setEditing({id: row.id, field});
  };
  const correctionsFor = (row: ApplicationRowOut): CorrectionActions => ({
    editCompany: () => edit(row, 'company'),
    editTitle: () => edit(row, 'title'),
    setStatus: status => void act(() => setStatus(row.id, status), {
      done: status ? `Set to ${STATUS_LABELS[status]}` : 'Status left to the emails', failed: 'Couldn\'t set the status',
    }),
    merge: other => takeAway(other.id, () => act(() => mergeWith(row.id, other.id), {done: 'Merged', failed: 'Couldn\'t merge them'})),
    notThisPosting: () => void act(() => notThisPosting(row.id), {done: 'JD taken away', failed: 'Couldn\'t take the JD away'}),
    lookUpAgain: () => void lookUp(row.id).then(() => showToast('Looking for the posting'), toastFailure('Couldn\'t look it up')),
    notAnApplication: () => {
      if (open === row.id) close();
      takeAway(row.id, () => act(() => notAnApplication(row.id), {done: `Hidden ${row.company}`, tone: 'gone', failed: 'Couldn\'t hide it'}));
    },
    remove: () => {
      if (open === row.id) close();
      takeAway(row.id, () => act(() => deleteApplication(row.id), {done: `Deleted ${row.company}`, tone: 'gone', failed: 'Couldn\'t delete it'}));
    },
  });
  /** The title or company in place: shown at once, then saved; refused, it's what it was. */
  const save = (field: 'company' | 'title', value: string) => {
    if (open === null) return;
    const id = open;
    setEditing(null);
    const put = <T extends {id: number}>(data: T) => (data.id === id ? {...data, [field]: value} : data);
    updateCached<ApplicationOut>(applicationPath(id), put);
    updateCached<JobsPageOut>(JOBS_PATH, data => ({...data, rows: data.rows.map(put)}));
    void act(() => editApplication(id, {[field]: value}), {
      done: field === 'title' ? 'Title changed' : 'Company changed', failed: field === 'title' ? 'Couldn\'t change the title' : 'Couldn\'t change the company',
    });
  };
  const move = (event: JobEventOut, to: ApplicationRowOut) => open !== null && void act(() => moveEvent(event.id, open, to.id), {done: `Moved to ${titleOf(to)}`, failed: 'Couldn\'t move it'});
  const takeOff = (event: JobEventOut) => void act(() => notAboutThis(event.id), {done: 'Back in Needs you', failed: 'Couldn\'t take it off'});
  const pick = (candidate: JdCandidateOut | null) => {
    if (open === null) return;
    const company = (openRow ?? detail)?.company ?? '';
    void (candidate
      ? act(() => pickCandidate(open, candidate.id), {done: `JD saved for ${company}`, failed: 'Couldn\'t save the JD'})
      : act(() => noneOfThese(open), {done: `None of these for ${company}`, failed: 'Couldn\'t turn them down'}));
  };
  // A row's right-click (#248, #268): its actions at the pointer; the cursor moves to it, and it doesn't open.
  const zoom = () => (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;
  const onRowMenu = (row: ApplicationRowOut, event: ReactMouseEvent<HTMLElement>) => {
    if (!takesContextMenu(event, event.currentTarget)) return;
    event.preventDefault();
    setCursor(rowKey(row.id));
    const link = row.jd.link;
    setRowMenuOpen({
      anchor: {point: {x: event.clientX / zoom(), y: event.clientY / zoom()}},
      spec: rowMenu(row, rows, today, {
        ...correctionsFor(row),
        open: () => openAt(row.id),
        openPosting: () => link && window.open(link, '_blank', 'noopener'),
        copy: text => copyText(text),
      }),
    });
  };

  const onPoint = (key: string) => key !== cursor && setCursor(key);
  const rowState = (row: ApplicationRowOut) => ({
    cursor: cursor === rowKey(row.id), open: open === row.id, landed: seen.landed.has(row.id) || seen.moved.has(row.id), moved: seen.moved.has(row.id),
  });
  const rowProps = {rowState, besideDetail: open !== null, query: q || null, now, timeZone: zone, today, onPoint, onClick: onRowClick, onMenu: onRowMenu};

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
          {page?.enabled && !q && <JobsLines page={page} now={now} timeZone={zone} />}
          {!page ? (failed ? <LoadFailed what="Jobs" loads={[load]} /> : <TableSkeleton />) : !page.enabled ? <JobsOff /> : (
            <div className="jb-scroll jb-tbl" ref={scroller}>
              <NeedsYou items={page.needs_you} history={page.from_history} rows={rows} accounts={accounts} cursor={cursor} folded={Boolean(q)} now={now} timeZone={zone}
                unfoldHistory={historyAsks.count} onPoint={onPoint} onOpen={openAt} />
              <HeaderRow sort={sort} first={!page.needs_you.length && !page.from_history.length || Boolean(q)} onSort={setSort} />
              {!results && historyRuns(page.history) && <HistorySkeleton />}
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
          <Detail id={open} row={openRow} accounts={accounts} now={now} timeZone={zone} today={today} leaving={leaving} arrived={arriving} unfolded={unfold === open}
            canStep={{previous: neighbour(-1) !== null, next: neighbour(1) !== null}} onStep={step} onClose={close} onOpen={openAt}
            onEmail={messageId => navigate({page: 'inbox', account: null, open: messageId})} postingRef={posting}
            rows={rows} corrections={correctionsFor} editing={editing?.id === open ? editing.field : null}
            onEdit={field => setEditing(field === null ? null : {id: open, field})} onSave={save} onMove={move} onNotAboutThis={takeOff} onPick={pick} />
        )}
      </div>
      {rowMenuOpen && <JobsMenu spec={rowMenuOpen.spec} anchor={rowMenuOpen.anchor} onClose={() => setRowMenuOpen(null)} />}
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
