// The News page (DESIGN.md › News; boards 25–28): the header (News, All | Local | Tech | AI |
// General, Search news), the list and the story pane. All shows each section's block in a fixed
// order, with Upcoming in Tech, the Missed strip and the new-stories pill; a section its full list;
// Missed (Catch up) its stories by day. The list's order holds while the page is open (D87): rows on
// screen take their sources and summary from each new answer, and everything else waits behind the
// pill, which `N` or a click takes, scrolling to the top (logic/news.ts). A story is seen when its
// row has been fully on screen for about a second, or when it's opened (useSeen below), but its dot
// stays for the visit (#95): a visit is the page's time on screen, from opening News (from another
// page, a link or a reload) until leaving it, All, the sections and Missed all one visit. An opened
// story loses its dot at once, and a fact during the visit brings it back as updated.
//
// N5 adds the states (DESIGN.md › States; boards 29a, 29b): the Unsorted line while sorting is down,
// with Show headlines listing what waits, and the first run's line, both above the list from
// /news/status; a whole section's stale or failing line under its header; and a section with nothing
// to show (logic/news.ts has the rule). Offline is the shell's, as on every page. Search news replaces
// the list with the stories found, as mail's search replaces its list (#8): the header reads Search,
// the segmented control goes, and Esc clears it.
//
// Keys: `J` / `K` move the cursor (with a story open, they open the next and previous one); Enter
// opens; `O` opens the original article; `N` takes the new stories; Esc goes from an article back to
// its story, then closes the pane, then clears a search. `1`, `2` and `3` are the shell's (App.tsx).
import type {
  ArticleOut, MissedOut, NewsPageOut, NewsSection, NewsSectionOut, NewsStatusOut, NewsUnsortedOut, SectionHealthOut, StoryOut, StoryRowOut, UpcomingOut,
} from '@setpoint/shared';
import {NEWS_SECTIONS} from '@setpoint/shared';
import {Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {timeZone} from '../../api/auth.ts';
import {getCached, useResource, useResources} from '../../api/client.ts';
import {articlePath, MISSED_PATH, markSeen, NEWS_PATH, openStory, sectionPath, STATUS_PATH, storyPath, UNSORTED_PATH} from '../../api/news.ts';
import {age, fullTimestamp} from '../../logic/format.ts';
import {
  dueSeen, emptySectionLine, firstRunLine, hazardGlyph, keyStory, missedDay, missedLayout, missedSince, missedTitle, moreLine, moveStory, neighbourStory, nextSeen, outletLine, pageLayout,
  pillParts, rowMeta, lookedAt, openedInVisit, rowsById, SECTION_GLYPHS, SECTION_LABELS, sectionLine, shownState, visitDots, sectionLayout, sight, storiesCount, storiesOnScreen, storyKey,
  unseen, unsortedLine, upcomingWhen, waiting, waitingSince,
} from '../../logic/news.ts';
import {resultsLine} from '../../logic/search.ts';
import type {Layout, Sightings, VisitDots} from '../../logic/news.ts';
import type {NewsView, Route} from '../../logic/route.ts';
import {tabTitle} from '../../logic/title.ts';
import {Icon} from '../../ui/Icon.tsx';
import {isTyping, plainKey} from '../../ui/keys.ts';
import {useMenuRef} from '../../ui/popover.ts';
import {useNow} from '../clock.ts';
import {navigate} from '../router.ts';
import {SettingsLink} from '../search/AnswerCard.tsx';
import {NoResults, SearchField} from '../search/Search.tsx';
import {useNewsSearch} from '../search/state.ts';
import {toastFailure} from '../toast.ts';
import {StoryPane} from './StoryPane.tsx';
import './news.css';

type NewsRoute = Extract<Route, {page: 'news'}>;
type Answer = NewsPageOut | NewsSectionOut | MissedOut;

/** An answer as the page reads it: its shelves, its rows, and All's and Missed's extras. */
interface Listing {
  layout: Layout;
  rows: Map<number, StoryRowOut>;
  upcoming: UpcomingOut[];
  missed: {count: number; since: string | null} | null;
  // Each section's line, stale or failing (N5), by its shelf.
  health: ReadonlyMap<string, SectionHealthOut | null>;
  // The section Missed's rows name: each story's main one (D102).
  named: Readonly<Record<number, NewsSection>>;
}

function listing(view: NewsView, answer: Answer): Listing {
  if (view === 'all') {
    const page = answer as NewsPageOut;
    return {
      layout: pageLayout(page), rows: rowsById(page.blocks.flatMap(block => block.stories)), upcoming: page.blocks.flatMap(block => block.upcoming), missed: page.missed,
      health: new Map(page.blocks.map(block => [block.section, block.health])), named: {},
    };
  }
  if (view === 'missed') {
    const missed = answer as MissedOut;
    const stories = missed.days.flatMap(day => day.stories);
    return {
      layout: missedLayout(missed), rows: rowsById(stories), upcoming: [], missed: {count: missed.count, since: missed.since}, health: new Map(),
      named: Object.fromEntries(stories.map(story => [story.id, story.section])),
    };
  }
  const list = answer as NewsSectionOut;
  return {layout: sectionLayout(list), rows: rowsById(list.stories), upcoming: list.upcoming, missed: null, health: new Map([[list.section, list.health]]), named: {}};
}

/** Search's results as one shelf, newest first. */
const SEARCH_SHELF = 'search';

const pathOf = (view: NewsView) => (view === 'all' ? NEWS_PATH : view === 'missed' ? MISSED_PATH : sectionPath(view));

/**
 * The order held for this visit to a list. What the cache held when the visit began is drawn as it
 * is until the page's own first answer comes; that one is held, so opening the page shows the latest.
 * `known` is each row as the latest answer that held it had it, so a row the latest order drops
 * still follows its story, and `named` the section Missed's answers named it by.
 */
interface Hold {
  path: string;
  stale: unknown;
  held: {layout: Layout} | null;
  known: Map<number, StoryRowOut>;
  named: Readonly<Record<number, NewsSection>>;
  from: Listing | null;
}

// The story last opened, so the address following an open doesn't open it twice; a reload or a link opens it.
let lastOpened: number | null = null;

export function NewsPage({route}: {route: NewsRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {view} = route;
  const path = pathOf(view);
  const {data} = useResource<Answer>(path);
  const latest = useMemo(() => (data ? listing(view, data) : null), [view, data]);

  const [hold, setHold] = useState<Hold>(() => ({path, stale: getCached(path), held: null, known: new Map(), named: {}, from: null}));
  let current: Hold = hold.path === path ? hold : {path, stale: getCached(path), held: null, known: new Map(), named: {}, from: null};
  if (latest && current.held === null && data !== current.stale) current = {...current, held: {layout: latest.layout}};
  if (latest && current.from !== latest) current = {...current, known: new Map([...current.known, ...latest.rows]), named: {...current.named, ...latest.named}, from: latest};
  if (current !== hold) setHold(current);
  const held = current.held;
  const named = current.named;

  const layout = useMemo(() => held?.layout ?? latest?.layout ?? [], [held, latest]);
  // A row the latest answer no longer holds is loaded on its own, so its dot and sources still follow.
  const absent = useMemo(() => (latest ? layout.flatMap(shelf => shelf.ids).filter(id => !latest.rows.has(id)) : []), [layout, latest]);
  const loose = useResources<StoryOut>([...new Set(absent)].map(storyPath));
  const known = current.known;
  // Search news (N5): its results replace the list, as their own shelf.
  const search = useNewsSearch();
  const searching = search.active;
  const found = search.results;
  const rows = useMemo(() => {
    const merged = new Map(known);
    for (const story of loose) if (story) merged.set(story.id, story);
    for (const story of found) merged.set(story.id, story);
    return merged;
  }, [known, loose, found]);
  const shown: Layout = useMemo(() => (searching ? [{key: SEARCH_SHELF, ids: found.map(story => story.id), more: 0}] : layout), [searching, found, layout]);
  // The visit's dots: each story's on arrival, kept once seen (#95).
  const [visit, setVisit] = useState<{from: ReadonlyMap<number, StoryRowOut> | null; dots: VisitDots}>({from: null, dots: new Map()});
  let dots = visit.dots;
  if (visit.from !== rows) {
    dots = visitDots(visit.dots, rows.values());
    setVisit({from: rows, dots});
  }
  const pending = held && latest ? waiting(held.layout, latest.layout, latest.rows) : null;
  const pill = pending ? pillParts(pending) : null;
  const list = useRef<HTMLDivElement>(null);
  const takeNew = () => {
    if (!latest) return;
    setHold({...current, held: {layout: latest.layout}});
    list.current?.scrollTo({top: 0});
  };

  // Missed, opened with nothing left in it, is All (D92). Emptied during the visit, as its rows are
  // seen, its held order keeps the list until the visit leaves it, as All's does (the polish audit's news-01).
  const emptyMissed = view === 'missed' && held !== null && held.layout.every(shelf => shelf.ids.length === 0) && latest?.missed?.count === 0;
  useEffect(() => {
    if (emptyMissed) navigate({page: 'news', view: 'all', story: null, article: null}, {replace: true});
  }, [emptyMissed]);

  const keys = useMemo(() => shown.flatMap(shelf => shelf.ids.filter(id => rows.has(id)).map(id => storyKey(shelf.key, id))), [shown, rows]);
  const [cursor, setCursor] = useState<string | null>(null);
  const open = route.story;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const shownOpenKey = open === null ? null : openKey !== null && keyStory(openKey) === open && keys.includes(openKey) ? openKey : keys.find(key => keyStory(key) === open) ?? null;

  // The opened story as it stood before it was seen, for its pane's "New since you looked" when the
  // visit hadn't met it (a link).
  const [opened, setOpened] = useState<{id: number; before: StoryOut} | null>(null);
  useEffect(() => {
    if (open === null || open === lastOpened) return;
    lastOpened = open;
    let live = true;
    void openStory(open, toastFailure('Couldn\'t mark it seen')).then(before => {
      if (!live || !before) return;
      setOpened({id: open, before});
      setVisit(current => ({...current, dots: openedInVisit(visitDots(current.dots, [before]), open)}));
    });
    return () => {
      live = false;
    };
  }, [open]);
  const looked = open === null ? null : dots.get(open)?.looked ?? lookedAt(opened?.id === open ? opened.before : null);
  useEffect(() => () => {
    lastOpened = null;
  }, []);

  const {data: story} = useResource<StoryOut>(open ? storyPath(open) : null);
  const headline = open ? (story?.id === open ? story.headline : rows.get(open)?.headline ?? null) : null;
  useEffect(() => {
    document.title = tabTitle({page: 'news', headline});
  }, [headline]);

  const go = (changes: Partial<NewsRoute>) => navigate({...route, ...changes});
  function openAt(key: string) {
    setCursor(key);
    setOpenKey(key);
    setVisit(current => ({...current, dots: openedInVisit(current.dots, keyStory(key))}));
    go({story: keyStory(key), article: null});
  }
  function close() {
    go({story: null, article: null});
  }
  /** A story by its id: at its row when the list shows it, else in the pane alone (Upcoming's, SV-50). */
  function openStoryOf(id: number) {
    const key = keys.find(one => keyStory(one) === id);
    if (key) openAt(key);
    else go({story: id, article: null});
  }
  function step(delta: 1 | -1) {
    const next = neighbourStory(keys, shownOpenKey, delta);
    if (next) {
      openAt(next);
      requestAnimationFrame(() => document.querySelector(`.nw-list [data-key="${next}"]`)?.scrollIntoView({block: 'nearest'}));
    }
  }
  /** `O`: the open article's own page, else the open story's leading outlet's. */
  function openOriginal() {
    const url = route.article ? getCached<ArticleOut>(articlePath(route.article))?.url
      : story?.id === open ? story.lead.url : open ? rows.get(open)?.lead.url : null;
    if (url) window.open(url, '_blank', 'noopener');
  }

  useSeen(list, shown, rows);

  // Attached again with each render as it's drawn, before any key can come: a passive effect can
  // wait until after a hover's render is on screen, and a key then would act on the render before.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.defaultPrevented) return;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const move = (delta: 1 | -1) => run(() => {
        if (open !== null) return step(delta);
        const key = moveStory(keys, cursor, delta);
        setCursor(key);
        if (key) requestAnimationFrame(() => document.querySelector(`.nw-list [data-key="${key}"]`)?.scrollIntoView({block: 'nearest'}));
      });
      if (plainKey(event, 'j')) move(1);
      else if (plainKey(event, 'k')) move(-1);
      else if (plainKey(event, 'Enter') && cursor !== null && keys.includes(cursor)) run(() => openAt(cursor));
      else if (plainKey(event, 'n') && pill) run(takeNew);
      else if (plainKey(event, 'o') && open !== null) run(openOriginal);
      else if (plainKey(event, 'Escape')) {
        if (route.article !== null) run(() => go({article: null}));
        else if (open !== null) run(close);
        else if (searching) run(() => search.clear());
        else if (cursor !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Sorting's state above the list (N5): the Unsorted line, with Show headlines, and the first run's.
  const {data: status} = useResource<NewsStatusOut>(STATUS_PATH);
  const firstRun = Boolean(status?.first_run);
  const unsorted = status ? unsortedLine(status, now, zone) : null;
  const sorting = status ? firstRunLine(status) : null;
  const [headlines, setHeadlines] = useState(false);
  const showHeadlines = headlines && unsorted !== null && !searching;
  const {data: waitingOut} = useResource<NewsUnsortedOut>(showHeadlines ? UNSORTED_PATH : null);

  const switchTo = (next: NewsView) => {
    search.clear();
    navigate({page: 'news', view: next, story: null, article: null});
  };
  const segOn = (section: NewsView) => ((view === 'missed' ? 'all' : view) === section ? 'on' : undefined);
  const missed = view === 'all' && !searching ? latest?.missed ?? null : null;
  const rowProps = {rows, cursor, openKey: shownOpenKey, now, zone, onPoint: (key: string) => key !== cursor && setCursor(key), onOpen: openAt};
  const firstShelf = !showHeadlines;

  return (
    <>
      <header className="hd">
        <span className="hd-title">{searching ? 'Search' : 'News'}</span>
        {!searching && (
          <span className="seg">
            <button type="button" className={segOn('all')} onClick={() => switchTo('all')}>All</button>
            {NEWS_SECTIONS.map(section => <button key={section} type="button" className={segOn(section)} onClick={() => switchTo(section)}>{SECTION_LABELS[section]}</button>)}
          </span>
        )}
        <span className="grow" />
        <SearchField search={search} label="Search news" onEnter={first => setCursor(storyKey(SEARCH_SHELF, first.id))} />
      </header>
      <div className="content">
        <section className="nw-list" aria-label={searching ? 'Stories found' : view === 'missed' ? 'Missed stories' : view === 'all' ? 'Stories' : `${SECTION_LABELS[view]} stories`}>
          {!searching && unsorted && (
            <div className="nw-state failing">
              <Icon name="pending" size={16} />
              <span className="grow num ell" title={unsorted.text}>{unsorted.settings ? <SettingsLink text={unsorted.text} /> : unsorted.text}</span>
              <button className="btn ghost sm" type="button" aria-expanded={showHeadlines} onClick={() => setHeadlines(!headlines)}>{showHeadlines ? 'Hide headlines' : 'Show headlines'}</button>
            </div>
          )}
          {!searching && sorting && (
            <div className="nw-state muted">
              <span className="spin"><Icon name="progress_activity" size={16} /></span>
              <span className="grow num ell" title={sorting}>{sorting}</span>
            </div>
          )}
          {missed && (
            <div className="nw-missed">
              <Icon name="history" size={16} />
              <span className="grow"><b className="num">{storiesCount(missed.count)}</b> {missedSince(missed.since, now, zone)}</span>
              <button className="btn sm" type="button" onClick={() => switchTo('missed')}>Catch up</button>
            </div>
          )}
          <div className="nw-body">
          {pill && !searching && (
            <button className="nw-pill" type="button" onClick={takeNew}>
              <Icon name="arrow_upward" size={16} />
              <span>{pill.fresh}{pill.fresh && pill.updated && ' · '}{pill.updated && <span className="upd">{pill.updated}</span>}</span>
              <span className="kbd">N</span>
            </button>
          )}
          {searching ? (
            <div className="list search-list" ref={list}>
              {search.error && <div className="bar muted failing">{search.error}</div>}
              {search.out && search.out.total > 0 && (
                <div className="bar muted">
                  {resultsLine({total: search.out.total, order: 'newest'}).map((part, index) => <Fragment key={part}>{index > 0 && <span>·</span>}<span className="num">{part}</span></Fragment>)}
                </div>
              )}
              {found.map(row => (
                <StoryRow key={row.id} row={{...row, state: shownState(row, dots)}} lead={false} rowKey={storyKey(SEARCH_SHELF, row.id)} section={row.sections[0]!} {...rowProps} />
              ))}
              {search.out && search.out.total === 0 && <NoResults lead="No stories match" search={search} />}
            </div>
          ) : (
          <div className="list" ref={list}>
            {showHeadlines && (
              <>
                <div className="nw-sec first"><Icon name="pending" size={14} />Unsorted<span className="day num">{waitingOut ? waitingOut.count.toLocaleString('en-US') : ''}</span></div>
                {waitingOut?.articles.map(article => (
                  <a key={article.id} className="nw-raw" href={article.url} target="_blank" rel="noopener noreferrer">
                    <span className="hl">{article.headline}</span>
                    <span className="nw-meta">
                      <span>{SECTION_LABELS[article.section]}</span><span>·</span><span className="outlet">{article.outlet_short}</span><span>·</span>
                      <span title={fullTimestamp(article.published_at, zone)}>{age(article.published_at, now, zone)}</span>
                    </span>
                    <Icon name="open_in_new" size={16} />
                  </a>
                ))}
              </>
            )}
            {view === 'missed' && latest && (
              <div className="nw-back">
                <button className="ibtn sm" type="button" aria-label="Back to All" onClick={() => switchTo('all')}><Icon name="arrow_back" size={18} /></button>
                <span className="t">{missedTitle(latest.missed?.since ?? null, now, zone)}</span>
                <span className="grow" />
                <span className="n num">{storiesCount(layout.reduce((sum, shelf) => sum + shelf.ids.length, 0))}</span>
              </div>
            )}
            {layout.map((shelf, index) => {
              const shelfRows = shelf.ids.flatMap(id => rows.get(id) ?? []);
              const section = view === 'all' ? NEWS_SECTIONS.find(one => one === shelf.key) : undefined;
              const upcoming = view === 'all' ? (latest?.upcoming ?? []).filter(one => one.section === shelf.key) : view === 'missed' ? [] : latest?.upcoming ?? [];
              const header = index === 0 && firstShelf ? 'nw-sec first' : 'nw-sec';
              // A section's own line and its empty line (N5); Missed's days have neither.
              const own = view === 'missed' ? null : NEWS_SECTIONS.find(one => one === shelf.key) ?? null;
              const line = own ? sectionLine(own, latest?.health.get(own) ?? null, now, zone) : null;
              const empty = own && latest ? emptySectionLine(own, shelfRows.length, shelf.more, firstRun, now, zone) : null;
              return (
                <Fragment key={shelf.key}>
                  {section && <div className={header}><Icon name={SECTION_GLYPHS[section]} size={14} />{SECTION_LABELS[section]}</div>}
                  {view === 'missed' && <div className={header}><Icon name="history" size={14} />{missedDay(shelf.key).day}<span className="day num">{missedDay(shelf.key).date}</span></div>}
                  {line && <div className={`nw-line ${line.state}`}><span className="num ell" title={line.text}>{line.text}</span></div>}
                  {upcoming.map(one => <Upcoming key={one.id} upcoming={one} story={rows.get(one.story_id)} now={now} zone={zone} onStory={openStoryOf} />)}
                  {empty && <div className="nw-empty"><Icon name="newspaper" size={16} />{empty}</div>}
                  {shelfRows.map((row, at) => (
                    <StoryRow key={row.id} row={{...row, state: shownState(row, dots)}} lead={at === 0} rowKey={storyKey(shelf.key, row.id)} section={view === 'missed' ? named[row.id] ?? row.sections[0]! : null} {...rowProps} />
                  ))}
                  {section && shelf.more > 0 && (
                    <button className="nw-more" type="button" onClick={() => switchTo(section)}>{moreLine(shelf.more, section)}<Icon name="chevron_right" size={16} /></button>
                  )}
                </Fragment>
              );
            })}
          </div>
          )}
          </div>
        </section>
        {open !== null && (
          <StoryPane storyId={open} articleId={route.article} row={rows.get(open)} lookedAt={looked} now={now} timeZone={zone}
            canStep={{previous: neighbourStory(keys, shownOpenKey, -1) !== null, next: neighbourStory(keys, shownOpenKey, 1) !== null}}
            onStep={step} onOriginal={openOriginal} onArticle={article => go({article})} onBack={() => go({article: null})} onClose={close} />
        )}
      </div>
    </>
  );
}

interface RowProps {
  row: StoryRowOut;
  lead: boolean;
  rowKey: string;
  section: StoryRowOut['sections'][number] | null;
  cursor: string | null;
  openKey: string | null;
  now: number;
  zone: string;
  onPoint: (key: string) => void;
  onOpen: (key: string) => void;
}

const STATE_CLASS = {new: 'new', updated: 'upd', seen: 'seen'} as const;

/** A story's row: a block's lead (its large image, headline, two lines of summary, meta), or a row with its thumbnail. */
function StoryRow({row, lead, rowKey, section, cursor, openKey, now, zone, onPoint, onOpen}: RowProps) {
  const meta = rowMeta(row, now, zone, section);
  const image = lead ? row.image?.large ?? row.image?.thumb : row.image?.thumb;
  // A hazard source's story without a photo shows its hazard's glyph instead (#162).
  const hazard = hazardGlyph(row);
  const classes = [lead ? 'nw-lead' : 'nw-row', STATE_CLASS[row.state], lead && !image && 'noimg', cursor === rowKey && 'cur', openKey === rowKey && 'open'].filter(Boolean).join(' ');
  const attributes = {className: classes, 'data-key': rowKey, 'data-story': row.id, onMouseMove: () => onPoint(rowKey), onClick: () => onOpen(rowKey)};
  if (lead) {
    return (
      <div {...attributes}>
        <span className="nd" />
        {image && <img className="nw-img" src={image.url} alt="" />}
        <div className="txt">
          <div className="hl">{hazard && <span className="hz"><Icon name={hazard} size={18} /></span>}{row.headline}</div>
          {row.one_line && <div className="sm">{row.one_line}</div>}
          <div className="nw-meta">
            {meta.section && <><span>{meta.section}</span><span>·</span></>}
            <span className="outlet">{meta.outlet}</span><span>·</span><span>{meta.age}</span>
            {meta.updated && <><span>·</span><span className="upd">{meta.updated}</span></>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div {...attributes}>
      <span className="nd" />
      <div className="txt">
        <div className="hl">{row.headline}</div>
        {row.one_line && <div className="sm">{row.one_line}</div>}
      </div>
      <div className="side">
        <span className="nw-meta">{meta.section && <><span>{meta.section}</span><span>·</span></>}<span className="outlet">{meta.outlet}</span></span>
        <span className="nw-meta">{meta.updated ? <span className="upd">{meta.updated}</span> : meta.age}</span>
      </div>
      {image ? <img className="nw-img" src={image.url} alt="" /> : hazard ? <span className="nw-hz"><Icon name={hazard} size={22} /></span> : <span />}
    </div>
  );
}

/**
 * Upcoming (Tech): "Apple event · Tue Oct 20 · 10 AM", its outlet, and Add to calendar, which opens
 * Calendar's editor on it. The row opens a popover with the story that announced it, which opens
 * that story, so it can be read before it's added (SV-50).
 */
function Upcoming({upcoming, story, now, zone, onStory}: {upcoming: UpcomingOut; story: StoryRowOut | undefined; now: number; zone: string; onStory: (id: number) => void}) {
  const when = upcomingWhen(upcoming, zone);
  const [open, setOpen] = useState(false);
  const menu = useMenuRef(open, () => setOpen(false));
  // The story, from the list when it holds it, else on its own while the popover is open.
  const {data: loaded} = useResource<StoryOut>(open && !story ? storyPath(upcoming.story_id) : null);
  const shown = story ?? loaded;
  // Esc puts the popover away before the page's own Esc (it closes the pane, the search) sees it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <div className={open ? 'nw-up on' : 'nw-up'} onClick={() => setOpen(!open)}>
      <span className="ico"><Icon name="event" size={16} /></span>
      <span className="lab">Upcoming</span>
      <span className="ell" title={`${upcoming.name} · ${when}`}><span className="what">{upcoming.name}</span> <span className="num">· {when}</span></span>
      <span className="grow" />
      <span className="nw-meta"><span className="outlet">{outletLine(upcoming.lead)}</span></span>
      <button className="btn out sm" type="button"
        onClick={event => {
          event.stopPropagation();
          navigate({page: 'calendar', date: null, item: null, at: null, compose: {kind: 'event', message: null, upcoming: upcoming.id}});
        }}>
        <Icon name="event" size={16} />Add to calendar
      </button>
      {open && (
        <div ref={menu} className="pop nw-up-pop" role="dialog" aria-label={`The story behind ${upcoming.name}`} onClick={event => event.stopPropagation()}>
          {shown ? (
            <button className="nw-up-story" type="button" data-story={shown.id} onClick={() => {
              setOpen(false);
              onStory(shown.id);
            }}>
              <span className="hl">{shown.headline}</span>
              {shown.one_line && <span className="sm">{shown.one_line}</span>}
              <UpcomingMeta row={shown} now={now} zone={zone} />
            </button>
          ) : <span className="nw-up-wait"><span className="spin"><Icon name="progress_activity" size={16} /></span></span>}
        </div>
      )}
    </div>
  );
}

function UpcomingMeta({row, now, zone}: {row: StoryRowOut; now: number; zone: string}) {
  const meta = rowMeta(row, now, zone);
  return (
    <span className="nw-meta">
      <span className="outlet">{meta.outlet}</span><span>·</span><span>{meta.age}</span>
      {meta.updated && <><span>·</span><span className="upd">{meta.updated}</span></>}
    </span>
  );
}

/**
 * Seen (D87): a story waiting to be seen (new or updated) whose row has been fully on screen in the
 * list for about a second; flicking past doesn't count, nor does a hidden tab. What's due goes to the
 * server together.
 */
function useSeen(list: RefObject<HTMLDivElement | null>, layout: Layout, rows: ReadonlyMap<number, StoryRowOut>) {
  // Each row fully on screen, by its key, and so each story.
  const fullRows = useRef<ReadonlyMap<string, number>>(new Map());
  const visible = useRef<Sightings>(new Map());
  const waits = useRef<Sightings>(new Map());
  // Sent and not yet seen in an answer, so they aren't sent again meanwhile.
  const sent = useRef(new Set<number>());
  const timer = useRef<number | undefined>(undefined);
  const shownKey = layout.flatMap(shelf => shelf.ids.filter(id => rows.has(id)).map(id => storyKey(shelf.key, id))).join(',');

  const check = useRef(() => {});
  useEffect(() => {
    check.current = () => {
      window.clearTimeout(timer.current);
      if (document.visibilityState !== 'visible') return;
      const due = dueSeen(visible.current, waits.current, Date.now());
      if (due.length) {
        due.forEach(id => sent.current.add(id));
        waits.current = new Map([...waits.current].filter(([id]) => !due.includes(id)));
        void markSeen(due).catch((error: Error) => {
          due.forEach(id => sent.current.delete(id));
          toastFailure('Couldn\'t mark them seen')(error);
        });
      }
      const next = nextSeen(visible.current, waits.current);
      if (next !== null) timer.current = window.setTimeout(() => check.current(), Math.max(0, next - Date.now()));
    };
  });

  // The stories on screen waiting to be seen, each since it began to.
  useEffect(() => {
    const ids = [...new Set(shownKey ? shownKey.split(',').map(keyStory) : [])];
    for (const id of sent.current) if (rows.get(id)?.state === 'seen') sent.current.delete(id);
    waits.current = waitingSince(waits.current, ids.filter(id => unseen(rows.get(id)!) && !sent.current.has(id)), Date.now());
    check.current();
  }, [shownKey, rows]);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    fullRows.current = new Map();
    visible.current = new Map();
    const observer = new IntersectionObserver(entries => {
      const at = Date.now();
      for (const entry of entries) {
        // Fully on screen: whole within the list's box (a fraction of a pixel aside).
        fullRows.current = sight(fullRows.current, (entry.target as HTMLElement).dataset.key!, entry.isIntersecting && entry.intersectionRatio > 0.99, at);
      }
      visible.current = storiesOnScreen(fullRows.current);
      check.current();
    }, {root, threshold: [0, 0.99, 1]});
    root.querySelectorAll('[data-key]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [list, shownKey]);

  useEffect(() => {
    // Back on the tab: what's on screen starts its second again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fullRows.current = new Map([...fullRows.current].map(([key]) => [key, Date.now()]));
        visible.current = storiesOnScreen(fullRows.current);
      }
      check.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(timer.current);
    };
  }, []);
}
