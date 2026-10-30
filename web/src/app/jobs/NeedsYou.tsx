// Needs you (DESIGN.md › Needs you; boards 32, 34a–34c; D308, D311, D313, D324, #266): the band above
// the table under its group header, today's items, and From history folded under them.
//
// - A JD to confirm: its candidates as a group, ↑ ↓ choosing and Enter picking while the item has the
//   cursor; each candidate's arrow opens its posting without picking it; None of these last.
// - An update to assign: Assign to… (the company's applications first, Another application…, Not
//   about a job), and Not about a job.
// - An email to track: Track this (decision 69), which makes the application and opens it.
// - From history: each row's two buttons (Choose… is a menu, #266), and Dismiss all with its Undo.
//
// Answered (34b, as the Today block's task): the press lands, line two crossfades to the outcome
// (120 out, 120 in), and at 360 ms the item folds away (180 ms), the count changing as it starts; the
// toast says what happened, with Undo, which folds it back. The last item takes the band with it.
import type {AccountOut, ApplicationRowOut, JdCandidateOut, NeedsYouItemOut} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import {age, fullTimestamp, localDate} from '../../logic/format.ts';
import type {Entry, FoldRules} from '../../logic/fold.ts';
import {motion} from '../../tokens.ts';
import {useExit} from '../../ui/exit.ts';
import type {IconName} from '../../ui/glyphs.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {foldIn, foldOut, useFold} from '../fold.ts';
import {showToast, toastFailure} from '../toast.ts';
import {act} from './act.ts';
import {CandidatePicker} from './CandidatePicker.tsx';
import type {Said} from './act.ts';
import {assignItem, dismissFromHistory, noneOfThese, notAJob, pickCandidate, trackItem, undoDismiss} from './api.ts';
import {JobsMenu} from './Menu.tsx';
import type {MenuAnchor, MenuSpec} from './Menu.tsx';
import {assignMenu, candidateWhere, chooseMenu} from './menus.ts';
import {dayWord, historyWhy, itemFrom, itemWhat, needsLine, titleOf} from './words.ts';

const KIND_GLYPHS: Record<NeedsYouItemOut['kind'], IconName> = {jd_to_confirm: 'description', update_to_assign: 'alt_route', email_to_track: 'bookmark_add'};

export const needKey = (id: number) => `n:${id}`;

/** How long an answered item shows its outcome before it folds away (34b). */
export const ANSWERED_MS = 360;

/** An answer's outcome, line two's words once the press lands: "JD saved · Junior Developer · New York, NY · Greenhouse". */
interface Outcome {
  what: string;
  rest: string | null;
  // The candidate picked, or None of these: its group shows it for the press.
  picked?: number | 'none';
}

