// Needs you (DESIGN.md › Needs you; boards 32, 34a–34c; D308, D311, D313, D324, #266): the band above
// the table under its group header, today's items, and From history folded under them.
//
// - A JD to confirm: its candidates as a group, ↑ ↓ choosing and Enter picking while the item has the
//   cursor; each candidate's arrow opens its posting without picking it; None of these last.
// - An update to assign: Assign to… (the company's applications first, Another application…, Not
//   about a job), and Not about a job. Each application offers its email (D402), opening beside the
//   menu, which stays, so the update can be told from them before it's assigned.
// - An email to track: Track this (decision 69), which makes the application and opens it.
// - From history: each row's two buttons (Choose… is a menu, #266), and Dismiss all with its Undo.
// - An item with an email: its subject opens that email where the detail sits (D401). The page holds
//   which, and the item shows it as the table shows its open row; reading it answers nothing.
//
// Answered (34b, as the Today block's task): the press lands, the item holds its place, taking no
// more presses, and at 360 ms it folds away (180 ms), the count changing as it starts; the toast says
// what happened, with Undo, which folds it back. The last item takes the band with it.
import type {AccountOut, ApplicationRowOut, JdCandidateOut, NeedsYouItemOut} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import {age, fullTimestamp, localDate} from '../../logic/format.ts';
import type {Entry, FoldRules} from '../../logic/fold.ts';
import {motion} from '../../tokens.ts';
import type {IconName} from '../../ui/glyphs.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {foldIn, foldOut, useFold} from '../fold.ts';
import {useHold} from '../hold.ts';
import {showToast, toastFailure} from '../toast.ts';
import {act} from './act.ts';
import {CandidatePicker} from './CandidatePicker.tsx';
import type {Said} from './act.ts';
import {assignItem, dismissFromHistory, noneOfThese, notAJob, pickCandidate, trackItem, undoDismiss} from './api.ts';
import {JobsMenu} from './Menu.tsx';
import type {MenuAnchor, MenuSpec} from './Menu.tsx';
import {assignMenu, chooseMenu} from './menus.ts';
import {dayWord, historyWhy, itemFrom, itemWhat, needsLine, pickWords, titleOf} from './words.ts';

const KIND_GLYPHS: Record<NeedsYouItemOut['kind'], IconName> = {jd_to_confirm: 'description', update_to_assign: 'alt_route', email_to_track: 'bookmark_add'};

export const needKey = (id: number) => `n:${id}`;

/** How long an answered item stays put before it folds: a double-click's second press finds it there, not the item riding up (#106). */
const HOLD_MS = 360;

interface Answered {
  item: NeedsYouItemOut;
  // Where it stood, so it holds its place while the page's answer no longer has it.
  index: number;
  // The candidate picked, or None of these: its group shows it for the press.
  picked: number | 'none' | null;
}

const FOLDS: FoldRules<NeedsYouItemOut> = {folds: () => true, arrives: () => true};

/** Items as they show: the page's, with the answered ones held in their place until they fold, less those folded away. */
function shownItems(items: NeedsYouItemOut[], answered: ReadonlyMap<number, Answered>, gone: ReadonlySet<number>, history: boolean): Entry<NeedsYouItemOut>[] {
  const list = [...items];
  for (const held of [...answered.values()].filter(each => each.item.from_history === history).sort((a, b) => a.index - b.index)) {
    if (!list.some(item => item.id === held.item.id)) list.splice(Math.min(held.index, list.length), 0, held.item);
  }
  return list.filter(item => !gone.has(item.id)).map(item => ({key: needKey(item.id), id: item.id, item}));
}