interface Answered {
  item: NeedsYouItemOut;
  outcome: Outcome;
  // Where it stood, so it holds its place while the page's answer no longer has it.
  index: number;
  // The press, then the outcome in place of line two.
  phase: 'pressed' | 'done';
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

export function NeedsYou({items, history, rows, accounts, cursor, folded, now, timeZone, unfoldHistory = 0, onPoint, onOpen}: {
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
  onPoint: (key: string) => void;
  // Track this opens the application it made (34c).
  onOpen: (id: number) => void;
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
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);
  const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
  const today = localDate(now, timeZone);

  const todayEntries = useMemo(() => shownItems(items, answered, gone, false), [items, answered, gone]);
  const historyEntries = useMemo(() => shownItems(history, answered, gone, true), [history, answered, gone]);
  const todays = useFold(todayEntries, FOLDS);
  const olds = useFold(historyEntries, FOLDS);
  const live = todays.filter(entry => entry.fold !== 'out');
  const liveHistory = olds.filter(entry => entry.fold !== 'out');
  // The last item leaving folds the whole band, header and all (180 ms); From history alone keeps its line.
  const band = useExit(live.length || liveHistory.length ? true : null, motion.medium);
  const historyLine = useExit(liveHistory.length ? true : null, motion.medium * 2);
  if (!band.shown) return null;

  const drop = (id: number) => {
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

  /** Answers an item: the press lands, its outcome shows, and at 360 ms it folds away; a refusal brings it back. */
  const answer = (item: NeedsYouItemOut, outcome: Outcome, send: () => ReturnType<typeof act>, after?: (application: number | null) => void) => {
    if (answered.has(item.id)) return;
    const list = item.from_history ? history : items;
    setAnswered(map => new Map(map).set(item.id, {item, outcome, index: Math.max(0, list.findIndex(each => each.id === item.id)), phase: 'pressed'}));
    later(motion.fast, () => setAnswered(map => {
      const held = map.get(item.id);
      return held ? new Map(map).set(item.id, {...held, phase: 'done'}) : map;
    }));
    let folding = false;
    let made: number | null | undefined;
    later(ANSWERED_MS, () => {
      folding = true;
      setGone(set => new Set(set).add(item.id));
      if (made !== undefined) after?.(made);
    });
    void send().then(change => {
      if (!change) return drop(item.id);
      made = change.application;
      if (folding) after?.(made);
    });
  };
  const said = (item: NeedsYouItemOut, done: string, failed: string, tone?: Said['tone']): Said => ({done, failed, tone, undone: () => drop(item.id)});

  const pick = (item: NeedsYouItemOut, candidate: JdCandidateOut) => answer(item, {what: 'JD saved', rest: `${candidate.title} · ${candidateWhere(candidate)}`, picked: candidate.id},
    () => act(() => pickCandidate(item.application_id!, candidate.id), said(item, `JD saved for ${item.company}`, 'Couldn\'t save the JD')));
  const none = (item: NeedsYouItemOut) => answer(item, {what: 'None of these', rest: 'No JD found', picked: 'none'},
    () => act(() => noneOfThese(item.application_id!), said(item, `None of these for ${item.company}`, 'Couldn\'t turn them down')));
  const assign = (item: NeedsYouItemOut, row: ApplicationRowOut) => answer(item, {what: 'Assigned', rest: `${titleOf(row)} · ${row.company}`},
    () => act(() => assignItem(item.id, row.id), said(item, `Assigned to ${titleOf(row)}`, 'Couldn\'t assign it')));
  const notJob = (item: NeedsYouItemOut) => answer(item, {what: 'Not about a job', rest: null},
    () => act(() => notAJob(item.id), said(item, 'Not about a job', 'Couldn\'t set it aside', 'gone')));
  const track = (item: NeedsYouItemOut) => answer(item, {what: 'Tracked', rest: item.company},
    () => act(() => trackItem(item.id), said(item, `Tracking ${item.company}`, 'Couldn\'t track it')), id => id !== null && onOpen(id));

  const openMenu = (owner: string, spec: MenuSpec, element: HTMLElement) =>
    setMenu(current => (current?.owner === owner ? null : {spec, anchor: {element, corner: 'left'}, owner}));
  const assignTo = (item: NeedsYouItemOut, element: HTMLElement) =>
    openMenu(`assign:${item.id}`, assignMenu(item, rows, today, {assign: row => assign(item, row), notAJob: () => notJob(item)}), element);
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

  const handlers = {pick, none, notJob, track, assignTo, choose};
  return (
    <div className={folded || band.closing ? 'jb-band folded' : 'jb-band'} inert={folded || band.closing}>
      <div>
        {live.length > 0 && <div className="gh first"><Icon name="pending_actions" size={14} />Needs you <span className="n">{live.length}</span></div>}
        {todays.map(({key, item, fold}) => (
          <Item key={key} item={item} account={item.account_id !== null ? accounts.get(item.account_id) : undefined} cur={cursor === needKey(item.id)}
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
                  <span>From history <span className="n">{liveHistory.length}</span></span>
                  <span className="why ink3">· what the history pass wasn't sure of</span>
                </button>
                {open && <button className="btn quiet sm" type="button" title="The same as ignoring each one: those emails make nothing" onClick={event => {
                  event.stopPropagation();
                  dismissAll();
                }}>Dismiss all</button>}
              </div>
              <div className={open ? 'jb-hist-wrap open' : 'jb-hist-wrap'} inert={!open}>
                <div>
                  {olds.map(({key, item, fold}) => (
                    <HistoryRow key={key} item={item} answered={answered.get(item.id)} fold={fold} menuOpen={menu?.owner.endsWith(`:${item.id}`) ?? false}
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
}

/** The outcome in line two's place: a filled `check_circle` in `good`, what happened in `ink`, the rest in `ink3`. */
function Done({outcome}: {outcome: Outcome}) {
  return (
    <span className="jb-done" role="status">
      <Icon name="check_circle-fill" size={16} />
      <span className="w">{outcome.what}</span>
      {outcome.rest && <span className="ink3">· {outcome.rest}</span>}
    </span>
  );
}

function Item({item, account, cur, answered, fold, menuOpen, now, timeZone, today, onPoint, on}: {
  item: NeedsYouItemOut;
  account: AccountOut | undefined;
  cur: boolean;
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
  const done = answered?.phase === 'done';
  const classes = ['jb-need', cur && !leaving && 'cur', answered && 'answered', leaving && 'leaving'].filter(Boolean).join(' ');
  return (
    <div ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={classes} data-key={leaving ? undefined : key} data-need={item.id}
      aria-hidden={leaving || undefined} inert={Boolean(answered) || leaving} onMouseMove={() => !cur && !leaving && onPoint(key)}>
      <span className="g"><Icon name={KIND_GLYPHS[item.kind]} size={16} /></span>
      <div className="l1">
        <span className="what">{itemWhat(item)}</span>
        <span className="from">· {jd ? 'Is this the posting?' : itemFrom(item)}</span>
      </div>
      <div className="r1">
        {jd ? <span>Applied {dayWord(localDate(item.at, timeZone), today)}</span> : (
          <>
            {account && <span className="dot sm" style={dotStyle(account.colour)} title={account.label} />}
            <span title={fullTimestamp(item.at, timeZone)}>{age(item.at, now, timeZone)}</span>
          </>
        )}
      </div>
      {done ? <div className="acts outcome"><Done outcome={answered.outcome} /></div> : jd ? (
        <div className="acts cands">
          <CandidatePicker candidates={item.candidates} active={cur && !answered} picked={answered?.outcome.picked ?? null}
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

function HistoryRow({item, answered, fold, menuOpen, today, timeZone, on}: {
  item: NeedsYouItemOut;
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
    <div ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={answered ? 'jb-hist answered' : 'jb-hist'} data-need={item.id}
      aria-hidden={leaving || undefined} inert={Boolean(answered) || leaving}>
      <Icon name={KIND_GLYPHS[item.kind]} size={16} />
      {answered?.phase === 'done' ? <span className="what"><Done outcome={answered.outcome} /></span> : <span className="what"><b>{itemWhat(item)}</b> · {historyWhy(item)}</span>}
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