export function NeedsYou({items, history, rows, accounts, cursor, folded, now, timeZone, unfoldHistory = 0, reading = null, onPoint, onOpen, onRead, onLook}: {
  items: NeedsYouItemOut[];
  history: NeedsYouItemOut[];
  // The table's rows, for Assign to…'s applications.
  rows: ApplicationRowOut[];
  accounts: Map<number, AccountOut>;
  cursor: string | null;
  // While a search holds a query, it folds away (180 ms).
  folded: boolean;
  now: number;
  timeZone: string;
  // How many times Settings › Jobs's Show has asked for From history (J8): each ask unfolds it.
  unfoldHistory?: number;
  // The item an email is open for: its own, or (with `of`) that of an application in its Assign to….
  reading?: {item: number; of: string | null} | null;
  onPoint: (key: string) => void;
  // Track this opens the application it made (34c).
  onOpen: (id: number) => void;
  // An item's subject: its email opens, or closes if it's the one open.
  onRead: (item: NeedsYouItemOut) => void;
  // An application's email, for this item, from Assign to… (D402).
  onLook: (item: NeedsYouItemOut, row: ApplicationRowOut) => void;
}) {
  const [open, setOpen] = useState(unfoldHistory > 0);
  const [asked, setAsked] = useState(unfoldHistory);
  if (asked !== unfoldHistory) {
    setAsked(unfoldHistory);
    setOpen(true);
  }
  // Unfolded by Show, From history comes into view under the header.
  const fold = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (unfoldHistory > 0) requestAnimationFrame(() => fold.current?.scrollIntoView({block: 'nearest'}));
  }, [unfoldHistory]);
  const [answered, setAnswered] = useState<ReadonlyMap<number, Answered>>(new Map());
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const [menu, setMenu] = useState<{spec: MenuSpec; anchor: MenuAnchor; owner: string} | null>(null);
  // J / K to another item's email takes its menu away.
  if (menu && reading && !menu.owner.endsWith(`:${reading.item}`)) setMenu(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);
  const later = (ms: number, run: () => void) => {
    const timer = window.setTimeout(run, ms);
    timers.current.push(timer);
    return timer;
  };
  // Each answer's fold, by item: an answer undone or refused inside its 360 ms keeps the item.
  const folds = useRef(new Map<number, number>());
  const today = localDate(now, timeZone);

  const todayEntries = useMemo(() => shownItems(items, answered, gone, false), [items, answered, gone]);
  const historyEntries = useMemo(() => shownItems(history, answered, gone, true), [history, answered, gone]);
  const todays = useFold(todayEntries, FOLDS);
  const olds = useFold(historyEntries, FOLDS);
  const live = todays.filter(entry => entry.fold !== 'out');
  const liveHistory = olds.filter(entry => entry.fold !== 'out');
  // The last item leaving folds the whole band, header and all (180 ms); From history alone keeps its line.
  const band = useHold(live.length || liveHistory.length ? true : null, motion.medium);
  const historyLine = useHold(liveHistory.length ? true : null, motion.medium * 2);
  if (!band.shown) return null;

  const drop = (id: number) => {
    window.clearTimeout(folds.current.get(id));
    setAnswered(map => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    setGone(set => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  };

  /** Answers an item: the press lands, and at 360 ms it folds away; a refusal brings it back. */
  const answer = (item: NeedsYouItemOut, picked: Answered['picked'], send: () => ReturnType<typeof act>, after?: (application: number | null) => void) => {
    if (answered.has(item.id)) return;
    const list = item.from_history ? history : items;
    setAnswered(map => new Map(map).set(item.id, {item, index: Math.max(0, list.findIndex(each => each.id === item.id)), picked}));
    let folding = false;
    let made: number | null | undefined;
    folds.current.set(item.id, later(HOLD_MS, () => {
      folding = true;
      setGone(set => new Set(set).add(item.id));
      if (made !== undefined) after?.(made);
    }));
    void send().then(change => {
      if (!change) return drop(item.id);
      made = change.application;
      if (folding) after?.(made);
    });
  };
  const said = (item: NeedsYouItemOut, done: string, failed: string, tone?: Said['tone']): Said => ({done, failed, tone, undone: () => drop(item.id)});

  const pick = (item: NeedsYouItemOut, candidate: JdCandidateOut) => {
    const {done, failed} = pickWords(candidate, item.company);
    answer(item, candidate.id, () => act(() => pickCandidate(item.application_id!, candidate.id), said(item, done, failed)));
  };
  const none = (item: NeedsYouItemOut) => answer(item, 'none',
    () => act(() => noneOfThese(item.application_id!), said(item, `None of these for ${item.company}`, 'Couldn\'t turn them down')));
  const assign = (item: NeedsYouItemOut, row: ApplicationRowOut) => answer(item, null,
    () => act(() => assignItem(item.id, row.id), said(item, `Assigned to ${titleOf(row)}`, 'Couldn\'t assign it')));
  const notJob = (item: NeedsYouItemOut) => answer(item, null,
    () => act(() => notAJob(item.id), said(item, 'Not about a job', 'Couldn\'t set it aside', 'gone')));
  const track = (item: NeedsYouItemOut) => answer(item, null,
    () => act(() => trackItem(item.id), said(item, `Tracking ${item.company}`, 'Couldn\'t track it')), id => id !== null && onOpen(id));

  const openMenu = (owner: string, spec: MenuSpec, element: HTMLElement) =>
    setMenu(current => (current?.owner === owner ? null : {spec, anchor: {element, corner: 'left'}, owner}));
  const assignTo = (item: NeedsYouItemOut, element: HTMLElement) =>
    openMenu(`assign:${item.id}`, assignMenu(item, rows, today, {assign: row => assign(item, row), look: row => onLook(item, row), notAJob: () => notJob(item)}), element);
  const choose = (item: NeedsYouItemOut, element: HTMLElement) =>
    openMenu(`choose:${item.id}`, chooseMenu(item.candidates, {pick: candidate => pick(item, candidate), none: () => none(item)}), element);

  // Dismiss all (D324): the rows fold away together, then the line; Undo brings them back.
  const dismissAll = () => {
    const ids = liveHistory.map(entry => entry.item.id);
    setGone(set => new Set([...set, ...ids]));
    void dismissFromHistory().then(dismissed => showToast(`Dismissed ${dismissed.length} from history`, {
      label: 'Undo',
      run: () => void undoDismiss(dismissed).then(() => setGone(set => new Set([...set].filter(id => !dismissed.includes(id)))), toastFailure('Couldn\'t undo it')),
    }, 'gone'), error => {
      setGone(set => new Set([...set].filter(id => !ids.includes(id))));
      toastFailure('Couldn\'t dismiss them')(error);
    });
  };

  // The press away has closed any menu; Enter on the subject, with the menu's focus gone, hasn't.
  const read = (item: NeedsYouItemOut) => {
    setMenu(null);
    onRead(item);
  };
  const handlers = {pick, none, notJob, track, assignTo, choose, read};
  return (
    <div className={folded || band.closing ? 'jb-band folded' : 'jb-band'} inert={folded || band.closing}>
      <div>
        {live.length > 0 && <div className="gh first"><Icon name="pending_actions" size={14} />Needs you <span className="n">{live.length}</span></div>}
        {todays.map(({key, item, fold}) => (
          <Item key={key} item={item} account={item.account_id !== null ? accounts.get(item.account_id) : undefined} cur={cursor === needKey(item.id)} reading={reading?.item === item.id} own={reading?.of === null}
            answered={answered.get(item.id)} fold={fold} menuOpen={menu?.owner.endsWith(`:${item.id}`) ?? false}
            now={now} timeZone={timeZone} today={today} onPoint={onPoint} on={handlers} />
        ))}
        {historyLine.shown && (
          <div className={historyLine.closing ? 'jb-histsec closing' : 'jb-histsec'}>
            <div>
              <div className="jb-fold" ref={fold} onClick={() => setOpen(!open)}>
                <button className="jb-fold-t" type="button" aria-expanded={open} onClick={event => {
                  event.stopPropagation();
                  setOpen(!open);
                }}>
                  <Icon name="chevron_right" size={16} />
                  <span>From history <span className="n">{liveHistory.length}</span>,</span>
                  <span className="why ink3">what the history pass wasn't sure of</span>
                </button>
                {open && <button className="btn quiet sm" type="button" data-tip="The same as ignoring each one: those emails make nothing" onClick={event => {
                  event.stopPropagation();
                  dismissAll();
                }}>Dismiss all</button>}
              </div>
              <div className={open ? 'jb-hist-wrap open' : 'jb-hist-wrap'} inert={!open}>
                <div>
                  {olds.map(({key, item, fold}) => (
                    <HistoryRow key={key} item={item} reading={reading?.item === item.id} own={reading?.of === null} answered={answered.get(item.id)} fold={fold} menuOpen={menu?.owner.endsWith(`:${item.id}`) ?? false}
                      today={today} timeZone={timeZone} on={handlers} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {menu && <JobsMenu spec={menu.spec} anchor={menu.anchor} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface Handlers {
  pick: (item: NeedsYouItemOut, candidate: JdCandidateOut) => void;
  none: (item: NeedsYouItemOut) => void;
  notJob: (item: NeedsYouItemOut) => void;
  track: (item: NeedsYouItemOut) => void;
  assignTo: (item: NeedsYouItemOut, element: HTMLElement) => void;
  choose: (item: NeedsYouItemOut, element: HTMLElement) => void;
  read: (item: NeedsYouItemOut) => void;
}

function Item({item, account, cur, reading, own, answered, fold, menuOpen, now, timeZone, today, onPoint, on}: {
  item: NeedsYouItemOut;
  account: AccountOut | undefined;
  cur: boolean;
  reading: boolean;
  // That what's open is this item's own email, not one of its applications'.
  own: boolean;
  answered: Answered | undefined;
  fold: 'in' | 'out' | null;
  menuOpen: boolean;
  now: number;
  timeZone: string;
  today: string;
  onPoint: (key: string) => void;
  on: Handlers;
}) {
  const key = needKey(item.id);
  const jd = item.kind === 'jd_to_confirm';
  const leaving = fold === 'out';
  const classes = ['jb-need', cur && !leaving && 'cur', reading && 'reading', leaving && 'leaving'].filter(Boolean).join(' ');
  return (
    <div ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={classes} data-key={leaving ? undefined : key} data-need={item.id}
      aria-hidden={leaving || undefined} inert={Boolean(answered) || leaving} onMouseMove={() => !cur && !leaving && onPoint(key)}>
      <span className="g"><Icon name={KIND_GLYPHS[item.kind]} size={16} /></span>
      <div className="l1">
        {item.message_id !== null
          ? <button className="what" type="button" data-tip="Read this email" aria-pressed={reading && own} onClick={() => on.read(item)}>{itemWhat(item)}</button>
          : <span className="what">{itemWhat(item)}</span>}
        <span className="from">· {jd ? 'Is this the posting?' : itemFrom(item)}</span>
      </div>
      <div className="r1">
        {jd ? <span>Applied {dayWord(localDate(item.at, timeZone), today)}</span> : (
          <>
            {account && <span className="dot sm" style={dotStyle(account.colour)} role="img" aria-label={account.label} data-tip={account.label} />}
            <span data-tip={fullTimestamp(item.at, timeZone)}>{age(item.at, now, timeZone)}</span>
          </>
        )}
      </div>
      {jd ? (
        <div className="acts cands">
          <CandidatePicker candidates={item.candidates} active={cur && !answered} picked={answered?.picked ?? null}
            onPick={candidate => on.pick(item, candidate)} onNone={() => on.none(item)} />
        </div>
      ) : (
        <div className="acts">
          <span className="line">{needsLine(item)}</span>
          {item.kind === 'update_to_assign' ? (
            <button className="btn out sm" type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={event => on.assignTo(item, event.currentTarget)}>
              <Icon name="move_item" size={16} />Assign to…<Icon name="expand_more" size={16} className="after" />
            </button>
          ) : <button className="btn sm" type="button" onClick={() => on.track(item)}><Icon name="add" size={16} />Track this</button>}
          <button className="btn quiet sm" type="button" onClick={() => on.notJob(item)}>Not about a job</button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({item, reading, own, answered, fold, menuOpen, today, timeZone, on}: {
  item: NeedsYouItemOut;
  reading: boolean;
  own: boolean;
  answered: Answered | undefined;
  fold: 'in' | 'out' | null;
  menuOpen: boolean;
  today: string;
  timeZone: string;
  on: Handlers;
}) {
  const jd = item.kind === 'jd_to_confirm';
  const day = dayWord(localDate(item.at, timeZone), today);
  const leaving = fold === 'out';
  return (
    <div ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={reading ? 'jb-hist reading' : 'jb-hist'} data-need={item.id}
      aria-hidden={leaving || undefined} inert={Boolean(answered) || leaving}>
      <Icon name={KIND_GLYPHS[item.kind]} size={16} />
      {item.message_id !== null ? (
        <span className="what opens">
          <button type="button" data-tip="Read this email" aria-pressed={reading && own} onClick={() => on.read(item)}>{itemWhat(item)}</button>
          <span className="why"> · {historyWhy(item)}</span>
        </span>
      ) : <span className="what"><b>{itemWhat(item)}</b> · {historyWhy(item)}</span>}
      <span className="when">{jd ? `Applied ${day}` : day}</span>
      <span className="acts">
        {jd ? (
          <button className="btn out sm" type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={event => on.choose(item, event.currentTarget)}>Choose…</button>
        ) : item.kind === 'update_to_assign' ? (
          <button className="btn out sm" type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={event => on.assignTo(item, event.currentTarget)}>Assign to…</button>
        ) : <button className="btn out sm" type="button" onClick={() => on.track(item)}>Track this</button>}
        <button className="btn quiet sm" type="button" onClick={() => (jd ? on.none(item) : on.notJob(item))}>{jd ? 'None of these' : 'Not about a job'}</button>
      </span>
    </div>
  );
}
